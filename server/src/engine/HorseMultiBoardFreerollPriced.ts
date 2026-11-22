/**
 * PRICED MULTI-BOARD FREEROLL BET/RAISE REPLACEMENT FOR UNOWNED V36 (2026-11-22, option
 * `multiBoardFreerollIsPriced`, default OFF, OPTION_SWITCH_REFUSED / zero SQL migrations).
 *
 * Replaces the two unowned blanket random coin flips in HorseLogic.ts:
 *   1. `v36_freeroll_bet` (`multiBoard36 && lockShare36 >= 1 / nBoards36 && lockShare36 < 1 &&
 *      fastRandom() < 0.9` with random sizing `Math.max(0.75, geomFrac) + fastRandom() * 0.15`).
 *   2. `v36_freeroll_raise` (`multiBoard36 && lockShare36 >= 1 / nBoards36 &&
 *      (nBoards36 === 2 || lockShare36 >= 2 / 3 || potFrac36 <= 1)` with `fastRandom() < 0.85/0.9`
 *      and random sizing `0.9 + fastRandom() * 0.2`).
 *
 * Pure, deterministic (zero `fastRandom()` draw), public-info-only (zero opponent hole cards,
 * zero `opponentHud/` import — uses `holdemEmpiricalPriors.ts` structural
 * `HoldemHudPacketOpponent` / `ExploitCounters` shrinkage).
 *
 * Pricing model:
 *   - Total freeroll equity across `N` boards:
 *       `E_total = lockShare + (1 - lockShare) * unlockedEq`
 *   - Risk-adjusted utility facing a wager `w` against pre-wager pot `P` under bubble factor `bf >= 1`:
 *       `U(e, P, w, bf) = e * (P + w) - (1 - e) * bf * w`
 *     At `bf = 1` (cash / chip EV), `U(e, P, w, 1) === e * (P + 2 * w) - w`.
 *   - Open / checked-to freeroll (`lockShare >= 1 / N && lockShare < 1`):
 *       Compare legal candidate bet sizes (0.50, 0.75, 1.00, geometric, max-legal / all-in,
 *       capped at effective stack and pot-limit cap) vs check:
 *         `EV(bet, b) = F(b) * P + (1 - F(b)) * U(E_called(b), P, effB, bf)`
 *         `EV(check)  = B * U(E_free, P, s, bf) + (1 - B) * E_free * P`
 *       where `E_called(b)` keeps `lockShare` invariant and discounts `unlockedEq` against a
 *       calling range, and `E_free = lockShare + (1 - lockShare) * max(0, unlockedEq - freeCardPenalty)`.
 *       Bet the highest-EV legal size iff `max EV(bet, b) > EV(check)`; otherwise check.
 *   - Facing-bet freeroll (`lockShare >= 1 / N` and qualifying lock/price scope):
 *       Fold is NEVER considered (freeroll call is mathematically `>= 0` EV).
 *       Compare legal candidate raise-TO sizes (0.75x, 1.00x `(pot + toCall)`, and max-legal / all-in,
 *       strictly respecting `minRaise`, effective stack, and pot-limit cap `currentBet + pot + toCall`)
 *       against call:
 *         `EV(call)      = U(E_total, P0, effCall, bf)` (where `P0 = max(0, pot - toCall)`)
 *         `EV(raise, r)  = F_raise(r) * pot + (1 - F_raise(r)) * U(E_called_raise(r), P0, effWager, bf)`
 *       Raise the highest-EV legal size iff `max EV(raise, r) > EV(call)`; otherwise call.
 */
import { potLimitRaiseTo } from './BettingStructure.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET,
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemFlopCbetFold,
  estimateHoldemRiverFoldToRaise,
  estimateHoldemTurnBetFold,
  holdemVillainRaiseCallPrice,
  readHudOpponentStat,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
} from './holdemEmpiricalPriors.js';

/** Default opponent stab size as a fraction of the current pot when checked to. */
export const FREEROLL_STAB_POT_FRAC = 0.55;

/** Standard open-bet pot fractions evaluated alongside geometric sizing and max-legal / all-in. */
export const FREEROLL_OPEN_BET_FRACTIONS: readonly number[] = Object.freeze([0.5, 0.75, 1.0]);

/** Standard raise-increment fractions of `(pot + toCall)` evaluated alongside max-legal / all-in. */
export const FREEROLL_RAISE_POT_FRACTIONS: readonly number[] = Object.freeze([0.75, 1.0]);

