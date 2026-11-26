/**
 * PRICED MONSTER SLOWPLAY REPLACEMENT FOR UNOWNED H4 (2026-11-22, option `horseSlowplayIsPriced`,
 * default OFF, OPTION_SWITCH_REFUSED / zero SQL migrations). r2 (2026-11-24): every input measured.
 *
 * Replaces the unowned blanket random coin flip at HorseLogic.ts (`H4`:
 * `!isRiver && wetness < 0.5 && !scare.any && !vulnerable && !turnSetPound &&
 * fastRandom() < params.slowplayFreq && oppCount <= 2`) in non-Omaha / non-FLH games
 * when `opts.horseSlowplayIsPriced === true`.
 *
 * Pure, deterministic (zero `fastRandom()` draw), public-info-only (zero opponent hole
 * cards, zero `opponentHud/` import — uses `holdemEmpiricalPriors.ts` structural
 * `HoldemHudPacketOpponent` / `ExploitCounters` shrinkage).
 *
 * Pricing model:
 *   - Candidate bet `b = min(effectiveStack, candidateBet)` against live opponents `1..oppCount`.
 *   - Fold probability `F = prod_i F_i`, where each opponent's fold-to-bet probability `F_i`
 *     comes from `estimateHoldemFlopCbetFold` (flop) or `estimateHoldemTurnBetFold` (turn).
 *   - Stab probability `B = 1 - prod_i (1 - B_i)`, where each opponent's `betWhenCheckedTo`
 *     probability `B_i` comes from `estimateHoldemBetWhenCheckedTo(street, ...)`.
 *   - Risk-adjusted utility facing a call or stab of size `w`:
 *       `U(e, P, w, bf) = e * (P + w) - (1 - e) * bf * w`
 *     At `bf = 1` (cash / chip EV), `U(e, P, w, 1) === e * (P + 2 * w) - w`.
 *     At `bf > 1` (tournament / Spin bubble factor), the losing branch `(1 - e) * w` is
 *     scaled by `bf`.
 *   - Called equity: a bet is called only by the part of the range that continues, which is
 *     stronger than the whole range. `e_c = e ^ (1 + kappa * meanG)` (the Bayes power-law
 *     continuation kernel `conditionEquityAgainstRaiseCallRange`, holdemEmpiricalPriors.ts) with
 *     `kappa` = the MEASURED NLH continuation sharpness `NLH_REFERENCE_CONTINUATION_SHARPNESS`
 *     (flop 0.3151, turn 0.4068; provenance in HorseShortDeckMultiwayPriced.ts).
 *     r2c: `g` matches how `kappa` was measured: a PER-OPPONENT continuation weight, so
 *     `g_i = F_i / (1 - F_i)` and `meanG` is the mean over the opponents, exactly as
 *     `priceShortDeckMultiwayShift` does. An all-in seat (cannot respond) enters with `F_i = 0`
 *     (`g_i = 0`: its whole range continues); an opponent priced to fold with certainty (`F_i = 1`)
 *     never continues, so it does not select the continuing range and is left out of the mean.
 *   - `EV(bet)   = F * P + (1 - F) * U(e_c, P, b, bf)`
 *   - No free-card penalty. Over one street, with ranges fixed, hero's expected equity against
 *     the whole range after the next card equals the current equity (law of total probability:
 *     equity is a martingale over the cards to come), so a free card costs no equity in
 *     expectation. What betting gains is folds now plus calls from a stronger range, and both
 *     are priced above. `wetness` is still accepted (call site unchanged) and is not priced.
 *   - Induced stab size `s = min(effectiveStack, SLOWPLAY_MEASURED_STAB_POT_FRAC[street] * P)`,
 *     the measured mean pot fraction of the first bet into a checked-to position
 *     (see `SLOWPLAY_PRICED_PROVENANCE`). The mean, because EV(check) is linear in the stab size
 *     for a fixed stab probability.
 *   - `EV(check) = B * U(e, P, s, bf) + (1 - B) * e * P`
 *   - r2c: who can stab. The slowplay spot is reached unopened, so after the Horse checks only an
 *     opponent who acts AFTER it on this street (live, not all-in) can bet into it; an opponent
 *     who already checked cannot. `B = 1 - prod_i (1 - B_i)` runs over the opponents with
 *     `canStab` (the call site sets it from dealer-relative seat order, the same predicate as
 *     HorseLogic's V17 players-behind count). None can stab (the Horse is last to act): `B = 0`
 *     and `EV(check) = e * P` exactly (no wager for the bubble factor to scale). `canStab` absent:
 *     the opponent is treated as able to stab (seat order unknown). `inPosition` is read only by
 *     the fold priors.
 *   - Checks (slowplays) ONLY when `EV(check) > EV(bet)`.
 */
