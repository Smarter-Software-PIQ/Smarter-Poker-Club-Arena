/**
 * PRICED MULTI-BOARD NON-FREEROLL BET / CALL / RAISE / FOLD REPLACEMENT FOR UNOWNED V86
 * (2026-11-22, option `multiBoardNonFreerollIsPriced`, default OFF, OPTION_SWITCH_REFUSED /
 * zero SQL migrations).
 *
 * Replaces three unowned fixed-cliff / hash-coin-flip branches in HorseLogic.ts on multi-board
 * non-freeroll hands (`v86 && multiBoard36 && boardEq36.length >= 2 && lockShare36 < 1 / nBoards36`):
 *   1. `v86_multiboard_dead_half_fold`: fixed blanket fold
 *      `potFrac36 >= 0.6 && minBoardEq86 < 0.18 && maxBoardEq86 < 0.88` (which folded profitable
 *      calls whenever total multi-board equity exceeded pot odds + risk utility, e.g., 85%/15%
 *      = 50% total equity vs a 0.6x pot bet needing 27.3%).
 *   2. `v86_multiboard_or_plo8` facing-bet raise: fixed hash coin flip
 *      `potFrac36 <= 1.0 && boardEq >= 0.8 && minBoardEq >= 0.32 && v86Hash01 < 0.78` with
 *      hash-randomized sizing `0.88 + v86Hash01 * 0.12`.
 *   3. `v86_multiboard_or_plo8` open bet: fixed hash coin flip
 *      `!isRiver && barrelPlan !== true && boardEq >= 0.78 && minBoardEq >= 0.32 && v86Hash01 < 0.85`
 *      with hash-randomized sizing `0.78 + v86Hash01 * 0.14`.
 *
 * Pure, deterministic (zero `fastRandom()` draw, zero `v86Hash01()`), public-info-only (zero
 * opponent hole cards, zero `opponentHud/` import — uses `holdemEmpiricalPriors.ts` structural
 * `HoldemHudPacketOpponent` / `ExploitCounters` shrinkage).
 *
 * Pricing model:
 *   - Average multi-board equity: `E_avg = mean(boardEquities)`.
 *   - Risk-adjusted utility facing a wager `w` against pre-wager pot `P` under bubble factor `bf >= 1`
 *     and rake fraction `r in [0, 0.25]`:
 *       `U(e, P, w, bf, r) = e * ((1 - r) * (P + 2 * w) - w) - (1 - e) * bf * w`
 *     At `r = 0, bf = 1` (rake-free cash / chip EV), `U(e, P, w, 1, 0) === e * (P + 2 * w) - w`;
 *     at `bf = 1` with rake `r`, break-even equity is `w / ((P + 2 * w) * (1 - r))`.
 *   - Facing-bet decision (`argmax { EV(fold)=0, EV(call), max_r EV(raise, r) }`):
 *       - Continuous non-river `deadBoardRealizationPenalty` when `minBoardEq` is low and chips
 *         remain behind (`0` strictly on river and `0` when all-in; never a cliff fold).
 *       - `EV(fold) = 0`.
 *       - `EV(call) = U(E_call_realized, P0, effCall, bf, r)` where `P0 = max(0, pot - toCall)`
 *         (excludes villain's uncallable excess `toCall - effCall` on short-stack all-in calls).
 *       - `EV(raise, r) = F_raise(r) * pot * (1 - r_rake) + (1 - F_raise(r)) * U(E_called_raise(r), P0, effWager, bf, r_rake)`
 *         across legal raise-TO candidates (0.75x, 1.00x `(pot + toCall)`, effective max, and
 *         max-legal / all-in — strictly respecting `minRaise`, effective stack, Pot-Limit cap
 *         `currentBet + pot + toCall`, and `canRaise` / `!raisedAfterAggr`).
 *   - Open / checked-to decision (`max_b EV(bet, b)` vs `EV(check)`):
 *       - `EV(bet, b) = F(b) * pot * (1 - r_rake) + (1 - F(b)) * U(E_called(b), pot, effB, bf, r_rake)` across legal
 *         bet candidates (0.50, 0.75, 1.00, geometric, max-legal / all-in — strictly honoring
 *         `minBet`, `heroStack`, and Pot-Limit `pot` cap).
 *       - `EV(check) = B * max(0, U(E_free, pot, stabSize, bf, r_rake)) + (1 - B) * E_free * pot * (1 - r_rake)` using
 *         shrunk `betWhenCheckedTo` priors and continuous free-card equity erosion (`0` on river).
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
export const NON_FREEROLL_STAB_POT_FRAC = 0.55;

/** Standard open-bet pot fractions evaluated alongside geometric sizing and max-legal / all-in. */
export const NON_FREEROLL_OPEN_BET_FRACTIONS: readonly number[] = Object.freeze([0.5, 0.75, 1.0]);

