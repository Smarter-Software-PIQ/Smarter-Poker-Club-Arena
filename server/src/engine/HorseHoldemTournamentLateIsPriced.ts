/**
 * holdemTournamentRiverBluffIsPriced / holdemTournamentTurnBluffIsPriced (plo-lead7 tourney-postflop 2026-11-26;
 * both default OFF, read `=== true`).
 *
 * The real-hand audit of NLH tournaments against people (HAND-AUDIT-NLH.md, decisions-tournament-v2a.csv, re-run
 * 2026-11-20..26 in 3-hour windows) ranks missed river bluffs as the top tournament leak after the flop and missed
 * turn bluffs next; the priced opening side (HorseHoldemOpeningIsPriced, #12033) is cash only. These two options are
 * its tournament twin for the bluff: NLH tournaments, one board, heads-up in the pot, not facing a wager, the
 * brain's check becomes a bluff only when it prices above the check. Every number is a price:
 *
 *   candidates     the cash bet targets (1/3, 1/2, 3/4 and 1 pot, each capped at the effective stack, plus the
 *                  effective shove when it is at most 1.5 pots): at a short effective stack the larger sizes
 *                  collapse onto the shove and only the shove and the sizes below the stack exist
 *   his fold, who folds, his calling part, the Horse's equity against it, blockers, range advantage
 *                  exactly the opening-side model (holdemOpeningPrice: his record first, shrunk to the equilibrium
 *                  anchor where his fold equals the bettor's break-even; his range from his public line only)
 *   payout risk    EV(bet B) = f' P + (1 - f') (r eqCall (P + B') - BF (1 - r eqCall) B)
 *                  EV(check) = r eqAll P
 *                  with BF the Horse's bubble factor (HorseLogic.payJumpBubbleFactor: the Phase 7 IcmModel bubble
 *                  factor, weighted by the share of the award paid by place) read once per decision at the largest
 *                  risk a bluff candidate takes (the conservative read for every smaller size; a read per size cost
 *                  up to 29 ms cold on a 600-left field); BF = 1 (chip EV)
 *                  where no pay jump is live (far from the money, heads-up, winner-take-all). Where a pay jump is
 *                  live and the context cannot price it (no trusted stacks/payouts, a satellite, a PKO or a mystery
 *                  bounty) the option stands down: unknown is not "no pay jump". On a live pay jump of a field larger
 *                  than HOLDEM_TOURNAMENT_BLUFF_ICM_FIELD_MAX (60) it stands down too: a compute bound (the ICM read
 *                  costs 2-5 ms per equity cold there), not a poker threshold.
 *   bluff          a hand with no value size (eqCall <= 1/2 at every size), EV(bet) > EV(check), and the Horse's
 *                  cards remove more of his calling part than of his folding part (blocker dependent) or the
 *                  Horse's line range outscores his (range advantage). Never random.
 *
 * Pure: no state, no random draw, no identity.
 */
import type { HoldemOpeningCandidate } from './HorseHoldemOpeningIsPriced.js';

export interface HoldemTournamentLateSpot {
  pot: number;
  heroIn: number;
  villainIn: number;
  heroStack: number;
  villainStack: number;
  /** equity realization: 1 on the river or in position */
  r: number;
}

/** The Horse's chips added to reach `to`, and his matching call, both capped by the stacks. */
export function holdemTournamentWagerParts(
  spot: HoldemTournamentLateSpot,
  to: number
): { matched: number; his: number } {
  const add = Math.max(0, Math.min(to - spot.heroIn, spot.heroStack));
  const his = Math.max(0, Math.min(to - spot.villainIn, spot.villainStack));
  const matched = Math.max(0, Math.min(add, spot.villainIn + his - spot.heroIn));
  return { matched, his };
}

/**
 * EV of a priced candidate with its losses weighted by the bubble factor `bf` (>= 1; 1 is chip EV and returns the
 * opening-side EV exactly).
 */
export function holdemTournamentRiskWeightedEv(
  spot: HoldemTournamentLateSpot,
  c: Pick<HoldemOpeningCandidate, 'to' | 'fold' | 'callEquity'>,
  bf: number
): number {
  const w = Number.isFinite(bf) && bf > 1 ? bf : 1;
  const { matched, his } = holdemTournamentWagerParts(spot, c.to);
  const win = spot.r * c.callEquity;
  return c.fold * spot.pot + (1 - c.fold) * (win * (spot.pot + his) - w * (1 - win) * matched);
}

/** The best non-value candidate by risk-weighted EV, or null. Ties keep the smaller size. */
export function holdemTournamentBestBluff(
  spot: HoldemTournamentLateSpot,
  bets: readonly HoldemOpeningCandidate[],
  bfOf: (riskChips: number) => number
): { bet: HoldemOpeningCandidate; ev: number; bf: number } | null {
  let best: { bet: HoldemOpeningCandidate; ev: number; bf: number } | null = null;
  for (const b of bets) {
    if (b.value) continue;
    const { matched } = holdemTournamentWagerParts(spot, b.to);
    const bf = bfOf(matched);
    const ev = holdemTournamentRiskWeightedEv(spot, b, bf);
    if (!best || ev > best.ev + 1e-9) best = { bet: b, ev, bf };
  }
  return best;
}
