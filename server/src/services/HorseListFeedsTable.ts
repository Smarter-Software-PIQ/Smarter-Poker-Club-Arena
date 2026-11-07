/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A TABLE IS FILLED FROM ITS LIST, IN ORDER (owner 2026-11-07)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "When a game opens a second table (or a seat opens), the must-move/waiting
 * list should feed it one name at a time, in list order, visibly (the same
 * offer/notice flow people get), rather than horses appearing at once."
 *
 * The cluster tick already calls the list into an open chair through
 * fn_offer_open_seat, and since migration 20261107195847 one name at a time
 * per table with a 20-second gap between arrivals. A horse at the head of the
 * list answers
 * that call in claimOfferedSeats exactly as a person does. What broke the
 * order was the seeding loop: it sat OTHER horses straight into the same
 * chairs in the same cycle, ahead of everyone in line.
 *
 * So a game whose list has anyone on it is fed by its list and by nothing
 * else: the seeding loop sits no horse directly at any of its tables until
 * the list is empty. The same holds while a table of the game is BREAKING
 * with players still on it: those players are first for every chair that
 * opens (must-move draws the breaking table first), so the fleet must not
 * take those chairs either.
 *
 * Lightning games have no list (Dan 2026-10-24) and are never fed this way.
 */

export interface ListFedTable {
  id: string;
  cluster_id?: unknown;
  lifecycle?: unknown;
}

/** PURE. The games whose open chairs belong to their list this cycle. */
export function gamesFedByTheirList(input: {
  /** Games with a 'waiting' row on cash_game_waitlist; null when unread. */
  waitingGameIds: ReadonlySet<string> | null;
  tables: ReadonlyArray<ListFedTable>;
  seatsByTable: ReadonlyMap<string, ReadonlyArray<unknown>>;
  lightningGames?: ReadonlySet<string> | null;
}): ReadonlySet<string> {
  const fed = new Set<string>();
  for (const g of input.waitingGameIds ?? []) fed.add(g);
  for (const t of input.tables) {
    if (!t.cluster_id || t.lifecycle !== 'breaking') continue;
    if ((input.seatsByTable.get(t.id)?.length ?? 0) > 0) fed.add(String(t.cluster_id));
  }
  for (const g of input.lightningGames ?? []) fed.delete(g);
  return fed;
}

/** The seeding loop's question: does this table's game fill from its list? */
export function listFeedsTable(
  table: { cluster_id?: unknown },
  fedGames: ReadonlySet<string>
): boolean {
  return !!table.cluster_id && fedGames.has(String(table.cluster_id));
}
