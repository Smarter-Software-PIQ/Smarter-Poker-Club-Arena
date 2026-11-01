/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A TABLE THE ENGINE NO LONGER HOSTS (2026-10-31)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Production, 24 hours: GameServerAPI.engine_refusal "Table engine not found"
 * ~1,100 times on 14 table ids that no longer exist in the engine. The page
 * kept heartbeating a table that had been broken, merged or replaced, because
 * a 404 only ever stopped the beat when the table ROW said closed - and a row
 * that was still marked live, unreadable or missing kept it beating forever.
 *
 * A 404 now asks where the game went:
 *   - a tournament table follows the tournament (resolveTournamentLiveTable,
 *     the database's own primary-table election);
 *   - a cash table follows its cash game (the caller's own seat in the game,
 *     else the game's front table);
 *   - a successor that is a DIFFERENT table is opened.
 * After DEAD_TABLE_MAX_FAILURES consecutive 404s with no successor, and with
 * no database vouching for this table (its row is not live and the game's
 * election does not name it), the page shows the closed-table state and
 * returns to the club. A table the database still calls live is an engine
 * restart, not a dead table: it keeps its beat (a beat withheld from a live
 * table costs the player their seat) and is re-asked only every
 * DEAD_TABLE_REASK_EVERY beats, up to DEAD_TABLE_VOUCHED_CEILING, so the
 * resolution and the episode are both bounded.
 */

import { tableRowSaysClosed } from './heartbeatTarget';

export const DEAD_TABLE_MAX_FAILURES = 3;
/** While the database vouches for the table: re-ask once a minute (5 s beats). */
export const DEAD_TABLE_REASK_EVERY = 12;
/**
 * A table vouched for only by its ROW (no game election names it) is given
 * up after ten minutes of uninterrupted 404s (120 beats). An engine restart
 * re-claims its tables in about two minutes; a row still marked live ten
 * minutes later is a stale row, and the seat itself is untouched by the
 * player returning to the club. A table the game's own election names is
 * never given up here: the players are there.
 */
export const DEAD_TABLE_VOUCHED_CEILING = 120;

export interface DeadTableIdentity {
  tableId: string;
  tournamentId?: string | null;
  /** cash_games.id (tables.cluster_id) for a cash table. */
  cashGameId?: string | null;
}

export interface DeadTableRow {
  status?: string | null;
  is_deleted?: boolean | null;
}

export interface DeadTableDeps {
  resolveTournamentLiveTable(tournamentId: string): Promise<string | null>;
  /** Successor table id for a cash game, or null. */
  resolveCashGameTable(cashGameId: string): Promise<string | null>;
  /** The table row; `undefined` when the read failed. */
  readTableRow(tableId: string): Promise<DeadTableRow | null | undefined>;
}

export type DeadTableVerdict =
  /** Do nothing this beat. */
  | { kind: 'wait' }
  /** Open this table instead. */
  | { kind: 'successor'; tableId: string }
  /** The game is gone: closed-table state, then back to the club. */
  | { kind: 'closed' };

/** A row that exists and has not been closed, cancelled, completed or deleted. */
export function rowVouchesForTable(row: DeadTableRow | null | undefined): boolean {
  if (!row) return false;
  return !tableRowSaysClosed(row);
}

/**
 * Where did this table's game go? Returns the successor (never `tableId`
 * itself) and whether the database still names THIS table as live.
 */
export async function findSuccessorTable(
  identity: DeadTableIdentity,
  deps: DeadTableDeps
): Promise<{ successor: string | null; vouched: 'election' | 'row' | null }> {
  let elected: string | null = null;
  try {
    if (identity.tournamentId) {
      elected = await deps.resolveTournamentLiveTable(identity.tournamentId);
    } else if (identity.cashGameId) {
      elected = await deps.resolveCashGameTable(identity.cashGameId);
    }
  } catch {
    elected = null;
  }
  if (elected && elected !== identity.tableId) return { successor: elected, vouched: null };
  if (elected === identity.tableId) return { successor: null, vouched: 'election' };
  let row: DeadTableRow | null | undefined;
  try {
    row = await deps.readTableRow(identity.tableId);
  } catch {
    row = undefined;
  }
  // An unreadable row cannot vouch, but it cannot condemn either: treat a
  // failed read as "vouched" so a network blip never ejects a seated player.
  return {
    successor: null,
    vouched: row === undefined || rowVouchesForTable(row) ? 'row' : null,
  };
}

export interface DeadTableRecovery {
  /** One heartbeat answered "Table engine not found". */
  onNotRunning(): Promise<DeadTableVerdict>;
  /** Any beat that landed: the episode is over. */
  onRunning(): void;
  /** Consecutive 404 beats in the current episode. */
  failures(): number;
}

export function createDeadTableRecovery(
  identity: () => DeadTableIdentity,
  deps: DeadTableDeps
): DeadTableRecovery {
  let failures = 0;
  let inFlight = false;
  let finished = false;
  let vouchedAt = 0;
  return {
    async onNotRunning() {
      failures += 1;
      if (finished || inFlight) return { kind: 'wait' };
      // Vouched for at the last ask: an engine restart. Re-ask once a minute.
      if (vouchedAt > 0 && failures - vouchedAt < DEAD_TABLE_REASK_EVERY) return { kind: 'wait' };
      inFlight = true;
      try {
        const { successor, vouched } = await findSuccessorTable(identity(), deps);
        if (successor) {
          finished = true;
          return { kind: 'successor', tableId: successor };
        }
        // The game's own election names this table: players sit here and the
        // engine is coming back (restart, paused admission). Never closed.
        // A row alone vouching is bounded by the ceiling.
        if (
          vouched === 'election' ||
          (vouched === 'row' && failures < DEAD_TABLE_VOUCHED_CEILING)
        ) {
          vouchedAt = failures;
          return { kind: 'wait' };
        }
        vouchedAt = 0;
        if (failures >= DEAD_TABLE_MAX_FAILURES) {
          finished = true;
          return { kind: 'closed' };
        }
        return { kind: 'wait' };
      } finally {
        inFlight = false;
      }
    },
    onRunning() {
      failures = 0;
      vouchedAt = 0;
      finished = false;
    },
    failures: () => failures,
  };
}
