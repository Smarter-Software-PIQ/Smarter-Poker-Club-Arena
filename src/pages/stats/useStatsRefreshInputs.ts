import { useCallback, useEffect, useRef, useState } from 'react';
import { masterBus } from '../../core/MasterBus';
import { clearStatsRangeMemo } from '../../lib/statsCache';
import type { StatsGameMode } from '../../services/statsGameMode';
import type { StatsClubId } from '../../services/statsScope';

interface StatsRefreshInputs {
  loadScopeKey: string;
  targetUserId?: string;
  isOwnProfile: boolean;
  gameMode: StatsGameMode;
  selectedClubId: StatsClubId;
}

export function useStatsRefreshInputs({
  loadScopeKey,
  targetUserId,
  isOwnProfile,
  gameMode,
  selectedClubId,
}: StatsRefreshInputs) {
  /**
   * The CURRENT loader. Both the shared debouncer and the in-flight replay
   * below read it, so neither can fire a copy captured under an older range.
   */
  const loadRef = useRef<
    ((opts?: { fresh?: boolean; background?: boolean }) => Promise<void>) | null
  >(null);
  const [liveRevision, setLiveRevision] = useState(0);
  const [rakeRevision, setRakeRevision] = useState(0);
  /** One debounce window collapses the several events emitted by one hand and
   * the pulse fallback into one read. The committed loadRef prevents an old
   * range closure from overwriting the current window. */
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInputs = useRef({ personal: false, rake: false });
  const flushVisibleInputs = useCallback(() => {
    if (document.visibilityState !== 'visible' || refreshTimerRef.current) return;
    if (!pendingInputs.current.personal && !pendingInputs.current.rake) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (document.visibilityState !== 'visible') return;
      const { personal, rake } = pendingInputs.current;
      pendingInputs.current = { personal: false, rake: false };
      if (personal || rake) setRakeRevision((revision) => revision + 1);
      if (!personal) return;
      clearStatsRangeMemo();
      setLiveRevision((revision) => revision + 1);
      void loadRef.current?.({ fresh: true, background: true });
    }, 2000);
  }, []);
  const scheduleRefresh = useCallback(() => {
    pendingInputs.current.personal = true;
    flushVisibleInputs();
  }, [flushVisibleInputs]);
  const scheduleRakeRefresh = useCallback(() => {
    pendingInputs.current.rake = true;
    flushVisibleInputs();
  }, [flushVisibleInputs]);
  useEffect(() => {
    document.addEventListener('visibilitychange', flushVisibleInputs);
    return () => {
      document.removeEventListener('visibilitychange', flushVisibleInputs);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      pendingInputs.current = { personal: false, rake: false };
    };
  }, [flushVisibleInputs, loadScopeKey]);
  // A completed hero hand changes personal results. Wallet and credit events can
  // describe another member or an unrelated transfer; only a tournament entry
  // transaction also changes the player's own tournament result.
  useEffect(() => {
    if (!targetUserId || !isOwnProfile) return;
    const stopHand = masterBus.subscribe('HAND_COMPLETED', scheduleRefresh);
    const stopBalance = masterBus.subscribe('BALANCE_UPDATED', ({ payload }) => {
      if (payload.userId && payload.userId !== targetUserId) return;
      if (selectedClubId && payload.clubId && payload.clubId !== selectedClubId) return;
      if (
        gameMode === 'tournament' &&
        /^tournament_(buy_?in|unregister_refund|rebuy|addon)$/.test(payload.source)
      )
        scheduleRefresh();
    });
    return () => {
      stopHand();
      stopBalance();
    };
  }, [targetUserId, isOwnProfile, selectedClubId, gameMode, scheduleRefresh]);
  return { liveRevision, rakeRevision, loadRef, scheduleRefresh, scheduleRakeRefresh };
}
