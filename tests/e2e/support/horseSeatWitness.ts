import jsonPatch, { type Operation } from 'fast-json-patch';
import { createClient } from '@supabase/supabase-js';
import type { EngineFrame } from './liveTableRealtime';

type Badge = 'waiting' | 'sitting-out' | null;
type Seat = { id: string; seat: number; badge: Badge };
type Paint = { at: number; seats: (Seat & { avatar: boolean; avatarPending?: boolean })[] };
type Authority = {
  at: number;
  socket: number;
  hand: number;
  seats: (Seat & { playing?: boolean; dbMaySitOut?: boolean })[];
};
type Lease = {
  occupancy_id: string;
  user_id: string;
  seat_number: number;
  is_sitting_out: boolean;
};
type Exit = { user_id: string; seat_number: number; occurred_at: string };
export type SeatPaints = { changes: Paint[]; dropped: number; initialReady?: Paint };
declare global {
  interface Window {
    __horseSeatPaints?: () => SeatPaints;
    __readHorseSeatPaint?: () => Paint | undefined;
  }
}

// Runs inside the already visible spectator document. Sample the rendered result
// of DOM changes at the next paint, including image loads; retain only changes.
export function installHorseSeatPaints(table: string) {
  const changes: Paint[] = [];
  let last = '',
    pending = 0,
    dropped = 0;
  const visible = (el: Element | null) =>
    !!el &&
    el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0 &&
    getComputedStyle(el).visibility !== 'hidden' &&
    getComputedStyle(el).opacity !== '0';
  const record = () => {
    if (!location.pathname.endsWith('/table/' + table) || document.visibilityState !== 'visible')
      return;
    const felt = document.querySelector('.table-page');
    if (!felt?.querySelector('.table-surface')) return;
    const seats = Array.from(
      felt.querySelectorAll<HTMLElement>('[data-seat-num][data-player-id]')
    ).map((el) => {
      const img = el.querySelector<HTMLImageElement>('.seat__avatar-img');
      const rig = el.querySelector('.seat__avatar-wrap--rigged .seat__avatar-rive');
      const badge: Badge = visible(el.querySelector('[data-testid="seat-waiting-bb-badge"]'))
        ? 'waiting'
        : visible(el.querySelector('[data-testid="seat-sitout-badge"]'))
          ? 'sitting-out'
          : null;
      return {
        id: el.dataset.playerId!,
        seat: Number(el.dataset.seatNum),
        badge,
        avatar: !!(img?.complete && img.naturalWidth && visible(img)) || visible(rig),
        avatarPending: !!img && !img.complete && img.loading === 'eager',
      };
    });
    const signature = JSON.stringify(seats);
    const paint = { at: Date.now(), seats };
    if (signature !== last) {
      last = signature;
      if (changes.length < 512) changes.push(paint);
      else dropped++;
    }
    return paint;
  };
  const schedule = () => {
    if (!pending)
      pending = requestAnimationFrame(() => {
        pending = 0;
        record();
      });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document, { attributes: true, childList: true, subtree: true });
  document.addEventListener('load', schedule, true);
  schedule();
  window.__readHorseSeatPaint = record;
  window.__horseSeatPaints = () => {
    delete window.__readHorseSeatPaint;
    observer.disconnect();
    document.removeEventListener('load', schedule, true);
    cancelAnimationFrame(pending);
    record();
    return { changes, dropped };
  };
}

// Rebuild only contiguous snapshots from the selected socket. Never attach raw
// frames: those also contain gameplay and identity fields outside this proof.
export function seatAuthority(frames: EngineFrame[]): Authority[] {
  type State = {
    hand_number: number;
    waiting_for_bb_user_ids: string[];
    posting_bb_user_ids?: string[];
    post_bb_deferred_user_ids?: string[];
    players: {
      user_id: string;
      seat: number;
      is_sitting_out?: boolean;
      is_folded?: boolean;
      is_all_in?: boolean;
      position?: string;
    }[];
  };
  let state: State | undefined,
    seq: unknown,
    socket = 0,
    last = '';
  const history: Authority[] = [];
  for (const { message: m, socketId, at } of frames) {
    if (m.type === 'SNAPSHOT') {
      state = structuredClone(m.state as State);
      socket = socketId;
    } else if (m.type === 'DELTA' && socket === socketId && state) {
      if (m.prev !== seq) throw new Error('Discontinuous seat authority');
      state = jsonPatch.applyPatch(state, m.patch as Operation[]).newDocument;
    } else continue;
    seq = m.seq;
    if (!Array.isArray(state?.players) || !Array.isArray(state.waiting_for_bb_user_ids))
      throw new Error('Missing authoritative seat roster');
    const seats = state.players.map((p) => {
      const posting =
        state!.posting_bb_user_ids?.includes(p.user_id) ||
        state!.post_bb_deferred_user_ids?.includes(p.user_id);
      const badge: Badge = posting
        ? null
        : state!.waiting_for_bb_user_ids.includes(p.user_id)
          ? 'waiting'
          : p.is_sitting_out && !p.is_folded && !p.is_all_in
            ? 'sitting-out'
            : null;
      return {
        id: p.user_id,
        seat: p.seat,
        badge,
        playing: !posting && !badge && !p.is_sitting_out && !!p.position,
        dbMaySitOut: !posting && !badge && !p.position && !p.is_folded && !p.is_all_in,
      };
    });
    const event = { socket, hand: state.hand_number, seats };
    const signature = JSON.stringify(event);
    if (signature !== last) history.push({ at, ...event });
    if (history.length > 512) throw new Error('Seat authority observation overflow');
    last = signature;
  }
  return history;
}

