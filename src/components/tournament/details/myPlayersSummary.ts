/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  WHERE ARE MY PLAYERS - one derivation for every lobby tab
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-11-08, verbatim: "INSIDE OF TOURNAMENT LOBBIES WE HAVE THE FUNCTION
 * WERE AGENTS CAN SEE THERE PLAYERS IN A TOURNAMENT, OR WHO'S STILL IN. IF THEY
 * DON'T HAVE ANY PLAYERS LEFT OR REGISTERED. IT SHOULDN'T NOT SHOW. IT SHOULD
 * ALWAYS SHOW SOMETHING EITHER 'NONE OF YOUR PLAYERS REGISTERED FOR THIS EVENT'
 * OR NO PLAYERS ARE REMAINING AND SHOW WHICH PLAYERS ENTERED AND WHAT POSITION
 * THE FINISHED. AND IT SHOULD SHOW UP ON THE DETAILS PAGE AND REWARDS. AND IF
 * YOU CLICK ON THE 'TABLES' PAGE, IT SHOULD TELL YOU IF YOU HAVE A PLAYER ON THE
 * TABLE AND WHO."
 *
 * Pure: no React, no network. `useMyPlayers` feeds it the viewer's downline (the
 * one scoped read in useDownlineIds) and the field the page already holds, and
 * Details, Ranking, Rewards and Tables all render what comes out of here, so the
 * four tabs cannot count an agent's players four different ways.
 *
 * Live chip ranks use `tournamentChipRanks` over the non-out, non-qualified
 * field, exactly as Ranking ranks its board, so "Best 20th" here and the 20 on
 * the Ranking row are the same number.
 *
 * Horses are players (CLAUDE.md 10.5): nothing here reads `is_horse`.
 */

import { tournamentChipRanks } from '../../../utils/tournamentChipRanks';
import { isRecordedSatelliteQualifier } from '../../../utils/satelliteQualification';
import { tournamentTableLabel } from '../../../utils/tournamentTableLabel';
import { isPlayerOut, shortTableName, type TournamentEntry, type TournamentTable } from './types';

/** Where one of the viewer's players stands. */
export type MyPlayerState = 'registered' | 'live' | 'out' | 'winner' | 'qualified';

export interface MyPlayer {
  userId: string;
  username: string;
  state: MyPlayerState;
  /** Live chip rank among the remaining field; null unless `live`. */
  rank: number | null;
  /** Finishing position once out or the recorded winner's place; else null. */
  position: number | null;
  chips: number;
  /** Seat while live; null otherwise. */
  tableId: string | null;
  tableName: string | null;
}

/**
 * What the card says.
 *   none        nobody of mine entered
 *   registered  the event has not started and some of mine are in
 *   live        running, and at least one of mine still holds chips
 *   finished    every one of mine is out, or the event is over
 */
export type MyPlayersMode = 'none' | 'registered' | 'live' | 'finished';

export interface MyPlayersSummary {
  mode: MyPlayersMode;
  /** How many of mine entered. */
  entered: number;
  /** How many of mine still hold chips (qualified seats are not "in"). */
  alive: number;
  /** Best live chip rank among mine, 0 when none is live. */
  bestRank: number;
  /** Chips held between my live players. */
  totalChips: number;
  /** Every one of mine who entered, in the order the card lists them. */
  players: MyPlayer[];
  /** tableId -> usernames of mine seated there right now (live only). */
  byTable: Map<string, string[]>;
}

type TournamentLike = Parameters<typeof isRecordedSatelliteQualifier>[0] & {
  status?: unknown;
  name?: string | null;
};

/** Statuses in which nobody has been dealt a hand yet. */
const NOT_STARTED = new Set(['REGISTERING', 'ANNOUNCED', 'SCHEDULED', 'CANCELLED', '']);

export function eventHasStarted(status: unknown): boolean {
  return !NOT_STARTED.has(String(status ?? '').toUpperCase());
}

const STATE_ORDER: Record<MyPlayerState, number> = {
  live: 0,
  qualified: 1,
  winner: 2,
  out: 3,
  registered: 4,
};