/** Standard raise-increment fractions of `(pot + toCall)` evaluated alongside max-legal / all-in. */
export const NON_FREEROLL_RAISE_POT_FRACTIONS: readonly number[] = Object.freeze([0.75, 1.0]);

/** Smooth dead-board realization penalty starts below this min-board equity on non-river streets. */
export const DEAD_BOARD_EQUITY_THRESHOLD = 0.25;

/** Maximum continuous realization penalty on non-river streets when completely dead on a board. */
export const MAX_DEAD_BOARD_REALIZATION_PENALTY = 0.14;

export type MultiBoardNonFreerollStreet = 'flop' | 'turn' | 'river';

export type MultiBoardNonFreerollOpenReason =
  | 'ev_bet_exceeds_ev_check'
  | 'ev_check_exceeds_or_equals_ev_bet'
  | 'no_legal_bet_check'
  | 'degenerate_pot_or_stack';

export type MultiBoardNonFreerollFacingReason =
  | 'ev_raise_exceeds_call_and_fold'
  | 'ev_call_exceeds_fold_and_raise'
  | 'ev_fold_exceeds_or_equals_continue'
  | 'degenerate_pot_or_stack';

export interface NonFreerollOpponentInput {
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  readonly exploitCounters?: Pick<
    ExploitCounters,
    'foldToBet' | 'foldToBetOpp' | 'betCheckedTo' | 'betCheckedToOpp' | 'riverCall' | 'riverCallOpp'
  > | null;
  /** False when this opponent is already all-in (cannot fold or stab). Defaults to true. */
  readonly canRespond?: boolean;
}

export interface NonFreerollBetCandidate {
  readonly amount: number;
  readonly effectiveWager: number;
  readonly potFraction: number;
  readonly foldProb: number;
  readonly calledEquity: number;
  readonly ev: number;
}

