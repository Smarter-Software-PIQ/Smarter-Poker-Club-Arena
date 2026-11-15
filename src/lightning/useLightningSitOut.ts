import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { reportError } from '../utils/errorReporter';
import { fetchLightningAnchorSeat, type LightningPoolEntry } from './lightningSession';

export interface LightningSitOutState {
  sittingOut: boolean;
  since: number | null;
  blindOff?: boolean;
}

/** Bootstrap the caller's real chair, never a hand snapshot or the pool as a table. */
export async function readLightningSitOut(
  clusterId: string,
  poolSessionId: string,
  userId: string
): Promise<LightningSitOutState | null> {
  const anchor = await fetchLightningAnchorSeat(clusterId, poolSessionId);
  if (!anchor) return null;
  const { data, error } = await supabase
    .from('table_seats')
    .select(
      'table_id,user_id,seat_number,occupancy_id,is_sitting_out,sit_out_at,left_at,leave_pending'
    )
    .eq('table_id', anchor.anchorTableId)
    .eq('user_id', userId)
    .eq('seat_number', anchor.seatNumber)
    .eq('occupancy_id', anchor.occupancyId)
    .is('left_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (
    data.table_id !== anchor.anchorTableId ||
    data.user_id !== userId ||
    data.seat_number !== anchor.seatNumber ||
    data.occupancy_id !== anchor.occupancyId ||
    data.left_at !== null ||
    typeof data.is_sitting_out !== 'boolean'
  )
    throw new Error('Lightning Sit Out Anchor Unverified');
  if (data.leave_pending === true) return null;
  const since = data.is_sitting_out ? Date.parse(data.sit_out_at ?? '') : null;
  if (since !== null && !Number.isFinite(since))
    throw new Error('Lightning Sit Out Clock Unverified');
  // A blinded-off Lightning anchor is deliberately physically eligible.
  // The caller-only hand-count RPC preserves its logical sit-out on reload.
  if (!data.is_sitting_out) {
    const status = await supabase.rpc('fn_my_hit_run_status', { p_table_id: anchor.anchorTableId });
    if (status.error) throw status.error;
    if (
      Array.isArray(status.data) &&
      status.data.some(
        (row: Record<string, unknown>) =>
          row.table_id === anchor.anchorTableId &&
          row.blind_off === true &&
          Number(row.hands_remaining) > 0
      )
    )
      return { sittingOut: true, since: null, blindOff: true };
  }
  return { sittingOut: data.is_sitting_out, since };
}

/** Existing socket connection events bootstrap/recover; action ACKs update immediately.
 * No polling, extra socket, fabricated hand seat or cashier refresh. */