export function initialAvatarPaint(paint: Paint | undefined, expected: Seat[]) {
  if (!paint || expected.length < 2 || !paint.seats.every((s) => s.avatar)) return undefined;
  return expected.every((s) =>
    paint.seats.some((p) => p.id === s.id && p.seat === s.seat && p.avatar)
  )
    ? paint
    : undefined;
}

export function inspectHorseSeats(
  paints: SeatPaints,
  history: Authority[],
  horses: Set<string>,
  exits: Exit[],
  until: number,
  durable: Lease[] = []
) {
  const changes = paints.changes.map((p) => ({
    ...p,
    seats: p.seats.filter((s) => horses.has(s.id)),
  }));
  const wire = history.map((p) => ({ ...p, seats: p.seats.filter((s) => horses.has(s.id)) }));
  const violations = new Set<string>();
  // The same database occupancy surviving the whole observation remains seated
  // even if both roster and UI briefly omit it during a hand change.
  for (const lease of durable.filter((s) => horses.has(s.user_id))) {
    let loaded = false;
    for (const p of changes) {
      const seat = p.seats.find((s) => s.seat === lease.seat_number && s.id === lease.user_id);
      if (loaded && !seat?.avatar)
        violations.add(lease.user_id + '/' + lease.seat_number + ': durable avatar missing');
      if (seat?.avatar) loaded = true;
    }
    if (!loaded && history.length && paints.changes.length)
      violations.add(lease.user_id + '/' + lease.seat_number + ': durable avatar never observed');
  }
  // An eager image still downloading on its first paint is not a lost avatar.
  // Keep that one-way hydration boundary separate from continuity: once art
  // has painted, neither a new hand nor reconnect earns another allowance.
  const firstAvatar = new Map<string, number>();
  for (const p of changes)
    for (const s of p.seats)
      if (s.avatar && !firstAvatar.has(s.id + '/' + s.seat))
        firstAvatar.set(s.id + '/' + s.seat, p.at);
  const seen = new Set<string>();
  const witnessed = {
    waiting: false,
    sittingOut: false,
    admission: false,
    acrossHands: false,
    waitingAcrossHands: false,
    sittingOutAcrossHands: false,
    reconnect: false,
    departure: false,
  };
  const prev = new Map<
    string,
    { seat: Seat; hand: number; socket: number; lastMatchedAt: number }
  >();
  for (const [index, state] of wire.entries()) {
    const end = wire[index + 1]?.at ?? until;
    for (const s of state.seats) {
      const key = s.id + '/' + s.seat;
      const prior = prev.get(key);
      if (
        !firstAvatar.has(key) &&
        changes.some((p) =>
          p.seats.some((r) => r.id === s.id && r.seat === s.seat && r.avatarPending)
        )
      )
        violations.add(key + ': avatar never observed');
      let matched = false;
      let lastMatchedAt = 0;
      for (const [i, p] of changes.entries()) {
        const start = Math.max(p.at, state.at),
          stop = Math.min(changes[i + 1]?.at ?? until, end);
        if (stop <= start) continue;
        const painted = p.seats.find((r) => r.id === s.id && r.seat === s.seat);
        // A previously rendered chair has no new hydration grace when the hand changes.
        // A paint preceding a changed engine status belongs to the prior status.
        const dbOut = durable.some(
          (r) => r.user_id === s.id && r.seat_number === s.seat && r.is_sitting_out
        );
        const badgeMatches =
          painted?.badge === s.badge ||
          (s.dbMaySitOut && dbOut && painted?.badge === 'sitting-out');
        const valid = painted?.avatar && badgeMatches;
        const hydrating =
          painted?.avatarPending && badgeMatches && start < (firstAvatar.get(key) ?? Infinity);
        if (valid) {
          matched = true;
          lastMatchedAt = start;
          seen.add(key);
          if (s.badge === 'waiting') witnessed.waiting = true;
          if (s.badge === 'sitting-out') witnessed.sittingOut = true;
        } else if (
          !hydrating &&
          (matched ||
            (seen.has(key) && (p.at >= state.at || prior?.seat.badge === s.badge)) ||
            stop - start >= 2000) &&
          (seen.has(key) || changes.some((p) => p.seats.length))
        ) {
          violations.add(
            key +
              ': ' +
              (!painted ? 'seat missing' : !painted.avatar ? 'avatar missing' : 'badge mismatch')
          );
        }
      }
      if (matched) {
        if (prior) {
          if (prior.socket !== state.socket) witnessed.reconnect = true;
          if (prior.hand > 0 && state.hand > 0 && prior.hand !== state.hand) {
            witnessed.acrossHands = true;
            if (prior.seat.badge === s.badge && s.badge === 'waiting')
              witnessed.waitingAcrossHands = true;
            if (prior.seat.badge === s.badge && s.badge === 'sitting-out')
              witnessed.sittingOutAcrossHands = true;
          }
          if (
            prior.seat.badge === 'waiting' &&
            s.playing &&
            !changes.some(
              (p) => p.at >= state.at && p.at < end && p.seats.some((r) => r.id === s.id && r.badge)
            )
          )
            witnessed.admission = true;
        }
        prev.set(key, { seat: s, hand: state.hand, socket: state.socket, lastMatchedAt });
      }
    }
    for (const [key, earlier] of prev) {
      if (state.seats.some((s) => s.id === earlier.seat.id && s.seat === earlier.seat.seat))
        continue;
      // A later missing sample is not evidence that the chair disappeared at
      // that time. Match the first occupied -> absent paint after this sighting.
      const occupied = (p: Paint) =>
        p.seats.some((s) => s.id === earlier.seat.id && s.seat === earlier.seat.seat);
      const removal = changes.find(
        (p, i) =>
          i > 0 &&
          p.at >= earlier.lastMatchedAt &&
          p.at < end &&
          occupied(changes[i - 1]) &&
          !occupied(p)
      );
      if (
        removal &&
        exits.some((e) => {
          const at = Date.parse(e.occurred_at);
          return (
            e.user_id === earlier.seat.id &&
            e.seat_number === earlier.seat.seat &&
            at >= earlier.lastMatchedAt &&
            at <= state.at &&
            at <= removal.at
          );
        })
      )
        witnessed.departure = true;
      seen.delete(key);
      prev.delete(key);
    }
  }
  return {
    status: Object.fromEntries(
      Object.entries(witnessed).map(([k, v]) => [k, v ? 'OBSERVED' : 'UNOBSERVED'])
    ),
    violations: [...violations],
    dropped: paints.dropped,
    initialAvatarReadyAt: paints.initialReady?.at ?? null,
    changes,
    wire,
    exits: exits.filter((e) => horses.has(e.user_id)),
  };
}

