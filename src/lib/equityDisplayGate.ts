/**
 * THE ONE RULE FOR WHEN AN ALL-IN EQUITY PERCENTAGE MAY BE DISPLAYED
 *
 * Dan 2026-11-19 (binding): "on the river it should never display 0% equity
 * and 100% equity... thats already appearent by the hands. those pop ups with
 * equity are only for pre flop, on the flop and turn. and only if its a split
 * pot on the river show the split %"
 *
 * - Preflop, flop, turn (any board short of five cards): every percentage
 *   that formats is shown.
 * - River (every dealt board holds five cards, including the showdown after
 *   it): a percentage is shown ONLY when the pot is split, which on a complete
 *   board is exactly an equity strictly between 0 and 100 (two players tied
 *   at 50/50, three at 33.3% each, a hi-lo quarter, a run-it-twice split).
 *   0% and 100% are never shown, and a lone non-endpoint value (impossible in
 *   a consistent result) is not a split, so nothing is shown.
 *
 * Every equity render site (EquityBadgeLayer, the Run It Twice panel, the
 * hand detail street facts) goes through `gateEquityDisplay`, so no site can
 * drift from the rule. The street is read from the board the equity was
 * computed on, not from a separate street field.
 */

/** Cards per board in an `allInEquityBoardKey` ("Ah,Kd,...|2c,..."), empty boards dropped. */
export function boardCardCountsFromKey(boardKey: string): number[] {
  if (!boardKey) return [];
  return boardKey
    .split('|')
    .map((b) => (b ? b.split(',').length : 0))
    .filter((n) => n > 0);
}

/** Cards per board for card arrays; empty or missing boards dropped. */
export function boardCardCounts(boards: ReadonlyArray<ReadonlyArray<unknown> | null | undefined>) {
  return boards.map((b) => (Array.isArray(b) ? b.length : 0)).filter((n) => n > 0);
}

/** River: at least one board dealt and every dealt board complete (5 cards). */
export function isRiverBoard(counts: readonly number[]): boolean {
  return counts.length > 0 && counts.every((n) => n >= 5);
}

/** A split share: strictly between 0% and 100%. */
function isSplitShare(pct: number): boolean {
  return Number.isFinite(pct) && pct > 0 && pct < 100;
}

/**
 * The entries a site may display for a board with `counts` cards per board.
 * Before the river: all entries. On the river: only split shares, and only
 * when at least two players share the pot; otherwise none.
 */
export function gateEquityDisplay<T>(
  entries: readonly T[],
  counts: readonly number[],
  pctOf: (entry: T) => number
): T[] {
  if (!isRiverBoard(counts)) return [...entries];
  const shares = entries.filter((e) => isSplitShare(pctOf(e)));
  return shares.length >= 2 ? shares : [];
}
