/**
 * PRICED MONSTER SLOWPLAY REPLACEMENT FOR UNOWNED H4 (2026-11-22, option `horseSlowplayIsPriced`,
 * default OFF, OPTION_SWITCH_REFUSED / zero SQL migrations).
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
 *   - `EV(bet)   = F * P + (1 - F) * U(e, P, b, bf)`
 *   - Free-card equity erosion `e_free = max(0, e - freeCardPenalty(wetness, oppCount, street))`
 *     smoothly prices dry vs wet boards and HU vs multiway without a hard `wetness < 0.5` cliff.
 *   - Induced stab size `s = min(effectiveStack, 0.55 * P)`.
 *   - `EV(check) = B * U(e_free, P, s, bf) + (1 - B) * e_free * P`
 *   - Checks (slowplays) ONLY when `EV(check) > EV(bet)`.
 */
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemFlopCbetFold,
  estimateHoldemTurnBetFold,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
} from './holdemEmpiricalPriors.js';

/** Default opponent stab size as a fraction of the current pot when checked to. */
export const SLOWPLAY_STAB_POT_FRAC = 0.55;

export type HorseSlowplayStreet = 'flop' | 'turn';

export type HorseSlowplayReason =
  | 'ev_check_exceeds_ev_bet'
  | 'ev_bet_exceeds_or_equals_ev_check'
  | 'degenerate_pot_or_stack';

export interface SlowplayOpponentInput {
  /** False when the opponent is already all-in / has zero chips behind and cannot fold or stab. */
  readonly canRespond?: boolean;
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
  /** Continuous board wetness score in [0, 1]. */
  readonly wetness: number;
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
  readonly freeCardEquity: number;
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
 * Continuous free-card equity erosion from checking a monster instead of betting immediately.
 * Monotonically increases with board wetness, live opponent count, and turn vs flop
 * (giving a free river card leaves no later street to charge draws).
 */
export function freeCardPenalty(
  wetness: number,
  oppCount: number,
  street: HorseSlowplayStreet
): number {
  const w = clamp01(wetness);
  const opps = Math.max(1, Math.floor(Number.isFinite(oppCount) ? oppCount : 1));
  const streetMul = street === 'turn' ? 1.15 : 1.0;
  const basePenalty = 0.005 + 0.12 * w;
  const multiwayMul = 1 + 0.75 * (opps - 1);
  return Math.min(0.45, basePenalty * multiwayMul * streetMul);
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
  const penalty = freeCardPenalty(input.wetness, opps, input.street);
  const freeCardEquity = Math.max(0, e - penalty);

  const pot = Number.isFinite(input.pot) ? input.pot : 0;
  const effectiveStack = Number.isFinite(input.effectiveStack) ? input.effectiveStack : 0;
  const rawBet = Number.isFinite(input.candidateBet) ? input.candidateBet : 0;
  const effectiveBet = Math.min(Math.max(0, effectiveStack), Math.max(0, rawBet));
  const stabSize = Math.min(Math.max(0, effectiveStack), SLOWPLAY_STAB_POT_FRAC * Math.max(0, pot));

  if (!(pot > 0) || !(effectiveStack > 0) || !(effectiveBet > 0)) {
    return {
      action: 'bet',
      evCheck: 0,
      evBet: 0,
      foldProb: 0,
      stabProb: 0,
      freeCardEquity,
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

  for (let i = 0; i < opps; i++) {
    const opp = input.opponents?.[i];
    if (opp?.canRespond === false) {
      // An all-in / zero-stack opponent can neither fold to a bet nor stab when checked to.
      allFoldProb = 0;
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
    allFoldProb *= clamp01(foldEst.mean);
    noneStabProb *= 1 - clamp01(stabEst.mean);
  }

  const foldProb = clamp01(allFoldProb);
  const stabProb = clamp01(1 - noneStabProb);

  const evBet = foldProb * pot + (1 - foldProb) * riskAdjustedCallUtility(e, pot, effectiveBet, bf);
  const evCheck =
    stabProb * riskAdjustedCallUtility(freeCardEquity, pot, stabSize, bf) +
    (1 - stabProb) * freeCardEquity * pot;

  const action: 'check' | 'bet' = evCheck > evBet ? 'check' : 'bet';
  return {
    action,
    evCheck,
    evBet,
    foldProb,
    stabProb,
    freeCardEquity,
    effectiveBet,
    stabSize,
    bubbleFactor: bf,
    reason: action === 'check' ? 'ev_check_exceeds_ev_bet' : 'ev_bet_exceeds_or_equals_ev_check',
  };
}
