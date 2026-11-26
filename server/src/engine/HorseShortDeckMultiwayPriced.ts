/**
 * V17 SHORT DECK MULTIWAY SHIFT, PRICED (2026-11-22, HORSE DECISIONS lane; option
 * `v17ShortDeckIsPriced`, read `=== true`, default OFF, `OPTION_SWITCH_REFUSED`, zero SQL migrations).
 *
 * Replaces the fixed Short Deck overlay `mw += 0.015 + (oppCount - 1) * 0.012` in
 * `HorseLogic.decidePostflop` (one increment for every hand, opponent and pot) with the shift this hand
 * actually needs. The value / call / raise bars that `mw` moves were built for NLH. What a 36-card deck
 * changes, beyond the raw equity `simulateEquity` already computes in that deck, is how much a hand's
 * equity shrinks against the part of the range that continues. That shrinkage is the Bayes power-law
 * kernel of `conditionEquityAgainstRaiseCallRange` (holdemEmpiricalPriors.ts):
 *   `e_c = e ^ (1 + kappa * g)`, `g = f / (1 - f)`.
 * With `kappa` measured for both decks by the same method, the Short Deck hand at raw equity `e` is
 * worth `e ^ rho` in NLH terms, `rho = (1 + kappa_SD * g) / (1 + kappa_NLH * g)`, and the bars move by
 *   `delta = e - e ^ rho`   (> 0 tightens, < 0 loosens).
 * `g` is the mean over live opponents of `f_i / (1 - f_i)`; `f_i` is that opponent's fold-to-a-bet
 * probability on this street: the measured Short Deck pool prior, Empirical-Bayes shrunk with the
 * opponent's own fold-to-bet record. An opponent who cannot respond (all-in, no chips behind) has `f = 0`.
 *
 * Deterministic: zero `fastRandom()` draws. Public information and the hero's own equity only: no
 * opponent hole cards, no `opponentHud/` import. Unpriceable input returns `delta = 0` (the fixed
 * increment is never re-applied by this option).
 *
 * Criteria: CRITERIA-V17-SHORTDECK-PRICED.md (sha256 420f5649922688c9f2fa406be518e6f5fcca67dd00fe9a2afb5d89675df8b73d),
 * declared 2026-11-22 22:19Z before this file existed.
 */
import { empiricalBayesShrink, HOLDEM_PRIOR_STRENGTH } from './holdemEmpiricalPriors.js';

export type ShortDeckPricedStreet = 'flop' | 'turn' | 'river';

/** Provenance of every pinned input below. */
export const SHORT_DECK_MULTIWAY_PRICED_PROVENANCE = Object.freeze({
  criteria:
    'CRITERIA-V17-SHORTDECK-PRICED.md sha256 420f5649922688c9f2fa406be518e6f5fcca67dd00fe9a2afb5d89675df8b73d',
  kappaScript:
    'hd-01BbZPDk/v17-shortdeck/measure-continuation-sharpness.ts sha256 ea53b6b1ae53bfa859f47aae42806dead5ebc88cac5303ba58dc4569ae35a647',
  kappaRun:
    'SPOTS=500 K=120 R2=24 RIVER_EXACT=1 SEED=11, output sha256 87934fc3088e73ba1183730d691bc85f964e47225f0d49e56d5ebfc3d0fc0261 (pinned; 3 more runs agree in sign on flop and turn)',
  foldPrior:
    "production hand_history (read-only SELECT), game_variant = 'short_deck', single board, no bomb pot, 2026-11-14T22:00Z..2026-11-22T22:00Z; responses to each street's first bet up to the first raise; Horses only",
});

/**
 * Continuation sharpness `kappa` of the kernel, measured with the engine's own scorer, 36-card deck
 * (Short Deck ranking) and 52-card deck by the same method (pinned run, value +/- bootstrap SE):
 *   flop  NLH 0.3151 +/- 0.0074, SD 0.2396 +/- 0.0051  (SD - NLH = -0.0755, 8.4 SE)
 *   turn  NLH 0.4068 +/- 0.0129, SD 0.3432 +/- 0.0094  (-0.0636, 4.0 SE)
 *   river NLH 0.9415 +/- 0.0089, SD 0.9305 +/- 0.0093  (-0.0110, 0.85 SE, sign changes across runs)
 * Pin rule (criteria): a street whose difference is inside 2 combined SEs and changes sign across the
 * runs has no measured difference, so the river uses one value for both decks (shift 0 there).
 */
