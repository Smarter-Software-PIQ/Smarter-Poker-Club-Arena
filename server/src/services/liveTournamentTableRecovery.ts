/**
 * ═════════════════════════════════════════════════════════════════════════
 *  A LIVE TOURNAMENT WITH NO OPEN TABLE IS A GAME NOBODY CAN REACH
 * ═════════════════════════════════════════════════════════════════════════
 *
 * On 2026-08-30 the entire Sit-and-Go board stopped. Thirty-two heads-up SNGs
 * sat REGISTERING for fifteen to twenty-five hours past their start time, each
 * owning exactly ONE table whose status was 'closed'. Healthy REGISTERING
 * Spins owned tables with status 'waiting'; that single column was the whole
 * difference.
 *
 * A closed table cannot be seated into, so:
 *
 *   - the past-start top-up could never fill the field (it counts seats on
 *     tables that are NOT closed, so it read every board as 0/2 and, needing
 *     a paid seat to fire at all, never ran);
 *   - the game could never start, so it stayed REGISTERING forever;
 *   - and it kept COVERING its price point in ensureBoardOpen, so no
 *     replacement was ever opened. Zero SNGs were created in ten hours while
 *     Spins ran at 150/hr.
 *
 * The writer was the retired World Hub legacy engine
 * (`GameController._cleanupStaleTables`, which closed any claimed table whose
 * LEGACY in-memory seat array was empty ten minutes after it was claimed - and
 * for a Hetzner-owned table that array is empty by construction). It was
 * disarmed at source that evening, and the last husk in production was created
 * minutes before it stopped. This module is the other half: whatever closes a
 * table under a live tournament in future, the game gets its felt back on the
 * next sweep instead of sitting dead until somebody reads the database.
 *
 * The planner below is pure so the rules can be pinned in tests without a
 * database; GameServer owns the reads and writes.
 */

/** A tournament that is still expecting to be played. */
import { openingRungMs } from '../config/seatFirstLadder.js';

export interface LiveTournamentRow {
  id: string;
  status?: string | null;
  start_time?: string | null;
  /** Seats, so a repaired board gets ITS OWN ladder rung back (2026-11-08). */
  max_players?: number | null;
}

/** A table row belonging to one of those tournaments. */
export interface TournamentTableRow {
  id: string;
  tournament_id?: string | null;
  status?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
}

/** One table to put back into service. */
export interface TableReopenPlan {
  tableId: string;
  tournamentId: string;
  /** 'running' for a field mid-flight, 'waiting' for a game still filling. */
  toStatus: 'waiting' | 'running';
  /** Resynced from the real seat rows, never guessed. */
  currentPlayers: number;
  /**
   * REGISTERING only: the human window closed hours ago, so restart it rather
   * than handing the board straight to the past-start filler. Same rule, and
   * the same reason, as fn_repair_seat_first_games.
   */
  refreshHumanWindow: boolean;
  /** Seats on the repaired board; decides which ladder rung it waits out. */
  seats: number;
}

/**
 * A tournament in one of these statuses still expects to be played ON ITS
 * TABLES. BAGGED (multi-day, between two days) is deliberately absent: the bag
 * closed every table on purpose and the next stage seats a fresh draw, so a
 * closed table under a bagged event is exactly what it should have.
 */
export function isLiveTournamentStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').toUpperCase();
  return s === 'REGISTERING' || s === 'RUNNING';
}

/** Deleted is gone; closed cannot be sat in. Everything else is joinable. */
export function isJoinableTable(row: TournamentTableRow | null | undefined): boolean {
  if (!row) return false;
  if (row.is_deleted === true) return false;
  return String(row.status ?? '').toLowerCase() !== 'closed';
}

/**
 * A RUNNING game is only put back on the felt when its field is still there.
 *
 * One seat, or none, is a game that is DECIDED, and the finish sweep
 * (finishSeatFirstGamesThatAreOver / recoverStuckCompletingTournaments) owns
 * that case: reopening a table under it would resurrect a tournament that is
 * on its way to being paid out. A REGISTERING game has no such ambiguity - it
 * has not dealt a card, so an empty table is exactly what it should have.
 */