export type MultiBoardFreerollStreet = 'flop' | 'turn' | 'river';

export type MultiBoardFreerollOpenReason =
  | 'ev_bet_exceeds_ev_check'
  | 'ev_check_exceeds_or_equals_ev_bet'
  | 'no_legal_bet_check'
  | 'degenerate_pot_or_stack';

export type MultiBoardFreerollFacingReason =
  | 'ev_raise_exceeds_ev_call'
  | 'ev_call_exceeds_or_equals_ev_raise'
  | 'no_legal_raise_call'
  | 'degenerate_pot_or_stack';

export interface FreerollOpponentInput {
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  readonly exploitCounters?: Pick<
    ExploitCounters,
    'foldToBet' | 'foldToBetOpp' | 'betCheckedTo' | 'betCheckedToOpp' | 'riverCall' | 'riverCallOpp'
  > | null;
  /** False when this opponent is already all-in (cannot fold or stab). Defaults to true. */
  readonly canRespond?: boolean;
}

export interface FreerollBetCandidate {
  readonly amount: number;
  readonly effectiveWager: number;
  readonly potFraction: number;
  readonly foldProb: number;
  readonly calledEquity: number;
  readonly ev: number;
}

export interface PriceMultiBoardFreerollOpenInput {
  /** Fraction of boards hero has locked (`lockedBoards / nBoards`, in `[0, 1]`). */
  readonly lockShare: number;
  /** Mean equity across the unlocked board(s) in `[0, 1]`. */
  readonly unlockedEq: number;
  /** Current pot size in chips. */
  readonly pot: number;
  /** Hero's remaining stack in chips. */
  readonly heroStack: number;
  /** Effective remaining stack behind in chips (`min(heroStack, deepestRespondableOppStack)`). */
  readonly effectiveStack: number;
  /** Minimum legal opening bet in chips (e.g. `max(minRaise, bigBlind)`). */
  readonly minBet: number;
  /** True for Pot-Limit games (PLO4/5/6/8), capping bet at `pot`. */
  readonly isPotLimit: boolean;
  /** Geometric pot fraction (optional; included as a candidate when `> 0`). */
  readonly geomFrac?: number;
  /** Number of live opponents in the pot (`>= 1`). */
  readonly oppCount: number;
  /** Continuous board wetness score in `[0, 1]`. */
  readonly wetness: number;
  /** Current street (`flop` | `turn` | `river`). */
  readonly street: MultiBoardFreerollStreet;
  /** Whether hero acts in position. */
  readonly inPosition: boolean;
  /** Effective stack-to-pot ratio (optional). */
  readonly spr?: number;
  /** Public flop board texture (optional, used on flop). */
  readonly flopTexture?: HoldemFlopTexture;
  /** Hero tournament/Spin bubble factor (`>= 1`). Null/undefined/`<= 1` resolves to chip EV (`1`). */
  readonly heroBubbleFactor?: number | null;
  /** Optional per-opponent public HUD packet and/or HorseMind exploit counters. */
  readonly opponents?: readonly FreerollOpponentInput[];
}

export interface PriceMultiBoardFreerollOpenResult {
  readonly action: 'bet' | 'check';
  /** Chosen legal bet amount in chips when `action === 'bet'`, else `0`. */
  readonly betAmount: number;
  readonly evBet: number;
  readonly evCheck: number;
  readonly totalEquity: number;
  readonly freeCardEquity: number;
  readonly foldProb: number;
  readonly stabProb: number;
  readonly bubbleFactor: number;
  readonly candidates: readonly FreerollBetCandidate[];
  readonly reason: MultiBoardFreerollOpenReason;
}

export interface FreerollRaiseCandidate {
  /** Total street bet (`raiseTo`) in chips, strictly inside `[minRaiseTo, maxLegalRaiseTo]`. */
  readonly raiseTo: number;
  /** Hero's total chips added on this decision (`raiseTo - playerBet`). */
  readonly heroAdded: number;
  /** Effective hero chips at risk (`min(heroStack, toCall + min(raiseTo - currentBet, deepestOppStack))`). */
  readonly effectiveWager: number;
  /** Villain's pot-odds call price facing this raise. */
  readonly villainCallPrice: number;
  readonly foldProb: number;
  readonly calledEquity: number;
  readonly ev: number;
}