export function useLightningSitOut({
  room,
  userId,
  connectionStatus,
  event,
  onPersisted,
  read = readLightningSitOut,
}: {
  room: LightningPoolEntry | null;
  userId: string | null | undefined;
  connectionStatus: string;
  event?: Record<string, unknown> | null;
  onPersisted?: (sittingOut: boolean) => void;
  read?: typeof readLightningSitOut;
}) {
  const pool = room?.poolSessionId;
  const cluster = room?.clusterId;
  const key =
    pool && cluster && userId && userId !== 'guest' ? `${pool}/${cluster}/${userId}` : null;
  const identity = useRef(key);
  const generation = useRef(0);
  const persistedVersion = useRef(0);
  const scope = useRef(0);
  if (identity.current !== key) {
    identity.current = key;
    scope.current++;
    generation.current++;
  }
  const currentScope = scope.current;
  const mounted = useRef(false);
  const [readRevision, setReadRevision] = useState(0);
  const [readFailure, setReadFailure] = useState<{ key: string; scope: number } | null>(null);
  const [readPending, setReadPending] = useState<{ key: string; scope: number } | null>(null);
  const [state, setState] = useState<{
    key: string;
    scope: number;
    value: LightningSitOutState;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!key || !pool || !cluster || !userId || connectionStatus !== 'connected') return;
    const epoch = ++generation.current;
    let current = true;
    setReadPending({ key, scope: currentScope });
    void read(cluster, pool, userId)
      .then((value) => {
        if (
          current &&
          mounted.current &&
          identity.current === key &&
          generation.current === epoch
        ) {
          setReadFailure(null);
          setState(value ? { key, scope: currentScope, value } : null);
        }
      })
      .catch((error) => {
        if (current && identity.current === key && generation.current === epoch) {
          setReadFailure({ key, scope: currentScope });
          reportError(error, 'TablePage.lightning_sitout_read_failed', { clusterId: cluster });
        }
      })
      .finally(() => {
        if (current && mounted.current && identity.current === key && generation.current === epoch)
          setReadPending(null);
      });
    return () => {
      current = false;
    };
  }, [key, pool, cluster, userId, connectionStatus, read, currentScope, readRevision]);
  // Render the original persisted transition directly from its named event.
  // The existing authenticated pool socket is owner-only. Bootstrap/reconnect
  // remains an exact anchor read, not the trigger for this visible transition.
  useEffect(() => {
    if (
      !key ||
      !pool ||
      !userId ||
      event?.type !== 'lightning_sitout_changed' ||
      event.pool_session_id !== pool ||
      event.player_id !== userId ||
      typeof event.occupancy_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        event.occupancy_id
      ) ||
      typeof event.sitting_out !== 'boolean'
    )
      return;
    const blindOff = event.sitting_out && event.blind_off === true;
    const since =
      !blindOff && event.sitting_out && typeof event.sit_out_at === 'string'
        ? Date.parse(event.sit_out_at)
        : null;
    if (
      (event.sitting_out && !blindOff && (since === null || !Number.isFinite(since))) ||
      (!event.sitting_out && event.sit_out_at !== null)
    )
      return;
    if (!mounted.current || identity.current !== key || scope.current !== currentScope) return;
    generation.current++;
    persistedVersion.current++;
    setReadFailure(null);
    setReadPending(null);
    setState({
      key,
      scope: currentScope,
      value: { sittingOut: event.sitting_out, since, ...(blindOff ? { blindOff: true } : {}) },
    });
    onPersisted?.(event.sitting_out);
  }, [event, key, pool, userId, currentScope, onPersisted]);
  const isCurrent = useCallback(
    (targetPool: string, targetUser: string) =>
      mounted.current &&
      identity.current === key &&
      scope.current === currentScope &&
      key === `${targetPool}/${cluster}/${targetUser}`,
    [key, cluster, currentScope]
  );
  const requestVersion = useCallback(() => persistedVersion.current, []);
  const acknowledge = useCallback(
    (
      targetPool: string,
      targetUser: string,
      sittingOut: boolean,
      expectedVersion = persistedVersion.current,
      receipt?: { blindOff?: boolean }
    ) => {
      if (expectedVersion !== persistedVersion.current) return false;
      const current = identity.current;
      if (
        !mounted.current ||
        !current ||
        current !== key ||
        scope.current !== currentScope ||
        current !== `${targetPool}/${cluster}/${targetUser}`
      )
        return false;
      // An earlier bootstrap cannot overwrite this newer accepted user request.
      generation.current++;
      setReadFailure(null);
      setReadPending(null);
      const blindOff = sittingOut && receipt?.blindOff === true;
      setState({
        key: current,
        scope: currentScope,
        value: {
          sittingOut,
          since: sittingOut && !blindOff ? Date.now() : null,
          ...(blindOff ? { blindOff: true } : {}),
        },
      });
      return true;
    },
    [key, cluster, currentScope]
  );
  const retryRead = useCallback(() => {
    if (mounted.current && key && identity.current === key && scope.current === currentScope)
      setReadRevision((revision) => revision + 1);
  }, [key, currentScope]);
  return {
    readError: readFailure?.key === key && readFailure?.scope === currentScope,
    reading: readPending?.key === key && readPending?.scope === currentScope,
    retryRead,
    blindOff: state?.key === key && state.scope === currentScope && state.value.blindOff === true,
    sittingOut: state?.key === key && state.scope === currentScope ? state.value.sittingOut : false,
    since: state?.key === key && state.scope === currentScope ? state.value.since : null,
    acknowledge,
    isCurrent,
    requestVersion,
  };
}