import type { ExploitCounters } from './HorseOpponentExploit.js';
import { NLH_REFERENCE_CONTINUATION_SHARPNESS } from './HorseShortDeckMultiwayPriced.js';
import {
  conditionEquityAgainstRaiseCallRange,
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemFlopCbetFold,
  estimateHoldemTurnBetFold,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
} from './holdemEmpiricalPriors.js';

/** Provenance of the measured inputs pinned below. */
export const SLOWPLAY_PRICED_PROVENANCE = Object.freeze({
  criteria:
    'CRITERIA-H4-SLOWPLAY-PRICED-R2.md sha256 3178e72583229b197c3add048da6fbc7c8302cf12b8e3e7a9f224c4fe9fafe71',
  stabSize:
    "production hand_history (read-only SELECT), game_variant = 'nlh', no bomb pot, single board, 2026-11-17T05:00Z..2026-11-24T05:00Z; first bet (or all-in at currentBet 0) on the street after at least one check with every earlier action on the street a check; size = amount / publicNode.pot; pooled people + Horses; statistic = mean",
  stabSizeQuery:
    'hd-01BNteGZ/sp/measure/stab-size.sql sha256 dbbaa97bf5f8363b53c50d9da9433524f081eb9b8737a3101e8509ab9d1c04f0; merged output aggregate.json sha256 124d96eed2969c1806cf48bbb11d4e2422305b79c9cbf15fdb7cac3523ff810d',
  stabSizeSample:
    'flop n 79449 (people 121, Horses 79328) mean 0.5009 +/- 0.0028, median 0.4183; turn n 37846 (people 63, Horses 37783) mean 0.6185 +/- 0.0029, median 0.5713',
  continuationSharpness:
    'NLH_REFERENCE_CONTINUATION_SHARPNESS (HorseShortDeckMultiwayPriced.ts): flop 0.3151 +/- 0.0074, turn 0.4068 +/- 0.0129',
});

/**
 * Measured mean opponent stab size, as a fraction of the current pot, when checked to
 * (pooled mean, see `SLOWPLAY_PRICED_PROVENANCE`).
 */
export const SLOWPLAY_MEASURED_STAB_POT_FRAC: Readonly<Record<'flop' | 'turn', number>> =
  Object.freeze({ flop: 0.5009, turn: 0.6185 });

export type HorseSlowplayStreet = 'flop' | 'turn';

export type HorseSlowplayReason =
  | 'ev_check_exceeds_ev_bet'
  | 'ev_bet_exceeds_or_equals_ev_check'
  | 'degenerate_pot_or_stack';

export interface SlowplayOpponentInput {
  /** False when the opponent is already all-in / has zero chips behind and cannot fold or stab. */
  readonly canRespond?: boolean;
  /**
   * True when this opponent acts after the Horse on this street (live, not all-in), so it can bet
   * into a check. False when it already acted (it checked) or cannot act. Absent: treated as true.
   */
  readonly canStab?: boolean;
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  readonly exploitCounters?: Pick<
    ExploitCounters,
    'foldToBet' | 'foldToBetOpp' | 'betCheckedTo' | 'betCheckedToOpp'
  > | null;
}

