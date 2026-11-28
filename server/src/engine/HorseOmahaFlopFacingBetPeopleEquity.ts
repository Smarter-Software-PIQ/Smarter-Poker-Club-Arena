/**
 * THE FLOP FACING-BET EQUITY, PEOPLE-PRICED (omahaFlopFacingBetEquityIsPeoplePriced; PLO-OWNER lead-10 lane PLX2,
 * 2026-11-28; default OFF, read `=== true`). Pure: no telemetry, no opponent memory, no draw.
 *
 * WHY. Heads-up in a single-raised PLO4/PLO5 cash pot, facing the preflop raiser's flop continuation bet of 0.7-1.1
 * pot, with opponent memory on, the serving engine folds 65% (PLO4, break-even 48%) and 59% (PLO5, break-even 47%):
 * a zero-equity flop bluff earns +2.69 +/- 0.47 (n 289) and +2.30 +/- 0.42 (n 683) bb per bet against it
 * (production-shaped real-node replay, l10-plx/BUILD.md). Without memory the same cells are closed. The memory input
 * is the bettor's PREFLOP range band (HorseMind history): it lowers the sampler's equity on the flipped hands from
 * 0.499 to 0.387. The people-measured flop price (omahaFlopPressureCapIsPriced) was read as
 * min(sampler equity, people-priced equity), so the measured postflop evidence could only ever LOWER the equity: a
 * preflop band from the same bettor's counters overrode people's measured flop bets of this size downward only.
 *
 * THE EVIDENCE ORDER (what this option states). Where the flop price exists for this bet (the flop pressure cap's
 * priced spot: a weak made class under pressure, heads-up, one bet, not a raise), the bettor's range is priced on
 *   1. his own record of flop bets of this size (HorseOmahaBetRead per-opponent cell, 8 pseudo-bets at people's rate),
 *   2. over people's measured heads-up flop bets of this size (people-only fit; the game x pot-type hidden-corrected
 *      cell where omahaPeoplePriorCountsHiddenBets is on, pooled with both games up to 30 bets),
 *   3. over the equilibrium anchor (the balanced share for the price, 30 pseudo-bets behind the people cell),
 * and THAT equity is the one the call-or-fold check reads: it replaces min(sampler, priced) instead of only capping
 * it. A thin people cell is not switched off: it shrinks continuously toward the anchor by that weight (no
 * threshold, no clamp of its own), exactly as every other read of this price does.
 *
 * SCOPE. PLO4/PLO5 cash only (tournaments and other games untouched), the flop, the deciding Horse heads-up, a single
 * bet (not a raise), a SINGLE-RAISED pot (limped and re-raised pots read the min as before), and the bet MADE
 * heads-up: nobody folded on the flop after the bet. A bet made into three or more players is measured in people's
 * MULTIWAY flop cell (the fit counts the players still in at the bet), which this price does not read, so a
 * responder left heads-up by later folds keeps the min (lead-10 ruling; l10-plx2/BUILD.md has the 47 such events).
 * Call vs fold only: a draw the check prices as a raise keeps the capped equity, so the option never adds a raise.
 *
 * Identity never enters: the same arithmetic for every bettor; the population data is people-only.
 */

type Hist =
  | ReadonlyArray<{ stage?: unknown; seat?: number; action?: string; amount?: number }>
  | null
  | undefined;

const wager = (a: { action?: string; amount?: number }): boolean =>
  (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') && Number(a.amount) > 0;

/** Whether the flop bet being faced was made heads-up: no player folded on the flop after its first wager. */
export function omahaFlopBetWasMadeHeadsUp(history: Hist): boolean {
  let seen = false;
  for (const a of history ?? []) {
    if (String(a?.stage) !== 'flop') continue;
    if (!seen) {
      if (wager(a)) seen = true;
      continue;
    }
    if (a.action === 'fold') return false;
  }
  return seen;
}

/** The option's scope, as the call site reads it (the priced spot itself is checked by the flop price's own gate). */
export function omahaFlopFacingBetEquityIsPeoplePricedInScope(input: {
  enabled: boolean;
  tournament: boolean;
  /** hole cards of the deciding Horse: 4 (PLO4) or 5 (PLO5); every other count is out of scope */
  holeCount: number;
  /** the flop pot type from the public preflop actions (omahaPeoplePriorFlopPotOf) */
  potType: 'limped' | 'single' | 'reraised';
  /** opponents still in at the decision */
  oppCount: number;
  history: Hist;
}): boolean {
  if (input.enabled !== true || input.tournament) return false;
  if (input.holeCount !== 4 && input.holeCount !== 5) return false;
  if (input.oppCount !== 1 || input.potType !== 'single') return false;
  return omahaFlopBetWasMadeHeadsUp(input.history);
}

/** The equity the call-or-fold check reads: the people-priced equity in scope, min(sampler, priced) otherwise. */
export function omahaFlopFacingBetCheckEquity(
  samplerEquity: number,
  pricedEquity: number,
  inScope: boolean
): number {
  return inScope ? pricedEquity : Math.min(samplerEquity, pricedEquity);
}