export interface PriceMultiBoardFreerollFacingBetInput {
  /** Fraction of boards hero has locked (`lockedBoards / nBoards`, in `[0, 1]`). */
  readonly lockShare: number;
  /** Mean equity across the unlocked board(s) in `[0, 1]`. */
  readonly unlockedEq: number;
  /** Current pot size in chips (including `currentBet` and `playerBet`, as in `gs.pot`). */
  readonly pot: number;
  /** Current highest bet on this street (`gs.currentBet`). */
  readonly currentBet: number;
  /** Hero's current street commitment (`player.bet`). */
  readonly playerBet: number;
  /** Chips hero owes to call (`max(0, currentBet - playerBet)`). */
  readonly toCall: number;
  /** Minimum legal raise increment (`gs.minRaise`). */
  readonly minRaise: number;
  /** Hero's remaining stack in chips (`player.stack`). */
  readonly heroStack: number;
  /** Deepest remaining stack behind among live opponents who can still respond. */
  readonly deepestOppStack: number;
  /** True for Pot-Limit games (PLO4/5/6/8), capping raise-TO at `currentBet + pot + toCall`. */
  readonly isPotLimit: boolean;
  /** Number of live opponents in the pot (`>= 1`). */
  readonly oppCount: number;
  /** Current street (`flop` | `turn` | `river`). */
  readonly street: MultiBoardFreerollStreet;
  /** Whether hero acts in position. */
  readonly inPosition: boolean;
  /** Hero tournament/Spin bubble factor (`>= 1`). Null/undefined/`<= 1` resolves to chip EV (`1`). */
  readonly heroBubbleFactor?: number | null;
  /** Optional per-opponent public HUD packet and/or HorseMind exploit counters. */
  readonly opponents?: readonly FreerollOpponentInput[];
}

export interface PriceMultiBoardFreerollFacingBetResult {
  /** Fold is NEVER returned for a qualifying multi-board freeroll. */
  readonly action: 'raise' | 'call';
  /** Chosen legal raise-TO amount in chips when `action === 'raise'`, else `0`. */
  readonly raiseTo: number;
  readonly evRaise: number;
  readonly evCall: number;
  readonly totalEquity: number;
  readonly foldProb: number;
  readonly bubbleFactor: number;
  readonly maxLegalRaiseTo: number;
  readonly candidates: readonly FreerollRaiseCandidate[];
  readonly reason: MultiBoardFreerollFacingReason;
}