export const MIN_SEATS_TO_REOPEN_RUNNING = 2;

/**
 * Decide which closed tables to reopen.
 *
 * Deliberately conservative on every axis:
 *   - a tournament that still owns ONE joinable table is left alone entirely;
 *   - a tournament with no table row at all is left alone (creation, and
 *     fn_repair_seat_first_games, own that case);
 *   - only ONE table is reopened per tournament - the newest, which is the one
 *     the game was last playing on - so a broken MTT cannot be handed back
 *     fifty tables at once;
 *   - a deleted row is never revived.
 */
export function planTableReopens(
  tournaments: LiveTournamentRow[],
  tables: TournamentTableRow[],
  openSeatsByTable: Map<string, number>
): TableReopenPlan[] {
  const byTournament = new Map<string, TournamentTableRow[]>();
  for (const t of tables) {
    const tid = String(t.tournament_id ?? '');
    if (!tid) continue;
    const list = byTournament.get(tid);
    if (list) list.push(t);
    else byTournament.set(tid, [t]);
  }

  const plans: TableReopenPlan[] = [];
  for (const tourney of tournaments) {
    if (!isLiveTournamentStatus(tourney.status)) continue;
    const owned = byTournament.get(String(tourney.id)) ?? [];
    if (owned.length === 0) continue;
    if (owned.some((t) => isJoinableTable(t))) continue;

    const revivable = owned.filter((t) => t.is_deleted !== true);
    if (revivable.length === 0) continue;

    const newest = revivable.slice().sort((a, b) => {
      const at = Date.parse(String(a.created_at ?? '')) || 0;
      const bt = Date.parse(String(b.created_at ?? '')) || 0;
      if (at !== bt) return bt - at;
      return String(b.id).localeCompare(String(a.id));
    })[0];

    const seats = openSeatsByTable.get(String(newest.id)) ?? 0;
    const running = String(tourney.status ?? '').toUpperCase() === 'RUNNING';
    if (running && seats < MIN_SEATS_TO_REOPEN_RUNNING) continue;

    plans.push({
      tableId: String(newest.id),
      tournamentId: String(tourney.id),
      toStatus: running ? 'running' : 'waiting',
      currentPlayers: seats,
      refreshHumanWindow: !running,
      seats: Number(tourney.max_players) || 0,
    });
  }
  return plans;
}

/**
 * A fresh OPENING RUNG for a repaired board, randomised per game so repaired
 * boards do not tick over in lockstep with each other.
 *
 * Dan 2026-11-08 replaced the 90-350 SECOND window with the waiting ladder in
 * server/src/config/seatFirstLadder.ts: a repaired Spin waits 60-80 minutes
 * for its next seat and a repaired Heads-Up three to four hours, exactly as a
 * freshly opened one does. A repaired board is a board that was open, not one
 * that is filled the instant it comes back - that was always the rule here,
 * and only the magnitude changed.
 *
 * The two surfaces (this one and seatFirstOpeningWindowMs in
 * TournamentRecurringService) move together or neither does;
 * theClubProgrammeMirrorsTheHouse.test.ts pins that.
 */
export function freshHumanWindowMs(seats: number): number {
  return openingRungMs(seats, (span) => Math.floor(Math.random() * (span + 1)));
}

/**
 * THE SWEEP'S ID LISTS GO OUT IN BOUNDED CHUNKS (2026-10-02).
 *
 * The reopen sweep sent every live tournament id in ONE `in.(...)` filter: 500
 * UUIDs is ~19 KB of URL, past what the Supabase gateway accepts, and the
 * socket was reset (`TypeError: fetch failed`, ECONNRESET) on every sweep - 56
 * GameServer.reopen_sweep_table_read_failed reports in 60 minutes, so the
 * sweep had silently done nothing while 594 tournaments were live. A hundred
 * ids is ~3.7 KB, the size every other chunked read in GameServer uses.
 */
export const REOPEN_SWEEP_ID_CHUNK = 100;

export function reopenSweepIdChunks(ids: string[], size = REOPEN_SWEEP_ID_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
