/**
 * THE TURN BETTOR PRIOR SPLIT BY THE FLOP LINE (omahaTurnFacingBetPriorIsLineSplit; lead-8 lane OFB 2026-11-27).
 * Pure arithmetic: no telemetry, no opponent memory of its own (the caller passes the bettor's record), no draw.
 *
 * WHY. The turn facing-bet price reads ONE people cell per size (HorseOmahaFacingBetPeoplePrior), whatever happened on
 * the flop, and only heads-up; multiway turn spots still price the bettor on the old constant. Replayed on the serving
 * engine (31 days, 9,898 Horse turn decisions), the over-fold sits in one line: a person's 0.7-1.1 pot turn bet after a
 * CHECKED-THROUGH flop. Every Horse folds it 62-84% of the time (break-even 47%), and a zero-equity bluff of that line
 * nets +5.5 to +9.9 bb per bet against today's engine, heads-up and multiway; after the bettor's own flop bet it loses.
 * People's shown turn stabs are less often value than their barrels (big heads-up: 0.53 non-value vs 0.39; record unit
 * 0.59 vs 0.42), and twice as often given up later.
 *
 * THE PRIOR, IN ORDER OF EVIDENCE (the same three steps as HorseOmahaFacingBetPeoplePrior, one cell finer).
 *  1. His own shown bets of this street, size and line (the caller's HorseOmahaBetRead cell): his not-value rate, a
 *     Beta-binomial mean at OMAHA_PEOPLE_PRIOR_RECORD_BETS pseudo-bets of people's rate, over people's rate in the
 *     record unit of THIS line's cell, multiplies step 2. His record dominates as it grows.
 *  2. The PEOPLE-ONLY cell of this flop line (checked through / wagered), heads-up or multiway, and size
 *     (HorseOmahaTurnLinePeoplePrior.data.ts, server/scripts/omaha-turn-line-people-prior-fit.ts). With `hidden` the
 *     cell counts the bets people never showed although they did not win uncontested (folded later, mucked) as
 *     non-value (omahaPeoplePriorCountsHiddenBets: the shown-only sample over-states value).
 *  3. The balanced share for the price, as weight behind a thin cell: (n x people + K x balanced) / (n + K).
 * Identity never enters: the same arithmetic for every bettor; only the data is people-only.
 */
import { OMAHA_TURN_LINE_PEOPLE_PRIOR_DATA } from './HorseOmahaTurnLinePeoplePrior.data.js';
import { omahaBetSizeBucket } from './HorseOmahaFacingBetEv.js';
import { omahaEquilibriumAnchor } from './HorseOmahaEquilibriumAnchor.js';
import {
  OMAHA_PEOPLE_PRIOR_ANCHOR_BETS,
  OMAHA_PEOPLE_PRIOR_MAX,
  OMAHA_PEOPLE_PRIOR_MIN,
  OMAHA_PEOPLE_PRIOR_RECORD_BETS,
  type OmahaPeoplePriorInput,
  type OmahaPeoplePriorShare,
} from './HorseOmahaFacingBetPeoplePrior.js';

/** The flop line of a turn bet: nobody wagered on the flop, or somebody did. */
export type OmahaTurnFlopLine = 'checked' | 'led';

/** The flop line from the public action history: 'checked' when no flop action wagered chips (bet, raise, all-in). */
export function omahaTurnFlopLineOf(
  history: ReadonlyArray<{ stage?: unknown; action?: string; amount?: number }> | null | undefined
): OmahaTurnFlopLine {
  for (const a of history ?? []) {
    if (String(a?.stage) !== 'flop') continue;
    if (
      (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') &&
      Number.isFinite(a.amount) &&
      (a.amount as number) > 0
    )
      return 'led';
  }
  return 'checked';
}

type LineCell = {
  n: number;
  share: number | null;
  nonTop20: number | null;
  hidden: number;
  hiddenShare: number | null;
  hiddenNonTop20: number | null;
};

/** THE ONE READER of the fitted line cells: { n, share, nonTop20 } (n 0 when not measured). 'over' reads 'big'.
 *  `hidden`: the cell with the hidden bets counted as non-value (omahaPeoplePriorCountsHiddenBets). */
export function omahaTurnLinePeopleCell(
  potFrac: number,
  multiway: boolean,
  line: OmahaTurnFlopLine,
  hidden: boolean
): { n: number; share: number | null; nonTop20: number | null } {
  const table = OMAHA_TURN_LINE_PEOPLE_PRIOR_DATA.turn[line][multiway ? 'mw' : 'hu'] as Record<
    string,
    LineCell
  >;
  const b = omahaBetSizeBucket(potFrac);
  const c = table[b === 'over' ? 'big' : b];
  if (!c || !(c.n > 0)) return { n: 0, share: null, nonTop20: null };
  const share = hidden ? c.hiddenShare : c.share;
  const nt = hidden ? c.hiddenNonTop20 : c.nonTop20;
  if (share === null || !Number.isFinite(share)) return { n: 0, share: null, nonTop20: null };
  return {
    n: hidden ? c.n + c.hidden : c.n,
    share,
    nonTop20: nt !== null && nt > 0 && nt < 1 ? nt : null,
  };
}

const clamp = (q: number): number =>
  Math.max(OMAHA_PEOPLE_PRIOR_MIN, Math.min(OMAHA_PEOPLE_PRIOR_MAX, q));

/** The share priced against a turn bettor (a first wager, never a raise): his record over this line's people cell
 *  over the balanced share. Null off the turn, for a raise, or with no price. */
export function omahaTurnLinePeoplePriorShare(
  input: Omit<OmahaPeoplePriorInput, 'hidden'> & { line: OmahaTurnFlopLine; countsHidden: boolean }
): OmahaPeoplePriorShare | null {
  if (input.street !== 'turn' || input.isRaise) return null;
  if (!Number.isFinite(input.potFrac)) return null;
  const balanced = omahaEquilibriumAnchor(input.paid, input.winnable, input.rake, input.twoStreet);
  if (balanced === null) return null;
  const cell = omahaTurnLinePeopleCell(
    input.potFrac,
    input.multiway,
    input.line,
    input.countsHidden
  );
  const prior =
    cell.share === null
      ? balanced
      : clamp(
          (cell.n * cell.share + OMAHA_PEOPLE_PRIOR_ANCHOR_BETS * balanced) /
            (cell.n + OMAHA_PEOPLE_PRIOR_ANCHOR_BETS)
        );
  const rec = input.record;
  const pNT = cell.nonTop20;
  let ratio = 1;
  let shown = 0;
  if (rec && pNT !== null && Number.isFinite(rec.shown) && rec.shown > 0) {
    shown = rec.shown;
    const value = Math.max(0, Math.min(shown, Number.isFinite(rec.value) ? rec.value : 0));
    ratio =
      (OMAHA_PEOPLE_PRIOR_RECORD_BETS * pNT + (shown - value)) /
      (OMAHA_PEOPLE_PRIOR_RECORD_BETS + shown) /
      pNT;
  }
  return {
    share: clamp(prior * ratio),
    people: cell.share,
    peopleN: cell.n,
    balanced,
    prior,
    shown,
    regions: null,
  };
}