export interface NonFreerollRaiseCandidate {
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

export interface DeadBoardRealizationPenaltyInput {
  readonly boardEquities: readonly number[];
  readonly street: MultiBoardNonFreerollStreet;
  readonly inPosition: boolean;
  readonly oppCount: number;
  /** Remaining effective stack behind AFTER the current call or raise (`0` when all-in). */
  readonly effectiveBehindAfterAction: number;
  /** Resulting pot size AFTER the current call or raise. */
  readonly potAfterAction: number;
}

export interface PriceMultiBoardNonFreerollOpenInput {
  /** Per-board equities (`boardEq36`, length >= 2), each in `[0, 1]`. */
  readonly boardEquities: readonly number[];
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
  readonly street: MultiBoardNonFreerollStreet;
  /** Whether hero acts in position. */
  readonly inPosition: boolean;
  /** Effective stack-to-pot ratio (optional). */
  readonly spr?: number;
  /** Public flop board texture (optional, used on flop). */
  readonly flopTexture?: HoldemFlopTexture;
  /** Hero tournament/Spin bubble factor (`>= 1`). Null/undefined/`<= 1` resolves to chip EV (`1`). */
  readonly heroBubbleFactor?: number | null;
  /** Optional rake/deduction fraction on pot won, clamped to `[0, 0.25]`. Defaults to `0`. */
  readonly rakeFraction?: number;
  /** Optional per-opponent public HUD packet and/or HorseMind exploit counters. */
  readonly opponents?: readonly NonFreerollOpponentInput[];
}

export interface PriceMultiBoardNonFreerollOpenResult {
  readonly action: 'bet' | 'check';
  /** Chosen legal bet amount in chips when `action === 'bet'`, else `0`. */
  readonly betAmount: number;
  readonly evBet: number;
  readonly evCheck: number;
  readonly averageEquity: number;
  readonly freeCardEquity: number;
  readonly foldProb: number;
  readonly stabProb: number;
  readonly bubbleFactor: number;
  readonly candidates: readonly NonFreerollBetCandidate[];
  readonly reason: MultiBoardNonFreerollOpenReason;
}

export interface PriceMultiBoardNonFreerollFacingBetInput {
  /** Per-board equities (`boardEq36`, length >= 2), each in `[0, 1]`. */
  readonly boardEquities: readonly number[];
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
  readonly street: MultiBoardNonFreerollStreet;
  /** Whether hero acts in position. */
  readonly inPosition: boolean;
  /** False when hero was already raised after showing aggression (`raisedAfterAggr`). Defaults to true. */
  readonly canRaise?: boolean;
  /** Hero tournament/Spin bubble factor (`>= 1`). Null/undefined/`<= 1` resolves to chip EV (`1`). */
  readonly heroBubbleFactor?: number | null;
  /** Optional rake/deduction fraction on pot won, clamped to `[0, 0.25]`. Defaults to `0`. */
  readonly rakeFraction?: number;
  /** Optional per-opponent public HUD packet and/or HorseMind exploit counters. */
  readonly opponents?: readonly NonFreerollOpponentInput[];
}

export interface PriceMultiBoardNonFreerollFacingBetResult {
  readonly action: 'fold' | 'call' | 'raise';
  /** Chosen legal raise-TO amount in chips when `action === 'raise'`, else `0`. */
  readonly raiseTo: number;
  readonly evFold: 0;
  readonly evCall: number;
  readonly evRaise: number;
  readonly averageEquity: number;
  readonly callRealizedEquity: number;
  readonly deadBoardPenalty: number;
  readonly foldProb: number;
  readonly bubbleFactor: number;
  readonly maxLegalRaiseTo: number;
  readonly candidates: readonly NonFreerollRaiseCandidate[];
  readonly reason: MultiBoardNonFreerollFacingReason;
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

/** Maximum accepted rake/deduction fraction (25%). */
export const MAX_NON_FREEROLL_RAKE_FRACTION = 0.25;

function resolveRakeFraction(rakeFraction: number | null | undefined): number {
  return typeof rakeFraction === 'number' && Number.isFinite(rakeFraction)
    ? clampRange(rakeFraction, 0, MAX_NON_FREEROLL_RAKE_FRACTION)
    : 0;
}

function sanitizeBoardEquities(boardEquities: readonly number[]): number[] {
  if (!boardEquities || boardEquities.length === 0) return [];
  return boardEquities.map(clamp01);
}

/**
 * Classify public flop texture from the board cards (first three cards).
 * Pure public-board helper: never inspects hole cards.
 */
export function classifyNonFreerollFlopTexture(
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
 * Mean equity across all boards: `E_avg = mean(boardEquities)`.
 */
export function multiBoardAverageEquity(boardEquities: readonly number[]): number {
  const eqs = sanitizeBoardEquities(boardEquities);
  if (eqs.length === 0) return 0;
  let sum = 0;
  for (const e of eqs) sum += e;
  return clamp01(sum / eqs.length);
}

/**
 * Risk-adjusted expected utility of contesting a wager `wager` into pre-wager `pot` with equity
 * `equity` under tournament bubble factor `bubbleFactor >= 1` and pot rake fraction
 * `rakeFraction in [0, 0.25]`:
 *   win branch (prob `equity`):      (1 - rakeFraction) * (pot + 2 * wager) - wager
 *   lose branch (prob `1 - equity`): -bubbleFactor * wager
 * At `rakeFraction = 0, bubbleFactor = 1`, reduces identically to `equity * (pot + 2 * wager) - wager`.
 * At `bubbleFactor = 1`, break-even equity is `wager / ((pot + 2 * wager) * (1 - rakeFraction))`,
 * matching `HorseLogic`'s downstream raked pot-odds formula.
 */
export function riskAdjustedUtility(
  equity: number,
  pot: number,
  wager: number,
  bubbleFactor: number,
  rakeFraction: number = 0
): number {
  const e = clamp01(equity);
  const p = sanitizePositive(pot);
  const w = sanitizePositive(wager);
  const bf = resolveBubbleFactor(bubbleFactor);
  const r = resolveRakeFraction(rakeFraction);
  return e * ((1 - r) * (p + 2 * w) - w) - (1 - e) * bf * w;
}

/**
 * Continuous future-street equity realization discount when hero is nearly dead on one board
 * (`minBoardEq < 0.25`) on a non-river street with chips remaining behind.
 *
 * Strictly `0` on the river (no cards remain) and `0` when calling/raising all-in (zero future
 * betting pressure). Smoothly increases as `minBoardEq` approaches `0`, when the strongest board
 * is itself vulnerable (`maxBoardEq < 0.95`), on flop vs turn, out of position, and multiway.
 * Never introduces a hard cliff fold.
 */
export function deadBoardRealizationPenalty(input: DeadBoardRealizationPenaltyInput): number {
  if (input.street === 'river') return 0;
  const eqs = sanitizeBoardEquities(input.boardEquities);
  if (eqs.length < 2) return 0;
  const behind = sanitizePositive(input.effectiveBehindAfterAction);
  if (!(behind > 0)) return 0;

  let minEq = 1;
  let maxEq = 0;
  for (const e of eqs) {
    if (e < minEq) minEq = e;
    if (e > maxEq) maxEq = e;
  }
  if (minEq >= DEAD_BOARD_EQUITY_THRESHOLD) return 0;

  const deadShortfall = clamp01(
    (DEAD_BOARD_EQUITY_THRESHOLD - minEq) / DEAD_BOARD_EQUITY_THRESHOLD
  );
  const vulnerability = clamp01((0.95 - maxEq) / 0.7);
  const streetMul = input.street === 'flop' ? 1.0 : 0.65;
  const posMul = input.inPosition ? 0.8 : 1.15;
  const opps = Math.max(1, Math.floor(Number.isFinite(input.oppCount) ? input.oppCount : 1));
  const multiwayMul = Math.min(1.4, 1 + 0.18 * (opps - 1));
  const potRef = Math.max(1, sanitizePositive(input.potAfterAction));
  const futureDepthMul = clamp01(behind / potRef);

  const raw =
    MAX_DEAD_BOARD_REALIZATION_PENALTY *
    deadShortfall *
    (0.35 + 0.65 * vulnerability) *
    streetMul *
    posMul *
    multiwayMul *
    futureDepthMul;
  return clampRange(raw, 0, MAX_DEAD_BOARD_REALIZATION_PENALTY);
}

/**
 * Continuous free-card equity erosion across boards when hero checks instead of betting.
 * Strictly `0` on the river (no further cards); smoothly increases with wetness, opponent count,
 * and turn vs flop.
 */
export function nonFreerollFreeCardPenalty(
  wetness: number,
  oppCount: number,
  street: MultiBoardNonFreerollStreet
): number {
  if (street === 'river') return 0;
  const w = clamp01(wetness);
  const opps = Math.max(1, Math.floor(Number.isFinite(oppCount) ? oppCount : 1));
  const streetMul = street === 'turn' ? 1.15 : 1.0;
  const basePenalty = 0.015 + 0.12 * w;
  const multiwayMul = 1 + 0.55 * (opps - 1);
  return Math.min(0.35, basePenalty * multiwayMul * streetMul);
}

/**
 * Quantile-exact top-MDF continuing-range equity for a single board with raw equity `e` facing a
 * continuing range tightened by factor `tightening >= 1` (`1 / c`, where `c` is the top fraction
 * of villain's range that continues):
 *   - Exact quantile win-share against top-`c` range: `q = max(0, 1 - (1 - e) * tightening)`
 *   - Smooth Bayesian odds-ratio residual:            `b = e / (e + (1 - e) * tightening)`
 * Blending `0.70 * q + 0.30 * b` preserves `0 -> 0`, `1 -> 1`, strict monotonicity in `e`, and
 * prevents unlocked hands (`e < 1`) from ever hallucinating profitable deep-stack overbet shoves.
 */
function tightenBoardEquity(equity: number, tightening: number): number {
  const e = clamp01(equity);
  if (e <= 0 || e >= 1) return e;
  const t = Number.isFinite(tightening) && tightening > 1 ? tightening : 1;
  const quantileEq = Math.max(0, 1 - (1 - e) * t);
  const bayesEq = e / (e + (1 - e) * t);
  return clamp01(0.7 * quantileEq + 0.3 * bayesEq);
}

/**
 * Conservative multi-board equity when an open bet of `potFraction` is called.
 * Each board's equity tightens via top-MDF quantile truncation (`tightening = 1 + 0.90 * f`)
 * without artificial cap as `potFraction` grows, preventing deep-stack NLH overbet spew
 * while preserving full value sizing around geometric / pot-sized bets.
 */
export function nonFreerollOpenCalledEquity(
  boardEquities: readonly number[],
  potFraction: number
): number {
  const eqs = sanitizeBoardEquities(boardEquities);
  if (eqs.length === 0) return 0;
  const f = Number.isFinite(potFraction) ? Math.max(0, potFraction) : 0;
  const tightening = 1 + 0.9 * f;
  let sum = 0;
  for (const e of eqs) sum += tightenBoardEquity(e, tightening);
  return clamp01(sum / eqs.length);
}

/**
 * Conservative multi-board equity when a raise laying villain `villainCallPrice` and risking
 * `raisePotRatio` (`oppCall / (pot + toCall)`) is called. Uses exact top-MDF quantile tightening
 * so deep-stack NLH overbet shoves face the top of villain's continuing range rather than
 * saturating at `villainCallPrice <= 0.50`.
 */
export function nonFreerollRaiseCalledEquity(
  boardEquities: readonly number[],
  villainCallPrice: number,
  raisePotRatio?: number
): number {
  const eqs = sanitizeBoardEquities(boardEquities);
  if (eqs.length === 0) return 0;
  const price = clamp01(villainCallPrice);
  const tightening =
    typeof raisePotRatio === 'number' && Number.isFinite(raisePotRatio) && raisePotRatio >= 0
      ? 1 + 0.9 * raisePotRatio
      : 1 + 1.8 * price;
  let sum = 0;
  for (const e of eqs) sum += tightenBoardEquity(e, tightening);
  return clamp01(sum / eqs.length);
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
 * relative to smaller bets in the same band while staying bounded in `[0.02, 0.78]`.
 */
function smoothSizeFoldAdjustment(baseFold: number, potFraction: number, nBoards: number): number {
  const f = Number.isFinite(potFraction) ? clampRange(potFraction, 0.05, 1.5) : 0.5;
  const price = f / (1 + 2 * f);
  const refPrice = f <= 0.4 + EPS ? 0.33 / 1.66 : f <= 0.7 + EPS ? 0.55 / 2.1 : 0.85 / 2.7;
  const elasticity = Math.pow(clampRange(price / refPrice, 0.65, 1.25), 0.35);
  // Opponents in multi-board pots have N boards to catch continuing equity on.
  const multiBoardAttenuation = 1 / (1 + 0.35 * Math.max(0, nBoards - 1));
  return clampRange(baseFold * elasticity * multiBoardAttenuation, 0.02, 0.78);
}

function estimateSingleOpponentOpenFold(
  street: MultiBoardNonFreerollStreet,
  inPosition: boolean,
  potFraction: number,
  headsUp: boolean,
  nBoards: number,
  flopTexture: HoldemFlopTexture | undefined,
  spr: number | undefined,
  opp: NonFreerollOpponentInput | undefined
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
  return smoothSizeFoldAdjustment(baseFold, potFraction, nBoards);
}

function estimateSingleOpponentRaiseFold(
  street: MultiBoardNonFreerollStreet,
  inPosition: boolean,
  villainCallPrice: number,
  isAllInRaise: boolean,
  nBoards: number,
  minBoardEq: number,
  opp: NonFreerollOpponentInput | undefined
): number {
  if (opp?.canRespond === false) return 0;

  let singleBoardFold: number;
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
        singleBoardFold = empiricalBayesShrink(
          riverFolds,
          opp.exploitCounters.riverCallOpp,
          baseEst.mean,
          HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
          'exploit_counters'
        ).mean;
      } else if (opp.exploitCounters.foldToBetOpp > 0) {
        singleBoardFold = empiricalBayesShrink(
          opp.exploitCounters.foldToBet,
          opp.exploitCounters.foldToBetOpp,
          baseEst.mean,
          HOLDEM_PRIOR_STRENGTH.riverFoldToRaise * 1.5,
          'exploit_counters'
        ).mean;
      } else {
        singleBoardFold = baseEst.mean;
      }
    } else {
      singleBoardFold = baseEst.mean;
    }
  } else {
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
      singleBoardFold = empiricalBayesShrink(
        hudRaise.hits,
        hudRaise.opportunities,
        prior,
        HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
        'hud_context'
      ).mean;
    } else {
      const betKey = street === 'flop' ? 'f.fBet' : 't.fBet';
      const hudBet = readHudOpponentStat(opp?.hudOpp, betKey);
      if (hudBet) {
        singleBoardFold = empiricalBayesShrink(
          hudBet.hits,
          hudBet.opportunities,
          prior,
          HOLDEM_PRIOR_STRENGTH.riverFoldToRaise * 2,
          'hud_street'
        ).mean;
      } else if (opp?.exploitCounters && opp.exploitCounters.foldToBetOpp > 0) {
        singleBoardFold = empiricalBayesShrink(
          opp.exploitCounters.foldToBet,
          opp.exploitCounters.foldToBetOpp,
          prior,
          HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
          'exploit_counters'
        ).mean;
      } else {
        singleBoardFold = prior;
      }
    }
  }