export function horseSeatDatabase(tableId: string) {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const leases = async (): Promise<Lease[]> => {
    const { data, error } = await db
      .from('table_seats')
      .select('occupancy_id,user_id,seat_number,is_sitting_out')
      .eq('table_id', tableId)
      .is('left_at', null);
    if (error) throw error;
    return data;
  };
  const finish = async (
    initial: Lease[],
    paints: SeatPaints,
    frames: EngineFrame[],
    since: number,
    until: number
  ) => {
    const wire = seatAuthority(frames.filter((f) => f.at <= until));
    const [final, departed] = await Promise.all([
      leases(),
      db
        .from('ca_seat_stack_exits')
        .select('user_id,seat_number,occurred_at')
        .eq('table_id', tableId)
        .eq('exit_kind', 'left')
        .gte('occurred_at', new Date(since).toISOString())
        .lte('occurred_at', new Date(until).toISOString()),
    ]);
    if (departed.error) throw departed.error;
    const durable = initial
      .filter(
        (a) =>
          a.occupancy_id &&
          final.some(
            (b) =>
              b.occupancy_id === a.occupancy_id &&
              b.user_id === a.user_id &&
              b.seat_number === a.seat_number
          )
      )
      .map((a) => ({
        ...a,
        is_sitting_out:
          a.is_sitting_out &&
          final.some((b) => b.occupancy_id === a.occupancy_id && b.is_sitting_out),
      }));
    const ids = [
      ...new Set([
        ...initial.map((s) => s.user_id),
        ...wire.flatMap((p) => p.seats.map((s) => s.id)),
        ...departed.data.map((e) => e.user_id),
      ]),
    ];
    if (!ids.length)
      return inspectHorseSeats(paints, wire, new Set(), departed.data, until, durable);
    const { data, error } = await db
      .from('profiles')
      .select('id')
      .in('id', ids)
      .eq('is_horse', true);
    if (error) throw error;
    return inspectHorseSeats(
      paints,
      wire,
      new Set(data.map((p) => p.id)),
      departed.data,
      until,
      durable
    );
  };
  return { leases, finish };
}
