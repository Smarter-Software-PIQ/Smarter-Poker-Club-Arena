/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A FULL GAME ALWAYS HAS A WAITING LIST (Dan 2026-11-22)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, verbatim: "Horses need to join waiting lists. All games should not be
 * 'full with no waiting lists' in fact there should always be one-seats open
 * if there is no waiting lists correct that logic and functionality for No
 * Limit Holdem games."
 *
 * The rule, for every cash variant and every table size:
 *
 *   a cash game is never full with nobody on its waiting list. Either it has
 *   a waiting list, or at least one of its chairs is open.
 *
 * WHERE IT WAS BROKEN. The fleet's seat stage filled a table to its last
 * chair on the strength of the table's own shape, and the line was somebody
 * else's job a cycle later (HorseGameQueue, one name per game per cycle, and
 * only when that later cycle reached the table with an ask). Every gate that
 * stood between the two - a withheld cycle, an hourly-cap refusal, an empty
 * pool, an unread list - left the game full with nobody waiting, and a list
 * that drained (a lapsed seat call, a feeder that took its four names) put it
 * straight back there.
 *
 * THE FIX IS AT THE CHAIR. The fleet no longer buys the LAST open chair of a
 * game unless the line is accounted for in the same decision:
 *
 *   - the game already has a waiting list: the chair belongs to the list
 *     anyway (HorseListFeedsTable), and the game stays "full with a list";
 *   - or another horse is free to put its name down right now: the chair is
 *     taken AND the seat stage asks for the line in this same cycle (the
 *     pair), so the game goes from "one seat open" to "full with a list"
 *     without ever resting at "full with no list";
 *   - otherwise the chair is LEFT OPEN. One seat open with no list is the
 *     owner's own second branch, and it is the state a person can always sit
 *     down in.
 *
 * A horse joins the line exactly as before: a 'waiting' row on
 * cash_game_waitlist, the same table, the same FIFO order (created_at) and
 * the same fn_offer_open_seat call a person gets. Writing that row is the
 * horse's input device (CLAUDE.md 10.5): the tap a person makes on Join The
 * Waiting List. Nothing here reads who is a horse to give anyone a different
 * deal; this file only decides what the fleet itself is about to buy.
 *
 * WHAT IS NOT COVERED, ON PURPOSE.
 *   - Lightning games: no waiting list by owner ruling (2026-10-24: "THERE
 *     SHOULDN'T BE A WAITING LIST WHEN THERE ARE ALWAYS OPEN SEATS"); a person
 *     joins the pool and a table is made for them.
 *   - A person taking the last chair: nobody is refused a seat for a rule
 *     about the fleet. The seat event itself asks for the line at once
 *     (HorseLineOnArrival), and the next fleet cycle still does
 *     (isFullClassicQueueTable) if that event was missed.
 *   - A two-seat table that would otherwise hold one player who cannot be
 *     dealt: a game that cannot deal is worse than a full one, so the second
 *     chair is taken (DEALABLE_MINIMUM).
 *
 * Pure: no clock, no reads, no writes. HorseFleetManager owns the wiring.
 *
 * NEVER refer to the horses as "bots" - they are HORSES only.
 */
import { DEALABLE_MINIMUM } from './HorseLoneTable.js';

export interface LastChairTable {
  id?: unknown;
  cluster_id?: unknown;
  lifecycle?: unknown;
  max_players?: unknown;
}

/**
 * The game a chair belongs to. A must-move game is ONE game however many
 * tables it has, so its key is the game (cluster) id; a table outside any
 * game is its own game.
 */
export function lastChairGameKey(table: LastChairTable): string {
  return table.cluster_id ? `game:${String(table.cluster_id)}` : `table:${String(table.id ?? '')}`;
}

/**
 * PURE. Open chairs per game at the top of a cycle.
 *
 * Counts every table of the game that can still take a player: a breaking or
 * closed table gives nobody a chair, so its empties are not "a seat open".
 * A planned arrival (a must-move or break move already written) holds its
 * chair, exactly as the seat stage counts it.
 */
export function openChairsByGame(input: {
  tables: ReadonlyArray<LastChairTable>;
  occupiedByTable: (tableId: string) => number;
  pendingArrivalsByTable?: (tableId: string) => number;
}): Map<string, number> {
  const open = new Map<string, number>();
  for (const t of input.tables) {
    if (t.lifecycle === 'breaking' || t.lifecycle === 'closed') continue;
    const id = String(t.id ?? '');
    const max = Math.floor(Number(t.max_players) || 0);
    if (!id || max <= 0) continue;
    const taken = input.occupiedByTable(id) + (input.pendingArrivalsByTable?.(id) ?? 0);
    const key = lastChairGameKey(t);
    open.set(key, (open.get(key) ?? 0) + Math.max(0, max - taken));
  }
  return open;
}

export type LastChairReason =
  /** The game still has a chair open after these seats. */
  | 'room'
  /** The game has a waiting list already: full with a list. */
  | 'has_list'
  /** The last chair is taken together with a name on the list. */
  | 'paired'
  /** A table that could not deal otherwise takes its second player. */
  | 'dealable'
  /** No list and nobody free to start one: the last chair stays open. */
  | 'left_open';

export interface LastChairVerdict {
  /** Seats the fleet may buy at this table now. Never more than planned. */
  seats: number;
  /** True when the seat stage must ask for this game's line this cycle. */
  startsLine: boolean;
  reason: LastChairReason;
}

/**
 * PURE. How many of the seats the fleet planned for this table it may take.
 *
 * Only ever trims, and only ever by the game's last chair: a verdict below
 * `seatsPlanned` is exactly `openInGame - 1`.
 */
export function lastChairVerdict(input: {
  /** Horses the seat stage is about to seat at this table. */
  seatsPlanned: number;
  /** Players at this table now, planned arrivals included. */
  seatedHere: number;
  /** Open chairs across every live table of this game, right now. */
  openInGame: number;
  /** Somebody (a person or a horse) is on this game's waiting list. */
  gameHasList: boolean;
  /**
   * A horse may put its name down for this game: a must-move game that is
   * known not to be Lightning. Unknown is false.
   */
  canCarryLine: boolean;
  /** Horses free to join the line now (not being seated, seated nowhere). */
  spareWaiters: number;
}): LastChairVerdict {
  const planned = Math.max(0, Math.floor(Number(input.seatsPlanned) || 0));
  const open = Math.max(0, Math.floor(Number(input.openInGame) || 0));
  if (planned <= 0) return { seats: 0, startsLine: false, reason: 'room' };
  // More chairs than the plan takes: a seat stays open whatever happens here.
  if (planned < open) return { seats: planned, startsLine: false, reason: 'room' };
  if (input.gameHasList) return { seats: planned, startsLine: false, reason: 'has_list' };
  if (input.canCarryLine && Math.floor(Number(input.spareWaiters) || 0) >= 1) {
    return { seats: planned, startsLine: true, reason: 'paired' };
  }
  const trimmed = Math.max(0, Math.min(planned, open - 1));
  const seatedHere = Math.max(0, Math.floor(Number(input.seatedHere) || 0));
  if (seatedHere + trimmed < DEALABLE_MINIMUM && seatedHere + planned >= DEALABLE_MINIMUM) {
    // Heads-up: leaving the chair open would leave one player who cannot be
    // dealt. The line is asked for anyway when the game can carry one.
    return { seats: planned, startsLine: input.canCarryLine, reason: 'dealable' };
  }
  return { seats: trimmed, startsLine: false, reason: 'left_open' };
}

/**
 * PURE. Does the fleet owe this game a name on its list after this cycle's
 * seating? True exactly when the game can carry a horse line and its last
 * chair is gone. HorseGameQueue.planHorseQueues still checks that every live
 * table is full, that no person is waiting and that the game is not excluded.
 */
export function gameOwesALine(input: { canCarryLine: boolean; openInGame: number }): boolean {
  return input.canCarryLine && Math.floor(Number(input.openInGame) || 0) <= 0;
}