  // Bettors in multi-board pots hold continuing equity on at least one of N boards (on the river,
  // hands are final with no draws to fold); when hero is nearly dead on one board, villain is even
  // more likely to hold a winning/chopping hand there and continue against a raise.
  const multiBoardSlope = street === 'river' ? 1.15 : 0.65;
  const multiBoardScale = 1 / (1 + multiBoardSlope * Math.max(0, nBoards - 1));
  const deadBoardFloor = street === 'river' ? 0.3 : 0.5;
  const deadBoardScale = deadBoardFloor + (1 - deadBoardFloor) * clamp01(minBoardEq / 0.35);
  return clampRange(singleBoardFold * multiBoardScale * deadBoardScale, 0.01, 0.75);
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
 * Deterministic EV pricing for an OPEN / CHECKED-TO non-freeroll multi-board hand
 * (`v86 && multiBoard36 && !isRiver && barrelPlan !== true && lockShare36 < 1 / nBoards36`).
 * Compares legal candidate bet sizes (0.50, 0.75, 1.00, geometric, max-legal / all-in — strictly
 * respecting `minBet`, `heroStack`, and Pot-Limit `pot` cap) against checking.
 * Zero RNG, zero `v86Hash01()`, public-info-only.
 */
export function priceMultiBoardNonFreerollOpen(
  input: PriceMultiBoardNonFreerollOpenInput
): PriceMultiBoardNonFreerollOpenResult {
  const eqs = sanitizeBoardEquities(input.boardEquities);
  const nBoards = Math.max(2, eqs.length);
  const averageEquity = multiBoardAverageEquity(eqs);
  const bf = resolveBubbleFactor(input.heroBubbleFactor);
  const rakeFraction = resolveRakeFraction(input.rakeFraction);
  const netPotFactor = 1 - rakeFraction;
  const opps = Math.max(1, Math.floor(Number.isFinite(input.oppCount) ? input.oppCount : 1));
  const penalty = nonFreerollFreeCardPenalty(input.wetness, opps, input.street);
  const freeCardEquity = clamp01(averageEquity * (1 - penalty));

  const pot = sanitizePositive(input.pot);
  const heroStack = sanitizePositive(input.heroStack);
  const effectiveStack = Math.min(heroStack, sanitizePositive(input.effectiveStack));
  const minBet = Math.max(sanitizePositive(input.minBet), 0.01);

  if (!(pot > 0) || !(heroStack > 0) || !(effectiveStack > 0) || eqs.length < 2) {
    return {
      action: 'check',
      betAmount: 0,
      evBet: 0,
      evCheck: freeCardEquity * pot * netPotFactor,
      averageEquity,
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
  const stabSize = Math.min(effectiveStack, maxLegalBet, NON_FREEROLL_STAB_POT_FRAC * pot);

  let noneStabProb = 1;
  for (let i = 0; i < opps; i++) {
    const opp = input.opponents?.[i];
    if (opp?.canRespond === false) continue;
    const stabEst = estimateHoldemBetWhenCheckedTo(input.street, opp?.hudOpp, opp?.exploitCounters);
    noneStabProb *= 1 - clamp01(stabEst.mean);
  }
  const stabProb = clamp01(1 - noneStabProb);
  // Hero always retains the option to fold to a stab (`EV = 0`) if calling the stab is -EV.
  const evVsStab = Math.max(
    0,
    riskAdjustedUtility(freeCardEquity, pot, stabSize, bf, rakeFraction)
  );
  const evCheck = stabProb * evVsStab + (1 - stabProb) * freeCardEquity * pot * netPotFactor;

  const rawAmounts: number[] = [];
  if (maxLegalBet >= minBet) {
    const fracs: number[] = [...NON_FREEROLL_OPEN_BET_FRACTIONS];
    if (
      typeof input.geomFrac === 'number' &&
      Number.isFinite(input.geomFrac) &&
      input.geomFrac > 0
    ) {
      fracs.push(input.geomFrac);
    }
    for (const frac of fracs) {
      rawAmounts.push(clampRange(pot * frac, minBet, maxLegalBet));
    }
    rawAmounts.push(clampRange(Math.min(effectiveStack, maxLegalBet), minBet, maxLegalBet));
  } else if (heroStack > 0 && (!input.isPotLimit || heroStack <= pot + 0.005)) {
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
      averageEquity,
      freeCardEquity,
      foldProb: 0,
      stabProb,
      bubbleFactor: bf,
      candidates: [],
      reason: 'no_legal_bet_check',
    };
  }

  const headsUp = opps === 1;
  const candidates: NonFreerollBetCandidate[] = [];
  let best: NonFreerollBetCandidate | null = null;

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
        nBoards,
        input.flopTexture,
        input.spr,
        opp
      );
    }
    const foldProb = clamp01(allFold);
    const calledEquity = nonFreerollOpenCalledEquity(eqs, potFraction);
    const ev =
      foldProb * pot * netPotFactor +
      (1 - foldProb) * riskAdjustedUtility(calledEquity, pot, effectiveWager, bf, rakeFraction);