export interface PriceMonsterSlowplayInput {
  /** Hero's estimated monster equity against live opponent(s) in [0, 1]. */
  readonly equity: number;
  /** Current pot size in chips. */
  readonly pot: number;
  /** Engine's chosen monster value bet size in chips before effective-stack cap. */
  readonly candidateBet: number;
  /** Effective remaining stack behind in chips (min of hero stack and deepest live opponent). */
  readonly effectiveStack: number;
  /** Number of live opponents in the pot (1 or 2). */
  readonly oppCount: number;
  /** Continuous board wetness score in [0, 1]. Accepted for the call site; not priced (see header). */
  readonly wetness?: number;
  /** Current street ('flop' or 'turn'). */
  readonly street: HorseSlowplayStreet;
  /** Whether hero acts in position (last on this street). */
  readonly inPosition: boolean;
  /** Effective stack-to-pot ratio (optional; conditions small IP flop c-bet fold prior). */
  readonly spr?: number;
  /** Public flop board texture ('unpaired_nonmono' | 'paired' | 'mono'). */
  readonly flopTexture?: HoldemFlopTexture;
  /** Hero tournament/Spin bubble factor (>= 1). Null/undefined/<=1 resolves to chip EV (1). */
  readonly heroBubbleFactor?: number | null;
  /** Optional per-opponent public HUD packet and/or HorseMind exploit counters. */
  readonly opponents?: readonly SlowplayOpponentInput[];
}