export const SHORT_DECK_CONTINUATION_SHARPNESS: Readonly<Record<ShortDeckPricedStreet, number>> =
  Object.freeze({ flop: 0.2396, turn: 0.3432, river: 0.9415 });
export const NLH_REFERENCE_CONTINUATION_SHARPNESS: Readonly<Record<ShortDeckPricedStreet, number>> =
  Object.freeze({ flop: 0.3151, turn: 0.4068, river: 0.9415 });

/** Short Deck fold-to-first-bet pool prior by street (folds / responses, measured; see provenance). */
export const SHORT_DECK_FOLD_TO_FIRST_BET: Readonly<
  Record<
    ShortDeckPricedStreet,
    { readonly folds: number; readonly responses: number; readonly rate: number }
  >
> = Object.freeze({
  flop: Object.freeze({ folds: 442, responses: 1280, rate: 442 / 1280 }),
  turn: Object.freeze({ folds: 514, responses: 1266, rate: 514 / 1266 }),
  river: Object.freeze({ folds: 423, responses: 785, rate: 423 / 785 }),
});

/** Largest fold probability priced (a continuing range always exists). */
const FOLD_CAP = 0.95;

export interface ShortDeckMultiwayOpponentInput {
  /** False when the opponent cannot respond to a bet (all-in or no chips behind): `f = 0`. */
  readonly canRespond: boolean;
  /** The opponent's own fold-to-bet record (public actions only), when the mind holds one. */
  readonly foldToBet?: { readonly hits: number; readonly opportunities: number } | null;
}

export interface ShortDeckMultiwayPriceInput {
  readonly street: string;
  /** The hand's own simulated equity (pot share) at this decision. */
  readonly equity: number;
  readonly opponents: readonly ShortDeckMultiwayOpponentInput[];
}

export type ShortDeckMultiwayPriceResult =
  | {
      readonly kind: 'priced';
      readonly delta: number;
      readonly rho: number;
      readonly meanG: number;
      readonly foldProbs: readonly number[];
      readonly street: ShortDeckPricedStreet;
    }
  | { readonly kind: 'unpriceable'; readonly delta: 0; readonly reason: string };

function isPricedStreet(s: string): s is ShortDeckPricedStreet {
  return s === 'flop' || s === 'turn' || s === 'river';
}

/** One opponent's fold-to-a-bet probability on `street`: pool prior shrunk with the opponent's own record. */
export function shortDeckOpponentFoldProb(
  street: ShortDeckPricedStreet,
  opp: ShortDeckMultiwayOpponentInput
): number {
  if (!opp.canRespond) return 0;
  const prior = SHORT_DECK_FOLD_TO_FIRST_BET[street].rate;
  const rec = opp.foldToBet;
  const est = rec
    ? empiricalBayesShrink(
        rec.hits,
        rec.opportunities,
        prior,
        HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
        'exploit_counters'
      )
    : empiricalBayesShrink(0, 0, prior, HOLDEM_PRIOR_STRENGTH.exploitCountersFallback);
  return Math.min(FOLD_CAP, Math.max(0, est.mean));
}

/** The priced Short Deck shift of the multiway bars for this hand (see the file header). */
export function priceShortDeckMultiwayShift(
  input: ShortDeckMultiwayPriceInput
): ShortDeckMultiwayPriceResult {
  if (!isPricedStreet(input.street)) {
    return { kind: 'unpriceable', delta: 0, reason: 'street' };
  }
  const e = input.equity;
  if (!Number.isFinite(e)) return { kind: 'unpriceable', delta: 0, reason: 'equity' };
  if (!input.opponents || input.opponents.length === 0) {
    return { kind: 'unpriceable', delta: 0, reason: 'no_opponent' };
  }
  const street = input.street;
  const foldProbs = input.opponents.map((o) => shortDeckOpponentFoldProb(street, o));
  let sumG = 0;
  for (const f of foldProbs) sumG += f / (1 - f);
  const meanG = sumG / foldProbs.length;
  const kSd = SHORT_DECK_CONTINUATION_SHARPNESS[street];
  const kNlh = NLH_REFERENCE_CONTINUATION_SHARPNESS[street];
  const rho = (1 + kSd * meanG) / (1 + kNlh * meanG);
  const eq = Math.min(1, Math.max(0, e));
  const delta = eq <= 0 || eq >= 1 ? 0 : eq - Math.pow(eq, rho);
  if (!Number.isFinite(delta)) return { kind: 'unpriceable', delta: 0, reason: 'non_finite' };
  return { kind: 'priced', delta, rho, meanG, foldProbs, street };
}