    const cand: NonFreerollBetCandidate = {
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
      averageEquity,
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
      averageEquity,
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
    averageEquity,
    freeCardEquity,
    foldProb: best.foldProb,
    stabProb,
    bubbleFactor: bf,
    candidates,
    reason: 'ev_check_exceeds_or_equals_ev_bet',
  };
}

/**
 * Deterministic EV pricing for a FACING-BET non-freeroll multi-board hand
 * (`v86 && multiBoard36 && boardEq36.length >= 2 && lockShare36 < 1 / nBoards36`).
 *
 * Replaces BOTH `v86_multiboard_dead_half_fold` (fixed cliff fold) AND `v86_multiboard_or_plo8`
 * facing-bet raise (`v86Hash01 < 0.78`) with exact `argmax { EV(fold)=0, EV(call), max_r EV(raise, r) }`.
 * Zero RNG, zero `v86Hash01()`, public-info-only.
 */
export function priceMultiBoardNonFreerollFacingBet(
  input: PriceMultiBoardNonFreerollFacingBetInput
): PriceMultiBoardNonFreerollFacingBetResult {
  const eqs = sanitizeBoardEquities(input.boardEquities);
  const nBoards = Math.max(2, eqs.length);
  const averageEquity = multiBoardAverageEquity(eqs);
  const minBoardEq = eqs.length > 0 ? Math.min(...eqs) : 0;
  const bf = resolveBubbleFactor(input.heroBubbleFactor);
  const rakeFraction = resolveRakeFraction(input.rakeFraction);
  const netPotFactor = 1 - rakeFraction;
  const opps = Math.max(1, Math.floor(Number.isFinite(input.oppCount) ? input.oppCount : 1));
  const canRaise = input.canRaise !== false;

  const pot = sanitizePositive(input.pot);
  const currentBet = sanitizePositive(input.currentBet);
  const playerBet = sanitizePositive(input.playerBet);
  const toCall = sanitizePositive(input.toCall);
  const minRaise = Math.max(sanitizePositive(input.minRaise), 0.01);
  const heroStack = sanitizePositive(input.heroStack);
  const deepestOppStack = sanitizePositive(input.deepestOppStack);

  const effCall = Math.min(toCall, heroStack);
  // Pre-bet pot before villain's wager: subtracts full `toCall` so any uncallable excess
  // (`toCall - effCall`, returned to villain on a short-stack all-in call) never inflates EV(call).
  const potBeforeBet = Math.max(0, pot - toCall);
  const behindAfterCall = Math.max(0, Math.min(heroStack - effCall, deepestOppStack));
  const deadBoardPenalty = deadBoardRealizationPenalty({
    boardEquities: eqs,
    street: input.street,
    inPosition: input.inPosition,
    oppCount: opps,
    effectiveBehindAfterAction: behindAfterCall,
    potAfterAction: potBeforeBet + 2 * effCall,
  });
  const callRealizedEquity = clamp01(averageEquity - deadBoardPenalty);
  const evCall = riskAdjustedUtility(callRealizedEquity, potBeforeBet, effCall, bf, rakeFraction);

  const maxRaiseToByStack = floorCents(playerBet + heroStack);
  const maxRaiseToByPotLimit = input.isPotLimit
    ? floorCents(potLimitRaiseTo(pot, currentBet, toCall))
    : Infinity;
  const maxLegalRaiseTo = Math.min(maxRaiseToByStack, maxRaiseToByPotLimit);
  const minRaiseTo = roundCents(currentBet + minRaise);

  if (!(pot > 0) || !(heroStack > 0) || !(toCall > 0) || eqs.length < 2) {
    return {
      action: evCall > EPS ? 'call' : 'fold',
      raiseTo: 0,
      evFold: 0,
      evCall,
      evRaise: 0,
      averageEquity,
      callRealizedEquity,
      deadBoardPenalty,
      foldProb: 0,
      bubbleFactor: bf,
      maxLegalRaiseTo,
      candidates: [],
      reason: 'degenerate_pot_or_stack',
    };
  }

  const candidates: NonFreerollRaiseCandidate[] = [];
  let bestRaise: NonFreerollRaiseCandidate | null = null;

  if (
    canRaise &&
    heroStack > toCall + EPS &&
    deepestOppStack > 0 &&
    maxLegalRaiseTo + EPS >= minRaiseTo
  ) {
    const potAfterCall = pot + toCall;
    const rawRaiseTos: number[] = [];
    for (const frac of NON_FREEROLL_RAISE_POT_FRACTIONS) {
      rawRaiseTos.push(clampRange(currentBet + frac * potAfterCall, minRaiseTo, maxLegalRaiseTo));
    }
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
          nBoards,
          minBoardEq,
          opp
        );
      }
      const foldProb = clamp01(allFold);
      const raisePotRatio = oppCall / Math.max(1, potAfterCall);
      const baseCalledEq = nonFreerollRaiseCalledEquity(eqs, villainCallPrice, raisePotRatio);
      const behindAfterRaise = Math.max(
        0,
        Math.min(heroStack - heroAdded, deepestOppStack - oppCall)
      );
      const raiseDeadPenalty = deadBoardRealizationPenalty({
        boardEquities: eqs,
        street: input.street,
        inPosition: input.inPosition,
        oppCount: opps,
        effectiveBehindAfterAction: behindAfterRaise,
        potAfterAction: pot + effectiveWager + oppCall,
      });
      const calledEquity = clamp01(baseCalledEq - raiseDeadPenalty);
      const ev =
        foldProb * pot * netPotFactor +
        (1 - foldProb) *
          riskAdjustedUtility(calledEquity, potBeforeBet, effectiveWager, bf, rakeFraction);

      const cand: NonFreerollRaiseCandidate = {
        raiseTo,
        heroAdded,
        effectiveWager,
        villainCallPrice,
        foldProb,
        calledEquity,
        ev,
      };
      candidates.push(cand);
      if (bestRaise === null || cand.ev > bestRaise.ev + EPS) {
        bestRaise = cand;
      }
    }
  }

  const bestRaiseEv = bestRaise ? bestRaise.ev : -Infinity;
  const bestNonRaiseEv = Math.max(0, evCall);

  if (bestRaise && bestRaise.ev > bestNonRaiseEv + EPS) {
    return {
      action: 'raise',
      raiseTo: bestRaise.raiseTo,
      evFold: 0,
      evCall,
      evRaise: bestRaise.ev,
      averageEquity,
      callRealizedEquity,
      deadBoardPenalty,
      foldProb: bestRaise.foldProb,
      bubbleFactor: bf,
      maxLegalRaiseTo,
      candidates,
      reason: 'ev_raise_exceeds_call_and_fold',
    };
  }

  if (evCall > EPS) {
    return {
      action: 'call',
      raiseTo: 0,
      evFold: 0,
      evCall,
      evRaise: Number.isFinite(bestRaiseEv) ? bestRaiseEv : evCall,
      averageEquity,
      callRealizedEquity,
      deadBoardPenalty,
      foldProb: bestRaise ? bestRaise.foldProb : 0,
      bubbleFactor: bf,
      maxLegalRaiseTo,
      candidates,
      reason: 'ev_call_exceeds_fold_and_raise',
    };
  }

  return {
    action: 'fold',
    raiseTo: 0,
    evFold: 0,
    evCall,
    evRaise: Number.isFinite(bestRaiseEv) ? bestRaiseEv : 0,
    averageEquity,
    callRealizedEquity,
    deadBoardPenalty,
    foldProb: bestRaise ? bestRaise.foldProb : 0,
    bubbleFactor: bf,
    maxLegalRaiseTo,
    candidates,
    reason: 'ev_fold_exceeds_or_equals_continue',
  };
}