const EPS = 1e-9;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampRange(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function floorCents(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.floor(x * 100 + 1e-7) / 100;
}

function roundCents(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.round(x * 100) / 100;
}

function sanitizePositive(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function resolveBubbleFactor(bf: number | null | undefined): number {
  return typeof bf === 'number' && Number.isFinite(bf) && bf > 1 ? bf : 1;
}

/**
 * Classify public flop texture from the board cards (first three cards).
 * Pure public-board helper: never inspects hole cards.
 */
export function classifyFreerollFlopTexture(
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
 * Total multi-board freeroll equity across `N` boards:
 *   `E_total = lockShare + (1 - lockShare) * unlockedEq`.
 */
export function freerollTotalEquity(lockShare: number, unlockedEq: number): number {
  const ls = clamp01(lockShare);
  const ue = clamp01(unlockedEq);
  return clamp01(ls + (1 - ls) * ue);
}

/**
 * Risk-adjusted expected utility of contesting a wager `wager` into pre-wager `pot` with equity
 * `equity` under tournament bubble factor `bubbleFactor >= 1`:
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
  const p = sanitizePositive(pot);
  const w = sanitizePositive(wager);
  const bf = resolveBubbleFactor(bubbleFactor);
  return e * (p + w) - (1 - e) * bf * w;
}

/**
 * Continuous free-card equity erosion on the UNLOCKED board(s) when hero checks instead of betting.
 * Zero on the river (no further cards); smoothly increases with wetness, opponent count, and turn
 * vs flop. Never erodes `lockShare`.
 */
export function freerollFreeCardPenalty(
  wetness: number,
  oppCount: number,
  street: MultiBoardFreerollStreet
): number {
  if (street === 'river') return 0;
  const w = clamp01(wetness);
  const opps = Math.max(1, Math.floor(Number.isFinite(oppCount) ? oppCount : 1));
  const streetMul = street === 'turn' ? 1.15 : 1.0;
  const basePenalty = 0.015 + 0.14 * w;
  const multiwayMul = 1 + 0.65 * (opps - 1);
  return Math.min(0.45, basePenalty * multiwayMul * streetMul);
}

/**
 * Conservative equity when an open freeroll bet of `potFraction` is called:
 * `lockShare` is strictly invariant (locked board(s) cannot lose); `unlockedEq` is smoothly
 * discounted against a calling range that tightens with larger bet fractions.
 */
export function freerollCalledEquity(
  lockShare: number,
  unlockedEq: number,
  potFraction: number
): number {
  const ls = clamp01(lockShare);
  const ue = clamp01(unlockedEq);
  const f = Number.isFinite(potFraction) ? Math.max(0, Math.min(2.5, potFraction)) : 0;
  const discount = 1 / (1 + 0.35 * f);
  return clamp01(ls + (1 - ls) * ue * discount);
}

/**
 * Conservative equity when a freeroll raise laying villain `villainCallPrice` is called:
 * `lockShare` is strictly invariant (locked board(s) cannot lose); `unlockedEq` is smoothly
 * discounted against a raise-continuing range.
 */
export function freerollRaiseCalledEquity(
  lockShare: number,
  unlockedEq: number,
  villainCallPrice: number
): number {
  const ls = clamp01(lockShare);
  const ue = clamp01(unlockedEq);
  const price = clamp01(villainCallPrice);
  const discount = 1 / (1 + 0.85 * price);
  return clamp01(ls + (1 - ls) * ue * discount);
}

function riverFirstBetPrior(potFraction: number): number {
  const f = Number.isFinite(potFraction) ? Math.max(0, potFraction) : 0;
  if (f <= 1 / 3 + EPS) return HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.le_33.rate;
  if (f <= 2 / 3 + EPS) return HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  if (f <= 1 + EPS) return HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['67_100'].rate;
  return HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.gt_100.rate;
}

/**
 * Smooth pot-odds elasticity within a size band so larger bets strictly raise fold probability
 * relative to smaller bets in the same band while saturating gently above 1.5x pot and staying
 * bounded in `[0.02, 0.80]` (multi-board opponents retain locked/strong hands on other boards).
 */
function smoothSizeFoldAdjustment(baseFold: number, potFraction: number): number {
  const f = Number.isFinite(potFraction) ? clampRange(potFraction, 0.05, 1.5) : 0.5;
  const price = f / (1 + 2 * f);
  const refPrice = f <= 0.4 + EPS ? 0.33 / 1.66 : f <= 0.7 + EPS ? 0.55 / 2.1 : 0.85 / 2.7;
  const elasticity = Math.pow(clampRange(price / refPrice, 0.65, 1.25), 0.35);
  return clampRange(baseFold * elasticity, 0.02, 0.8);
}

function estimateSingleOpponentOpenFold(
  street: MultiBoardFreerollStreet,
  inPosition: boolean,
  potFraction: number,
  headsUp: boolean,
  flopTexture: HoldemFlopTexture | undefined,
  spr: number | undefined,
  opp: FreerollOpponentInput | undefined
): number {
  if (opp?.canRespond === false) return 0;
  let baseFold: number;
  if (street === 'flop') {
    baseFold = estimateHoldemFlopCbetFold(
      {
        bettorInPosition: inPosition,
        potFraction,
        texture: flopTexture,
        spr,
        headsUp,
      },
      opp?.hudOpp,
      opp?.exploitCounters
    ).mean;
  } else if (street === 'turn') {
    baseFold = estimateHoldemTurnBetFold(
      {
        bettorInPosition: inPosition,
        potFraction,
        headsUp,
      },
      opp?.hudOpp,
      opp?.exploitCounters
    ).mean;
  } else {
    const prior = riverFirstBetPrior(potFraction);
    const hudRiver = readHudOpponentStat(opp?.hudOpp, 'r.fBet');
    if (hudRiver) {
      baseFold = empiricalBayesShrink(
        hudRiver.hits,
        hudRiver.opportunities,
        prior,
        HOLDEM_PRIOR_STRENGTH.turnBetFold,
        'hud_street'
      ).mean;
    } else if (opp?.exploitCounters && opp.exploitCounters.riverCallOpp > 0) {
      const riverFolds = Math.max(
        0,
        opp.exploitCounters.riverCallOpp - opp.exploitCounters.riverCall
      );
      baseFold = empiricalBayesShrink(
        riverFolds,
        opp.exploitCounters.riverCallOpp,
        prior,
        HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
        'exploit_counters'
      ).mean;
    } else if (opp?.exploitCounters && opp.exploitCounters.foldToBetOpp > 0) {
      baseFold = empiricalBayesShrink(
        opp.exploitCounters.foldToBet,
        opp.exploitCounters.foldToBetOpp,
        prior,
        HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
        'exploit_counters'
      ).mean;
    } else {
      baseFold = prior;
    }
  }
  return smoothSizeFoldAdjustment(baseFold, potFraction);
}

function estimateSingleOpponentRaiseFold(
  street: MultiBoardFreerollStreet,
  inPosition: boolean,
  villainCallPrice: number,
  isAllInRaise: boolean,
  opp: FreerollOpponentInput | undefined
): number {
  if (opp?.canRespond === false) return 0;
  if (street === 'river') {
    const baseEst = estimateHoldemRiverFoldToRaise(
      {
        raiseKind: isAllInRaise ? 'all_in_raise' : 'non_allin_raise',
        villainCallPrice,
      },
      opp?.hudOpp
    );
    if (baseEst.source === 'pool_prior' && opp?.exploitCounters) {
      if (opp.exploitCounters.riverCallOpp > 0) {
        const riverFolds = Math.max(
          0,
          opp.exploitCounters.riverCallOpp - opp.exploitCounters.riverCall
        );
        return clampRange(
          empiricalBayesShrink(
            riverFolds,
            opp.exploitCounters.riverCallOpp,
            baseEst.mean,
            HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
            'exploit_counters'
          ).mean,
          0.02,
          0.9
        );
      }
      if (opp.exploitCounters.foldToBetOpp > 0) {
        return clampRange(
          empiricalBayesShrink(
            opp.exploitCounters.foldToBet,
            opp.exploitCounters.foldToBetOpp,
            baseEst.mean,
            HOLDEM_PRIOR_STRENGTH.riverFoldToRaise * 1.5,
            'exploit_counters'
          ).mean,
          0.02,
          0.9
        );
      }
    }
    return clampRange(baseEst.mean, 0.02, 0.9);
  }

  // Flop / Turn fold-to-raise prior: bettors facing a raise are stickier than facing a first bet
  // (~0.78x of the street's large-bet fold rate), scaled smoothly by villain's true pot-odds price.
  const pos = inPosition ? 'ip' : 'oop';
  const streetBase =
    street === 'flop'
      ? HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET[pos].large.rate
      : HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET[pos].large.rate;
  const priceRatio = clampRange(villainCallPrice / 0.28, 0.55, 1.5);
  const prior = clampRange(streetBase * 0.78 * Math.pow(priceRatio, 0.5), 0.05, 0.85);

  const raiseKey = street === 'flop' ? 'f.fRaise' : 't.fRaise';
  const hudRaise = readHudOpponentStat(opp?.hudOpp, raiseKey);
  if (hudRaise) {
    return clampRange(
      empiricalBayesShrink(
        hudRaise.hits,
        hudRaise.opportunities,
        prior,
        HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
        'hud_context'
      ).mean,
      0.02,
      0.9
    );
  }
  const betKey = street === 'flop' ? 'f.fBet' : 't.fBet';
  const hudBet = readHudOpponentStat(opp?.hudOpp, betKey);
  if (hudBet) {
    // Attenuate first-bet fold rate (k doubled) when standing in for facing a raise.
    return clampRange(
      empiricalBayesShrink(
        hudBet.hits,
        hudBet.opportunities,
        prior,
        HOLDEM_PRIOR_STRENGTH.riverFoldToRaise * 2,
        'hud_street'
      ).mean,
      0.02,
      0.9
    );
  }
  if (opp?.exploitCounters && opp.exploitCounters.foldToBetOpp > 0) {
    return clampRange(
      empiricalBayesShrink(
        opp.exploitCounters.foldToBet,
        opp.exploitCounters.foldToBetOpp,
        prior,
        HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
        'exploit_counters'
      ).mean,
      0.02,
      0.9
    );
  }
  return prior;
}

function dedupeCents(values: readonly number[]): number[] {
  const sorted = [...values].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    const r = roundCents(v);
    if (out.length === 0 || Math.abs(r - out[out.length - 1]!) >= 0.01) {
      out.push(r);
    }
  }
  return out;
}

/**
 * Deterministic EV pricing for an OPEN / CHECKED-TO multi-board freeroll (`lockShare >= 1/N &&
 * lockShare < 1`). Compares legal candidate bet sizes (0.50, 0.75, 1.00, geometric, max-legal /
 * all-in — strictly honoring `minBet`, `heroStack`, and Pot-Limit `pot` cap) against checking.
 * Zero RNG, public-info-only.
 */
export function priceMultiBoardFreerollOpen(
  input: PriceMultiBoardFreerollOpenInput
): PriceMultiBoardFreerollOpenResult {
  const lockShare = clamp01(input.lockShare);
  const unlockedEq = clamp01(input.unlockedEq);
  const totalEquity = freerollTotalEquity(lockShare, unlockedEq);
  const bf = resolveBubbleFactor(input.heroBubbleFactor);
  const opps = Math.max(1, Math.floor(Number.isFinite(input.oppCount) ? input.oppCount : 1));
  const penalty = freerollFreeCardPenalty(input.wetness, opps, input.street);
  const freeCardEquity = freerollTotalEquity(lockShare, Math.max(0, unlockedEq - penalty));

  const pot = sanitizePositive(input.pot);
  const heroStack = sanitizePositive(input.heroStack);
  const effectiveStack = Math.min(heroStack, sanitizePositive(input.effectiveStack));
  const minBet = Math.max(sanitizePositive(input.minBet), 0.01);

  if (!(pot > 0) || !(heroStack > 0) || !(effectiveStack > 0)) {
    return {
      action: 'check',
      betAmount: 0,
      evBet: 0,
      evCheck: freeCardEquity * pot,
      totalEquity,
      freeCardEquity,
      foldProb: 0,
      stabProb: 0,
      bubbleFactor: bf,
      candidates: [],
      reason: 'degenerate_pot_or_stack',
    };
  }

  // Pot-limit cap: opening bet can never exceed the current pot.
  const maxLegalBet = input.isPotLimit ? Math.min(heroStack, floorCents(pot)) : heroStack;
  const stabSize = Math.min(effectiveStack, maxLegalBet, FREEROLL_STAB_POT_FRAC * pot);

  let noneStabProb = 1;
  for (let i = 0; i < opps; i++) {
    const opp = input.opponents?.[i];
    if (opp?.canRespond === false) continue;
    const stabEst = estimateHoldemBetWhenCheckedTo(input.street, opp?.hudOpp, opp?.exploitCounters);
    noneStabProb *= 1 - clamp01(stabEst.mean);
  }
  const stabProb = clamp01(1 - noneStabProb);
  const evCheck =
    stabProb * riskAdjustedCallUtility(freeCardEquity, pot, stabSize, bf) +
    (1 - stabProb) * freeCardEquity * pot;

  const rawAmounts: number[] = [];
  if (maxLegalBet >= minBet) {
    const fracs: number[] = [...FREEROLL_OPEN_BET_FRACTIONS];
    if (
      typeof input.geomFrac === 'number' &&
      Number.isFinite(input.geomFrac) &&
      input.geomFrac > 0
    ) {
      fracs.push(input.geomFrac);
    }
    for (const frac of fracs) {
      const amt = clampRange(pot * frac, minBet, maxLegalBet);
      rawAmounts.push(amt);
    }
    // Include max-legal / effective all-in (in PL this is min(heroStack, pot)).
    rawAmounts.push(clampRange(Math.min(effectiveStack, maxLegalBet), minBet, maxLegalBet));
  } else if (heroStack > 0 && (!input.isPotLimit || heroStack <= pot + 0.005)) {
    // Short-stack all-in below minBet is legal in NL and in PL when stack <= pot.
    rawAmounts.push(heroStack);
  }

  const legalAmounts = dedupeCents(rawAmounts).filter(
    (a) => a > 0 && (!input.isPotLimit || a <= pot + 0.005)
  );

  if (legalAmounts.length === 0) {
    return {
      action: 'check',
      betAmount: 0,
      evBet: evCheck,
      evCheck,
      totalEquity,
      freeCardEquity,
      foldProb: 0,
      stabProb,
      bubbleFactor: bf,
      candidates: [],
      reason: 'no_legal_bet_check',
    };
  }

  const headsUp = opps === 1;
  const candidates: FreerollBetCandidate[] = [];
  let best: FreerollBetCandidate | null = null;

  for (const amount of legalAmounts) {
    const effectiveWager = Math.min(amount, effectiveStack);
    if (!(effectiveWager > 0)) continue;
    const potFraction = effectiveWager / pot;

    let allFold = 1;
    for (let i = 0; i < opps; i++) {
      const opp = input.opponents?.[i];
      allFold *= estimateSingleOpponentOpenFold(
        input.street,
        input.inPosition,
        potFraction,
        headsUp,
        input.flopTexture,
        input.spr,
        opp
      );
    }
    const foldProb = clamp01(allFold);
    const calledEquity = freerollCalledEquity(lockShare, unlockedEq, potFraction);
    const ev =
      foldProb * pot +
      (1 - foldProb) * riskAdjustedCallUtility(calledEquity, pot, effectiveWager, bf);

    const cand: FreerollBetCandidate = {
      amount,
      effectiveWager,
      potFraction,
      foldProb,
      calledEquity,
      ev,
    };
    candidates.push(cand);
    if (best === null || cand.ev > best.ev + EPS) {
      best = cand;
    }
  }

  if (!best) {
    return {
      action: 'check',
      betAmount: 0,
      evBet: evCheck,
      evCheck,
      totalEquity,
      freeCardEquity,
      foldProb: 0,
      stabProb,
      bubbleFactor: bf,
      candidates,
      reason: 'no_legal_bet_check',
    };
  }

  if (best.ev > evCheck + EPS) {
    return {
      action: 'bet',
      betAmount: best.amount,
      evBet: best.ev,
      evCheck,
      totalEquity,
      freeCardEquity,
      foldProb: best.foldProb,
      stabProb,
      bubbleFactor: bf,
      candidates,
      reason: 'ev_bet_exceeds_ev_check',
    };
  }

  return {
    action: 'check',
    betAmount: 0,
    evBet: best.ev,
    evCheck,
    totalEquity,
    freeCardEquity,
    foldProb: best.foldProb,
    stabProb,
    bubbleFactor: bf,
    candidates,
    reason: 'ev_check_exceeds_or_equals_ev_bet',
  };
}

/**
 * Deterministic EV pricing for a FACING-BET multi-board freeroll (`lockShare >= 1/N` and
 * qualifying lock/price scope). Fold is NEVER considered. Compares legal candidate raise-TO sizes
 * (0.75x, 1.00x `(pot + toCall)`, and max-legal / all-in — strictly respecting `minRaise`,
 * effective stack, and Pot-Limit cap `currentBet + pot + toCall`) against calling.
 * Zero RNG, public-info-only.
 */
export function priceMultiBoardFreerollFacingBet(
  input: PriceMultiBoardFreerollFacingBetInput
): PriceMultiBoardFreerollFacingBetResult {
  const lockShare = clamp01(input.lockShare);
  const unlockedEq = clamp01(input.unlockedEq);
  const totalEquity = freerollTotalEquity(lockShare, unlockedEq);
  const bf = resolveBubbleFactor(input.heroBubbleFactor);
  const opps = Math.max(1, Math.floor(Number.isFinite(input.oppCount) ? input.oppCount : 1));

  const pot = sanitizePositive(input.pot);
  const currentBet = sanitizePositive(input.currentBet);
  const playerBet = sanitizePositive(input.playerBet);
  const toCall = Math.max(0, sanitizePositive(input.toCall));
  const minRaise = Math.max(sanitizePositive(input.minRaise), 0.01);
  const heroStack = sanitizePositive(input.heroStack);
  const deepestOppStack = sanitizePositive(input.deepestOppStack);

  const potBeforeBet = Math.max(0, pot - toCall);
  const effCall = Math.min(toCall, heroStack);
  const evCall = riskAdjustedCallUtility(totalEquity, potBeforeBet, effCall, bf);

  const maxRaiseToByStack = floorCents(playerBet + heroStack);
  const maxRaiseToByPotLimit = input.isPotLimit
    ? floorCents(potLimitRaiseTo(pot, currentBet, toCall))
    : Infinity;
  const maxLegalRaiseTo = Math.min(maxRaiseToByStack, maxRaiseToByPotLimit);
  const minRaiseTo = roundCents(currentBet + minRaise);

  if (!(pot > 0) || !(heroStack > 0) || !(toCall > 0)) {
    return {
      action: 'call',
      raiseTo: 0,
      evRaise: evCall,
      evCall,
      totalEquity,
      foldProb: 0,
      bubbleFactor: bf,
      maxLegalRaiseTo,
      candidates: [],
      reason: 'degenerate_pot_or_stack',
    };
  }

  // Hero cannot legally raise if hero has no chips above toCall, no opponent can respond, or
  // maxLegalRaiseTo is below minRaiseTo. Always call (never fold!).
  if (heroStack <= toCall + EPS || !(deepestOppStack > 0) || maxLegalRaiseTo + EPS < minRaiseTo) {
    return {
      action: 'call',
      raiseTo: 0,
      evRaise: evCall,
      evCall,
      totalEquity,
      foldProb: 0,
      bubbleFactor: bf,
      maxLegalRaiseTo,
      candidates: [],
      reason: 'no_legal_raise_call',
    };
  }

  const potAfterCall = pot + toCall;
  const rawRaiseTos: number[] = [];
  for (const frac of FREEROLL_RAISE_POT_FRACTIONS) {
    rawRaiseTos.push(clampRange(currentBet + frac * potAfterCall, minRaiseTo, maxLegalRaiseTo));
  }
  // Effective all-in / Pot-Limit cap candidate.
  const effectiveMaxRaiseTo = Math.min(maxLegalRaiseTo, currentBet + deepestOppStack);
  if (effectiveMaxRaiseTo >= minRaiseTo) {
    rawRaiseTos.push(effectiveMaxRaiseTo);
  }
  rawRaiseTos.push(maxLegalRaiseTo);

  const legalRaiseTos = dedupeCents(rawRaiseTos).filter(
    (rTo) =>
      rTo + EPS >= minRaiseTo &&
      rTo <= maxLegalRaiseTo + 0.005 &&
      (!input.isPotLimit || rTo <= maxRaiseToByPotLimit + 0.005)
  );

  if (legalRaiseTos.length === 0) {
    return {
      action: 'call',
      raiseTo: 0,
      evRaise: evCall,
      evCall,
      totalEquity,
      foldProb: 0,
      bubbleFactor: bf,
      maxLegalRaiseTo,
      candidates: [],
      reason: 'no_legal_raise_call',
    };
  }

  const candidates: FreerollRaiseCandidate[] = [];
  let best: FreerollRaiseCandidate | null = null;

  for (const raiseTo of legalRaiseTos) {
    const heroAdded = Math.min(heroStack, Math.max(0, raiseTo - playerBet));
    const raiseIncrement = Math.max(0, raiseTo - currentBet);
    const oppCall = Math.min(raiseIncrement, deepestOppStack);
    if (!(oppCall > 0)) continue;
    const effectiveWager = Math.min(heroStack, toCall + oppCall);
    const isAllInRaise = heroAdded >= heroStack - 0.01 || oppCall >= deepestOppStack - 0.01;
    const villainCallPrice = holdemVillainRaiseCallPrice(
      pot,
      raiseTo,
      playerBet,
      currentBet,
      heroStack,
      deepestOppStack
    );

    let allFold = 1;
    for (let i = 0; i < opps; i++) {
      const opp = input.opponents?.[i];
      allFold *= estimateSingleOpponentRaiseFold(
        input.street,
        input.inPosition,
        villainCallPrice,
        isAllInRaise,
        opp
      );
    }
    const foldProb = clamp01(allFold);
    const calledEquity = freerollRaiseCalledEquity(lockShare, unlockedEq, villainCallPrice);
    const ev =
      foldProb * pot +
      (1 - foldProb) * riskAdjustedCallUtility(calledEquity, potBeforeBet, effectiveWager, bf);

    const cand: FreerollRaiseCandidate = {
      raiseTo,
      heroAdded,
      effectiveWager,
      villainCallPrice,
      foldProb,
      calledEquity,
      ev,
    };
    candidates.push(cand);
    if (best === null || cand.ev > best.ev + EPS) {
      best = cand;
    }
  }

  if (!best) {
    return {
      action: 'call',
      raiseTo: 0,
      evRaise: evCall,
      evCall,
      totalEquity,
      foldProb: 0,
      bubbleFactor: bf,
      maxLegalRaiseTo,
      candidates,
      reason: 'no_legal_raise_call',
    };
  }

  if (best.ev > evCall + EPS) {
    return {
      action: 'raise',
      raiseTo: best.raiseTo,
      evRaise: best.ev,
      evCall,
      totalEquity,
      foldProb: best.foldProb,
      bubbleFactor: bf,
      maxLegalRaiseTo,
      candidates,
      reason: 'ev_raise_exceeds_ev_call',
    };
  }

  return {
    action: 'call',
    raiseTo: 0,
    evRaise: best.ev,
    evCall,
    totalEquity,
    foldProb: best.foldProb,
    bubbleFactor: bf,
    maxLegalRaiseTo,
    candidates,
    reason: 'ev_call_exceeds_or_equals_ev_raise',
  };
}