export interface PriceMonsterSlowplayResult {
  readonly action: 'check' | 'bet';
  readonly evCheck: number;
  readonly evBet: number;
  readonly foldProb: number;
  readonly stabProb: number;
  /** Equity used in the check branch: the raw equity (a free card costs no equity in expectation). */
  readonly checkEquity: number;
  /** Equity against the continuing range in the called branch of a bet. */
  readonly calledEquity: number;
  readonly effectiveBet: number;
  readonly stabSize: number;
  readonly bubbleFactor: number;
  readonly reason: HorseSlowplayReason;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Classify public flop texture from the board cards (first three cards).
 * Pure public-board helper: never inspects hole cards.
 */
export function classifyHoldemFlopTexture(
  board: readonly { readonly rank: string; readonly suit: string }[],
  pairedBoardHint?: boolean
): HoldemFlopTexture {
  if (board.length >= 3) {
    const c0 = board[0]!;
    const c1 = board[1]!;
    const c2 = board[2]!;
    if (c0.suit === c1.suit && c1.suit === c2.suit) return 'mono';
    if (c0.rank === c1.rank || c1.rank === c2.rank || c0.rank === c2.rank) return 'paired';
    return 'unpaired_nonmono';
  }
  return pairedBoardHint === true ? 'paired' : 'unpaired_nonmono';
}

/**
 * Hero's equity against the continuing opponents after a bet: `e ^ (1 + kappa * meanG)`, `meanG`
 * the mean over opponents of `F_i / (1 - F_i)`, `kappa` the measured NLH continuation sharpness of
 * `street`. Non-increasing in `meanG`; equals `e` at `meanG = 0`. Evaluated with the shared kernel
 * at the fold probability whose odds are `meanG` (`f = meanG / (1 + meanG)`).
 */
export function slowplayCalledEquity(
  equity: number,
  meanG: number,
  street: HorseSlowplayStreet
): number {
  const g = Number.isFinite(meanG) && meanG > 0 ? meanG : 0;
  return conditionEquityAgainstRaiseCallRange(equity, g / (1 + g), {
    sharpness: NLH_REFERENCE_CONTINUATION_SHARPNESS[street],
  });
}

/**
 * Risk-adjusted expected utility of contesting a wager `wager` into `pot` with equity `equity`
 * under tournament bubble factor `bubbleFactor >= 1`:
 *   win branch (prob `equity`):      +(pot + wager)
 *   lose branch (prob `1 - equity`): -bubbleFactor * wager
 * At `bubbleFactor = 1`, reduces identically to `equity * (pot + 2 * wager) - wager`.
 */
export function riskAdjustedCallUtility(
  equity: number,
  pot: number,
  wager: number,
  bubbleFactor: number
): number {
  const e = clamp01(equity);
  const p = Number.isFinite(pot) && pot > 0 ? pot : 0;
  const w = Number.isFinite(wager) && wager > 0 ? wager : 0;
  const bf = Number.isFinite(bubbleFactor) && bubbleFactor > 1 ? bubbleFactor : 1;
  return e * (p + w) - (1 - e) * bf * w;
}

/**
 * Deterministic EV comparison between slowplaying (checking) and value-betting a monster
 * on the flop or turn. Zero RNG, public-info-only.
 */
export function priceMonsterSlowplay(input: PriceMonsterSlowplayInput): PriceMonsterSlowplayResult {
  const e = clamp01(input.equity);
  const bf =
    typeof input.heroBubbleFactor === 'number' &&
    Number.isFinite(input.heroBubbleFactor) &&
    input.heroBubbleFactor > 1
      ? input.heroBubbleFactor
      : 1;
  const opps = Math.max(
    1,
    Math.min(2, Math.floor(Number.isFinite(input.oppCount) ? input.oppCount : 1))
  );

  const pot = Number.isFinite(input.pot) ? input.pot : 0;
  const effectiveStack = Number.isFinite(input.effectiveStack) ? input.effectiveStack : 0;
  const rawBet = Number.isFinite(input.candidateBet) ? input.candidateBet : 0;
  const effectiveBet = Math.min(Math.max(0, effectiveStack), Math.max(0, rawBet));
  const stabSize = Math.min(
    Math.max(0, effectiveStack),
    SLOWPLAY_MEASURED_STAB_POT_FRAC[input.street] * Math.max(0, pot)
  );

  if (!(pot > 0) || !(effectiveStack > 0) || !(effectiveBet > 0)) {
    return {
      action: 'bet',
      evCheck: 0,
      evBet: 0,
      foldProb: 0,
      stabProb: 0,
      checkEquity: e,
      calledEquity: e,
      effectiveBet: 0,
      stabSize: 0,
      bubbleFactor: bf,
      reason: 'degenerate_pot_or_stack',
    };
  }

  const potFraction = effectiveBet / pot;
  const headsUp = opps === 1;
  let allFoldProb = 1;
  let noneStabProb = 1;
  let sumG = 0;
  let nG = 0;

  for (let i = 0; i < opps; i++) {
    const opp = input.opponents?.[i];
    if (opp?.canRespond === false) {
      // An all-in / zero-stack opponent can neither fold to a bet nor stab when checked to; its
      // whole range continues (g = 0).
      allFoldProb = 0;
      nG++;
      continue;
    }
    const foldEst =
      input.street === 'flop'
        ? estimateHoldemFlopCbetFold(
            {
              bettorInPosition: input.inPosition,
              potFraction,
              texture: input.flopTexture,
              spr: input.spr,
              headsUp,
            },
            opp?.hudOpp,
            opp?.exploitCounters
          )
        : estimateHoldemTurnBetFold(
            {
              bettorInPosition: input.inPosition,
              potFraction,
              headsUp,
            },
            opp?.hudOpp,
            opp?.exploitCounters
          );
    const stabEst = estimateHoldemBetWhenCheckedTo(input.street, opp?.hudOpp, opp?.exploitCounters);
    const fi = clamp01(foldEst.mean);
    allFoldProb *= fi;
    if (fi < 1) {
      sumG += fi / (1 - fi);
      nG++;
    }
    // Only an opponent still to act after the Horse on this street can stab its check.
    if (opp?.canStab !== false) noneStabProb *= 1 - clamp01(stabEst.mean);
  }

  const foldProb = clamp01(allFoldProb);
  const stabProb = clamp01(1 - noneStabProb);
  const meanG = nG > 0 ? sumG / nG : 0;

  const calledEquity = slowplayCalledEquity(e, meanG, input.street);
  const evBet =
    foldProb * pot + (1 - foldProb) * riskAdjustedCallUtility(calledEquity, pot, effectiveBet, bf);
  const evCheck =
    stabProb > 0
      ? stabProb * riskAdjustedCallUtility(e, pot, stabSize, bf) + (1 - stabProb) * e * pot
      : e * pot;

  const action: 'check' | 'bet' = evCheck > evBet ? 'check' : 'bet';
  return {
    action,
    evCheck,
    evBet,
    foldProb,
    stabProb,
    checkEquity: e,
    calledEquity,
    effectiveBet,
    stabSize,
    bubbleFactor: bf,
    reason: action === 'check' ? 'ev_check_exceeds_ev_bet' : 'ev_bet_exceeds_or_equals_ev_check',
  };
}
