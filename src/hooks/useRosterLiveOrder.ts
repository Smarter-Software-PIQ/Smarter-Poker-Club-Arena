/**
 * Active Now moves as it happens (Dan, 2026-11-12).
 *
 * The roster RPC serves the Active Now order at read time: seated first, then
 * online, then last active. Between reads the page keeps that order live from
 * two watchers that already exist for other reasons and cost no roster
 * re-read: the presence door (src/lib/profilePresence.ts, re-asked every
 * minute for every loaded row) and the club's live seats
 * (src/lib/clubLiveSeats.ts, one read per club per minute). The loaded rows
 * are re-ranked client side from those answers; the server cursor is
 * untouched, so paging on is unaffected.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { type PresenceAnswer, watchProfilePresence } from '../lib/profilePresence';
import { type LiveSeat, type LiveSeatAnswer, watchClubLiveSeats } from '../lib/clubLiveSeats';

const NO_PRESENCE: PresenceAnswer = new Map();
const NO_SEATS: LiveSeatAnswer = new Map();
const NO_LIST: readonly LiveSeat[] = [];

export interface ClubLiveSeats {
  byUser: LiveSeatAnswer;
  seats: readonly LiveSeat[];
  /** The first answer has arrived (an empty club is a real answer). */
  known: boolean;
}

export function useClubLiveSeats(clubId: string | null | undefined, enabled = true): ClubLiveSeats {
  const [state, setState] = useState<ClubLiveSeats>({ byUser: NO_SEATS, seats: NO_LIST, known: false });
  useEffect(() => {
    if (!clubId || !enabled) {
      setState({ byUser: NO_SEATS, seats: NO_LIST, known: false });
      return;
    }
    return watchClubLiveSeats(clubId, (byUser, seats) => {
      setState({ byUser, seats, known: true });
    });
  }, [clubId, enabled]);
  return state;
}

/** The presence door's latest answer for every loaded row, batched. */
export function useLoadedPresence(userIds: readonly string[]): PresenceAnswer {
  const key = useMemo(() => [...new Set(userIds)].sort().join(','), [userIds]);
  const [answer, setAnswer] = useState<PresenceAnswer>(NO_PRESENCE);
  useEffect(() => {
    if (!key) {
      setAnswer(NO_PRESENCE);
      return;
    }
    const ids = key.split(',');
    return watchProfilePresence(ids, (all) => {
      const mine = new Map<string, boolean>();
      for (const id of ids) if (all.has(id)) mine.set(id, all.get(id) === true);
      setAnswer(mine);
    });
  }, [key]);
  return answer;
}

export interface LiveRankedRow {
  user_id: string;
  is_seated: boolean;
  is_online: boolean;
  last_login?: string | null;
}

export type LiveState = { seated: boolean; online: boolean; tables: readonly LiveSeat[] };

/**
 * The live state of one row: the seat answer once it is known (else the
 * roster's is_seated), the presence door's answer once it has one (else the
 * roster's is_online, which came from the same rule).
 */
export function liveStateOf(
  row: LiveRankedRow,
  seats: ClubLiveSeats,
  presence: PresenceAnswer
): LiveState {
  const tables = seats.byUser.get(row.user_id) ?? NO_LIST;
  const seated = seats.known ? tables.length > 0 : row.is_seated;
  const live = presence.get(row.user_id);
  const online = seated || (live === undefined ? row.is_online : live);
  return { seated, online, tables };
}

function sameLive(a: LiveState, b: LiveState): boolean {
  return a.seated === b.seated && a.online === b.online && a.tables === b.tables;
}

/**
 * The live state of every loaded row, keyed by user id, with each row's object
 * kept IDENTICAL across commits while its answer is unchanged. MemberRow is
 * memoized on its props; a fresh {seated, online, tables} per parent render
 * would re-render every row on every commit (rosterPerformancePhase6), so the
 * page hands rows these stable objects instead of calling liveStateOf inline.
 */
export function useLiveStates<T extends LiveRankedRow>(
  rows: readonly T[],
  seats: ClubLiveSeats,
  presence: PresenceAnswer
): ReadonlyMap<string, LiveState> {
  const previous = useRef<ReadonlyMap<string, LiveState>>(new Map());
  return useMemo(() => {
    const next = new Map<string, LiveState>();
    for (const row of rows) {
      const fresh = liveStateOf(row, seats, presence);
      const kept = previous.current.get(row.user_id);
      next.set(row.user_id, kept && sameLive(kept, fresh) ? kept : fresh);
    }
    previous.current = next;
    return next;
  }, [rows, seats, presence]);
}

function rank(state: LiveState): number {
  return state.seated ? 2 : state.online ? 1 : 0;
}

function activityEpoch(row: LiveRankedRow): number {
  if (!row.last_login) return 0;
  const t = Date.parse(row.last_login);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Re-rank loaded rows into the Active Now order from live answers: at a
 * table, then online, then last active, ties in the order the server gave.
 */
export function orderByActivity<T extends LiveRankedRow>(
  rows: readonly T[],
  seats: ClubLiveSeats,
  presence: PresenceAnswer
): T[] {
  const keyed = rows.map((row, index) => ({
    row,
    index,
    rank: rank(liveStateOf(row, seats, presence)),
    epoch: activityEpoch(row),
  }));
  keyed.sort((a, b) => b.rank - a.rank || b.epoch - a.epoch || a.index - b.index);
  let moved = false;
  for (let i = 0; i < keyed.length; i++) {
    if (keyed[i].index !== i) {
      moved = true;
      break;
    }
  }
  return moved ? keyed.map((k) => k.row) : (rows as T[]);
}