export function deriveMyPlayers(
  tournament: TournamentLike | null | undefined,
  entries: readonly TournamentEntry[],
  tables: readonly Pick<TournamentTable, 'id' | 'name'>[],
  downlineIds: ReadonlySet<string>
): MyPlayersSummary {
  const status = String(tournament?.status ?? '').toUpperCase();
  const started = eventHasStarted(status);
  const completed = status === 'COMPLETED';

  const tableNames = new Map<string, string>();
  for (const t of tables) {
    if (!t?.id) continue;
    tableNames.set(t.id, tournamentTableLabel(t.name) || shortTableName(t.name, tournament?.name));
  }

  // Ranked over the WHOLE remaining field, before narrowing to mine, exactly as
  // Ranking does - an agent reading "3rd" needs it to mean third of the event.
  const liveField = entries.filter(
    (e) => !isPlayerOut(e) && !isRecordedSatelliteQualifier(tournament, e)
  );
  const ranks = tournamentChipRanks(liveField);

  const players: MyPlayer[] = [];
  const byTable = new Map<string, string[]>();
  let alive = 0;
  let bestRank = 0;
  let totalChips = 0;

  for (const e of entries) {
    if (!e?.user_id || !downlineIds.has(e.user_id)) continue;
    const qualified = isRecordedSatelliteQualifier(tournament, e);
    const out = isPlayerOut(e);
    const stack = Number(e.chips) || 0;
    const position = Number(e.position) > 0 ? Math.floor(Number(e.position)) : null;

    let state: MyPlayerState;
    if (qualified) state = 'qualified';
    else if (out) state = 'out';
    else if (!started) state = 'registered';
    else if (completed && e.status === 'winner') state = 'winner';
    else state = 'live';

    const isLive = state === 'live';
    const rank = isLive ? (ranks.get(e.user_id) ?? null) : null;
    const tableId = isLive && e.table_id ? e.table_id : null;

    if (!qualified && !out) {
      // Same "still in" rule as Ranking's strip: not out, not a recorded seat.
      alive += 1;
      totalChips += stack;
      if (rank !== null && (bestRank === 0 || rank < bestRank)) bestRank = rank;
    }
    if (tableId) {
      const bucket = byTable.get(tableId);
      if (bucket) bucket.push(e.username);
      else byTable.set(tableId, [e.username]);
    }

    players.push({
      userId: e.user_id,
      username: e.username,
      state,
      rank,
      position,
      chips: stack,
      tableId,
      tableName: tableId ? (tableNames.get(tableId) ?? null) : null,
    });
  }

  players.sort((a, b) => {
    if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (a.state === 'live') {
      const r = (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
      if (r !== 0) return r;
    } else if (a.state === 'out' || a.state === 'winner') {
      // Best finish first; an unrecorded place sinks.
      const p = (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);
      if (p !== 0) return p;
    }
    return (a.username || '').localeCompare(b.username || '');
  });
  for (const names of byTable.values()) names.sort((a, b) => a.localeCompare(b));

  const entered = players.length;
  // A finished event has nobody remaining, whatever the last stacks say.
  const liveNow = started && !completed && players.some((p) => p.state === 'live');
  const mode: MyPlayersMode =
    entered === 0 ? 'none' : !started ? 'registered' : liveNow && alive > 0 ? 'live' : 'finished';

  return {
    mode,
    entered,
    alive: mode === 'finished' ? 0 : alive,
    bestRank: mode === 'live' ? bestRank : 0,
    totalChips: mode === 'live' ? totalChips : 0,
    players,
    byTable: mode === 'live' ? byTable : new Map(),
  };
}

/** One line for a player in the card's list. Title Case, hyphens, no em dash. */
export function myPlayerStatusText(
  p: MyPlayer,
  ordinal: (n: number | null | undefined) => string,
  compact: (n: number | null | undefined) => string
): string {
  switch (p.state) {
    case 'qualified':
      return 'Qualified';
    case 'winner':
      return p.position ? `Winner - ${ordinal(p.position)}` : 'Winner';
    case 'out':
      return p.position ? `Finished ${ordinal(p.position)}` : 'Out';
    case 'registered':
      return 'Registered';
    case 'live': {
      const parts = [p.rank ? ordinal(p.rank) : 'In', `${compact(p.chips)} Chips`];
      parts.push(p.tableName || (p.tableId ? 'Seated' : 'Not Seated Yet'));
      return parts.join(' - ');
    }
  }
}

/**
 * Move the signed-in player's row to the top of a list and leave every other
 * row in the order it came (Dan 2026-11-08: Rewards defaults the hero to the
 * top, like Ranking). Stable; returns a copy unchanged when there is no hero
 * row.
 */
export function heroFirst<T extends { user_id: string }>(
  rows: readonly T[],
  heroId: string | null | undefined
): T[] {
  if (!heroId) return [...rows];
  const at = rows.findIndex((r) => r.user_id === heroId);
  if (at <= 0) return [...rows];
  return [rows[at], ...rows.slice(0, at), ...rows.slice(at + 1)];
}
