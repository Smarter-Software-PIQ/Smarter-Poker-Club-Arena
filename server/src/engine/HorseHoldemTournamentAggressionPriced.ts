/**
 * HOLD'EM TOURNAMENT AGGRESSION — EV & ICM PRICED POSTFLOP REPLACEMENT
 * (2026-11-22, Horse Switch lane, Wave 10.1, option `holdemTournamentAggressionIsPriced`,
 * default OFF, read strictly `=== true`, dark in `OPTION_SWITCH_REFUSED`, zero SQL migrations).
 *
 * Replaces the four postflop NLH tournament blanket overrides gated on `v57TournamentAggression`
 * with pure deterministic EV + ICM pricing backed by `holdemEmpiricalPriors.ts`:
 *   1. `planBarrel` (flat 50% coin-flip) -> `priceHoldemTournamentBarrelPlan`
 *   2. `v58_low_spr_stack_off` (blind `effBehind <= pot && equity >= 0.45 + 0.5*mw` jam) ->
 *      `priceHoldemTournamentLowSprDecision`
 *   3. `V7 BARREL CONTINUATION` (`0.66`/`0.42` continuation coin-flip & `0.65` give-up coin-flip) +
 *      `initiativeTurn57` non-initiative-aware 16% turn cell bypass ->
 *      `priceHoldemTournamentBarrelContinue`
 *   4. `v58_one_card_low_flush_fold` (unconditional fold on 4-flush board with >=3 higher flush
 *      ranks when committing >= 50% stack) -> `priceHoldemTournamentOneCardFlushCall`
 *
 * Strict scope:
 *   - Single-board 2-card NLH tournaments, postflop ONLY (flop / turn / river).
 *   - Preflop `v57TournamentAggression` (`HorsePreflop.ts`), `v58MadeHandCellSkip`, cash,
 *     Lightning, Omaha (PLO4/5/6, Hi-Lo), Short Deck, Fixed Limit, Pot Limit, multi-board,
 *     bomb pots, and All-In-or-Fold are 100% untouched.
 *   - Zero RNG draws (100% deterministic).
 *   - Zero `opponentHud/` module imports (structurally accepts `HoldemHudPacketOpponent` via
 *     `holdemEmpiricalPriors.ts` only).
 *   - Independent of `opts.v57TournamentAggression`: when `holdemTournamentAggressionIsPriced`
 *     is `true`, the postflop decision is identical whether `v57TournamentAggression` is `true`,
 *     `false`, or `undefined`. When `holdemTournamentAggressionIsPriced` is unset or `false`,
 *     nothing in this module is ever entered (0 bytes of live behavior change).
 */

import type { Card } from '../types.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT,
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemFlopCbetFold,
  estimateHoldemRiverBluffShare,
  estimateHoldemTurnBetFold,
  readHudOpponentStat,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
  type HoldemRiverSizeBand,
} from './holdemEmpiricalPriors.js';

export type HoldemTournamentPostflopStreet = 'flop' | 'turn' | 'river';

export interface HoldemTournamentAggroScopeInput {
  readonly enabled: boolean | undefined;
  readonly isTournament: boolean;
  readonly isCashFormat: boolean;
  readonly street: string;
  readonly isOmaha: boolean;
  readonly isPotLimit: boolean;
  readonly isFixedLimit: boolean;
  readonly isShortDeck: boolean;
  readonly isHiLo: boolean;
  readonly holeCount: number;
  readonly holeCardCount: number;
  readonly boardLength: number;
  readonly multiBoard: boolean;
  readonly bombPot: boolean;
  readonly allInOrFold: boolean;
  readonly pot: number;
  readonly heroStack: number;
}

export interface HoldemTournamentVillainRead {
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  readonly exploitCounters?: Pick<
    ExploitCounters,
    'foldToBet' | 'foldToBetOpp' | 'betCheckedTo' | 'betCheckedToOpp'
  > | null;
  readonly styleSizeShown?: { readonly shown: number; readonly strong: number } | null;
  readonly riverFoldRate?: number | null;
  readonly exploitCallDownMod?: number;
}

export interface HoldemTournamentBarrelPlanInput {
  readonly street: 'flop' | 'turn';
  readonly equity: number;
  readonly pot: number;
  readonly heroStack: number;
  readonly effBehind: number;
  readonly currentBetApprox: number;
  readonly inPosition: boolean;
  readonly oppCount: number;
  readonly wetness: number;
  readonly drawsLive: boolean;
  readonly blocker: boolean;
  readonly icmRisk: number;
  readonly bubblePressure: number;
  readonly ownBountyScale: number;
  readonly bountyCoverDiscount?: number;
  readonly villain?: HoldemTournamentVillainRead | null;
}

export interface HoldemTournamentBarrelPlanVerdict {
  readonly shouldPlan: boolean;
  readonly evBarrel: number;
  readonly evGiveUp: number;
  readonly pFoldAll: number;
  readonly eqCalled: number;
  readonly icmLossMult: number;
}

export interface HoldemTournamentLowSprInput {
  readonly street: 'flop' | 'turn';
  readonly equity: number;
  readonly cat: number;
  readonly pot: number;
  readonly heroStack: number;
  readonly effBehind: number;
  readonly minBet: number;
  readonly inPosition: boolean;
  readonly hasInitiative?: boolean;
  readonly oppCount: number;
  readonly wetness: number;
  readonly texture: HoldemFlopTexture;
  readonly drawsLive: boolean;
  readonly icmRisk: number;
  readonly bubblePressure: number;
  readonly ownBountyScale: number;
  readonly bountyCoverDiscount?: number;
  readonly villain?: HoldemTournamentVillainRead | null;
}

export interface HoldemTournamentLowSprVerdict {
  readonly action: 'all_in' | 'bet' | 'check';
  readonly betFraction: number | null;
  readonly evCheck: number;
  readonly evJam: number;
  readonly evBest: number;
  readonly pFoldAll: number;
  readonly eqCalled: number;
  readonly icmLossMult: number;
}

export interface HoldemTournamentBarrelContinueInput {
  readonly street: 'turn' | 'river';
  readonly equity: number;
  readonly pot: number;
  readonly heroStack: number;
  readonly effBehind: number;
  readonly minBet: number;
  readonly inPosition: boolean;
  readonly oppCount: number;
  readonly playersBehind: number;
  readonly wetness: number;
  readonly drawsLive: boolean;
  readonly blocker: boolean;
  readonly dangered: boolean;
  readonly barrelPlan: boolean;
  readonly outlook: 'good' | 'scare' | 'blank' | undefined;
  readonly geomFrac: number;
  readonly icmRisk: number;
  readonly bubblePressure: number;
  readonly ownBountyScale: number;
  readonly bountyCoverDiscount?: number;
  readonly lightCallerBluffMul?: number;
  readonly selfImageMod?: number;
  readonly villain?: HoldemTournamentVillainRead | null;
}

export interface HoldemTournamentBarrelContinueVerdict {
  readonly action: 'bet' | 'check';
  readonly betFraction: number | null;
  readonly evCheck: number;
  readonly evBestBet: number;
  readonly pFoldAll: number;
  readonly eqCalled: number;
  readonly icmLossMult: number;
}

export interface HoldemTournamentOneCardFlushCallInput {
  readonly street: 'turn' | 'river';
  /** Pot ALREADY includes villain's outstanding bet (matches HorseLogic.ts `pot`). */
  readonly pot: number;
  readonly toCall: number;
  readonly heroStack: number;
  /** Villain's bet as a fraction of the pot before the bet. */
  readonly potFrac: number;
  readonly higherFlushRanks: number;
  readonly oppCount: number;
  readonly pairedBoard: boolean;
  readonly raisedAfterAggr: boolean;
  readonly icmRisk: number;
  readonly bountyCoverDiscount?: number;
  readonly villain?: HoldemTournamentVillainRead | null;
}

export interface HoldemTournamentOneCardFlushCallVerdict {
  readonly action: 'call' | 'fold';
  readonly evCall: number;
  readonly posteriorEquity: number;
  readonly requiredEquity: number;
  readonly bluffShare: number;
  readonly icmLossMult: number;
}

const EPS = 1e-9;

function finiteOr(x: number | undefined | null, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function riverFirstBetBand(potFraction: number): HoldemRiverSizeBand {
  const f = Math.max(0, finiteOr(potFraction, 0));
  if (f <= 1 / 3 + EPS) return 'le_33';
  if (f <= 2 / 3 + EPS) return '34_67';
  if (f <= 1 + EPS) return '67_100';
  return 'gt_100';
}

/**
 * Strict gate: single-board 2-card NLH tournaments, postflop ONLY.
 * Excludes preflop, cash, Lightning, Omaha, Short Deck, Fixed Limit, Pot Limit,
 * Hi-Lo, multi-board, bomb pots, and All-In-or-Fold.
 */
export function holdemTournamentAggressionIsPricedApplies(
  ctx: HoldemTournamentAggroScopeInput
): boolean {
  if (ctx.enabled !== true) return false;
  if (!ctx.isTournament || ctx.isCashFormat) return false;
  if (ctx.street !== 'flop' && ctx.street !== 'turn' && ctx.street !== 'river') return false;
  if (ctx.isOmaha || ctx.isPotLimit || ctx.isFixedLimit || ctx.isShortDeck || ctx.isHiLo) {
    return false;
  }
  if (ctx.holeCount !== 2 || ctx.holeCardCount !== 2) return false;
  if (ctx.boardLength < 3 || ctx.boardLength > 5) return false;
  if (ctx.multiBoard || ctx.bombPot || ctx.allInOrFold) return false;
  if (!Number.isFinite(ctx.pot) || !(ctx.pot > 0)) return false;
  if (!Number.isFinite(ctx.heroStack) || ctx.heroStack < 0) return false;
  return true;
}

/**
 * Smooth tournament ICM loss multiplier (>= 1.0).
 * - Equal to 1.0 when `icmRisk === 0` (exact chip-EV).
 * - Strictly increasing in `icmRisk` (bubble / pay-jump risk premium) and in
 *   `wager / heroStack` (fraction of tournament life put at risk).
 * - Smoothly attenuated (bounded >= 1.0) when hero covers a PKO bounty target.
 */
export function computeTournamentIcmLossMult(
  icmRisk: number,
  wager: number,
  heroStack: number,
  bountyCoverDiscount = 0
): number {
  const risk = clamp(finiteOr(icmRisk, 0), 0, 0.35);
  if (!(risk > 0)) return 1;
  const w = Math.max(0, finiteOr(wager, 0));
  const stack = Math.max(EPS, finiteOr(heroStack, 1));
  const riskFrac = clamp(w / stack, 0, 1);
  const bountyDisc = clamp(finiteOr(bountyCoverDiscount, 0), 0, 0.5);
  return 1 + risk * (1.4 + 1.6 * riskFrac) * (1 - bountyDisc);
}

/**
 * Classify board texture for `holdemEmpiricalPriors` flop fold priors.
 */
export function holdemFlopTextureFromBoard(board: readonly Card[]): HoldemFlopTexture {
  if (!board || board.length < 3) return 'unpaired_nonmono';
  const flop = board.slice(0, 3);
  const rankCounts = new Map<string, number>();
  const suitCounts = new Map<string, number>();
  for (const c of flop) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  for (const n of rankCounts.values()) {
    if (n >= 2) return 'paired';
  }
  for (const n of suitCounts.values()) {
    if (n >= 3) return 'mono';
  }
  return 'unpaired_nonmono';
}

/**
 * Inspect whether the board shows 4+ cards of a single suit and hero holds
 * exactly 1 card of that suit (the exact V58 one-card flush spot).
 */
export function holdemFourFlushOneCardStatus(
  holeCards: readonly Card[],
  board: readonly Card[]
): { readonly isFourFlushOneCard: boolean; readonly flushSuit: string | null } {
  if (!holeCards || !board || board.length < 4) {
    return { isFourFlushOneCard: false, flushSuit: null };
  }
  const suitCounts = new Map<string, number>();
  for (const c of board) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  let boardFour: string | null = null;
  for (const [suit, n] of suitCounts) {
    if (n >= 4) boardFour = suit;
  }
  if (boardFour === null) return { isFourFlushOneCard: false, flushSuit: null };
  const heroSuitCount = holeCards.filter((c) => c.suit === boardFour).length;
  return {
    isFourFlushOneCard: heroSuitCount === 1,
    flushSuit: heroSuitCount === 1 ? boardFour : null,
  };
}

/**
 * Smooth Bayesian range-truncation equity when hero's bet folds fraction `pFoldAll`
 * of villain's weakest holdings:
 *   - Equals `rawEquity` exactly when `pFoldAll === 0`.
 *   - Strictly increasing in `rawEquity` and strictly decreasing in `pFoldAll`.
 *   - River applies sharper truncation (`eq^2.2`) because no draw outs remain.
 */
export function truncateCalledEquity(
  rawEquity: number,
  pFoldAll: number,
  street: HoldemTournamentPostflopStreet,
  drawsLive: boolean
): number {
  const eq = clamp(finiteOr(rawEquity, 0), 0, 1);
  const pf = clamp(finiteOr(pFoldAll, 0), 0, 0.92);
  if (!(pf > 0)) return eq;
  if (street === 'river') {
    return clamp((1 - pf) * eq + pf * Math.pow(eq, 2.2), 0.01, 0.98);
  }
  const k = street === 'flop' ? (drawsLive ? 0.45 : 0.68) : drawsLive ? 0.58 : 0.82;
  const w = clamp(pf * k, 0, 0.92);
  return clamp((1 - w) * eq + w * Math.pow(eq, 1.8), 0.02, 0.98);
}

/**
 * Empirical-Bayes estimator for opponent fold rate facing a river FIRST bet.
 * Uses measured `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET` shrunk against
 * `OpponentHud` (`r.fBet`) or `HorseMind.riverFoldRate` when available.
 */
function estimateRiverFirstBetFold(
  potFraction: number,
  villain?: HoldemTournamentVillainRead | null
): number {
  const band = riverFirstBetBand(potFraction);
  const prior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET[band].rate;
  const hudStat = readHudOpponentStat(villain?.hudOpp, 'r.fBet');
  if (hudStat) {
    return empiricalBayesShrink(
      hudStat.hits,
      hudStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.turnBetFold,
      'hud_street'
    ).mean;
  }
  const rfr = villain?.riverFoldRate;
  if (typeof rfr === 'number' && Number.isFinite(rfr)) {
    // River fold rate from HorseMind is already shrunk toward its internal baseline;
    // blend smoothly with the size-conditioned empirical prior (35% weight).
    return clamp(0.65 * prior + 0.35 * clamp(rfr, 0, 1), 0.05, 0.92);
  }
  return prior;
}

/**
 * 1. Deterministic EV-priced multi-street barrel planning (replaces `planBarrel`'s
 *    50% coin-flip when hero bets a flop or turn bluff/semi-bluff).
 */
export function priceHoldemTournamentBarrelPlan(
  input: HoldemTournamentBarrelPlanInput
): HoldemTournamentBarrelPlanVerdict {
  const pot = Math.max(EPS, finiteOr(input.pot, 1));
  const equity = clamp(finiteOr(input.equity, 0), 0, 1);
  const heroStack = Math.max(0, finiteOr(input.heroStack, 0));
  const effBehind = Math.max(0, finiteOr(input.effBehind, 0));
  const curBet = clamp(finiteOr(input.currentBetApprox, pot * 0.45), 0, effBehind);
  const oppCount = Math.max(1, Math.round(finiteOr(input.oppCount, 1)));
  const wetness = clamp(finiteOr(input.wetness, 0.35), 0, 1);
  const bubblePressure = clamp(finiteOr(input.bubblePressure, 0), 0, 1);
  const ownBountyScale = Math.max(1, finiteOr(input.ownBountyScale, 1));

  const nextPot = pot + 2 * curBet;
  const nextEffBehind = Math.max(0, effBehind - curBet);
  const nextHeroStack = Math.max(EPS, heroStack - curBet);

  // If virtually no effective stack remains for a next-street barrel, do not plan one.
  if (nextEffBehind <= nextPot * 0.15) {
    const evGiveUp = nextPot * equity * (input.drawsLive ? 0.72 : 0.58);
    return {
      shouldPlan: false,
      evBarrel: evGiveUp,
      evGiveUp,
      pFoldAll: 0,
      eqCalled: equity,
      icmLossMult: 1,
    };
  }

  const nextStreet: HoldemTournamentPostflopStreet = input.street === 'flop' ? 'turn' : 'river';
  const nextFrac = Math.min(0.62, nextEffBehind / nextPot);
  const nextWager = Math.min(nextPot * nextFrac, nextEffBehind);

  let pFoldOne =
    nextStreet === 'turn'
      ? estimateHoldemTurnBetFold(
          {
            bettorInPosition: input.inPosition,
            potFraction: nextFrac,
            headsUp: oppCount === 1,
          },
          input.villain?.hudOpp,
          input.villain?.exploitCounters
        ).mean
      : estimateRiverFirstBetFold(nextFrac, input.villain);

  if (input.blocker) pFoldOne += 0.04;
  if (!input.drawsLive && wetness > 0.55) pFoldOne -= (wetness - 0.55) * 0.18;
  if (bubblePressure > 0) pFoldOne *= 1 + 0.12 * bubblePressure;
  if (ownBountyScale > 1.5) {
    pFoldOne *= Math.max(0.75, 1 - (ownBountyScale - 1.5) * 0.15);
  }
  pFoldOne = clamp(pFoldOne, 0.05, 0.86);

  const pFoldAll = Math.pow(pFoldOne, oppCount);
  const eqCalled = truncateCalledEquity(equity, pFoldAll, nextStreet, input.drawsLive);
  const icmLossMult = computeTournamentIcmLossMult(
    input.icmRisk,
    nextWager,
    nextHeroStack,
    input.bountyCoverDiscount
  );

  const evBarrel =
    pFoldAll * nextPot +
    (1 - pFoldAll) * (eqCalled * (nextPot + nextWager) - (1 - eqCalled) * nextWager * icmLossMult);
  const giveUpReal =
    (input.inPosition ? 0.66 : 0.56) + (input.drawsLive ? 0.1 : 0) - wetness * 0.05;
  const evGiveUp = nextPot * equity * clamp(giveUpReal, 0.45, 0.85);

  return {
    shouldPlan: evBarrel > evGiveUp + nextPot * 0.01,
    evBarrel,
    evGiveUp,
    pFoldAll,
    eqCalled,
    icmLossMult,
  };
}

/**
 * 2. Deterministic EV + ICM priced low-SPR flop/turn unopened decision
 *    (replaces `v58_low_spr_stack_off`'s blanket `equity >= 0.45 + 0.5*mw` all-in).
 *
 * Compares `EV(all_in)`, an optional legal non-jam value bet (`0.40x` pot when
 * `effBehind >= 0.58 * pot`), and `EV(check)` with full ICM survival weighting
 * and empirical fold equity.
 */
export function priceHoldemTournamentLowSprDecision(
  input: HoldemTournamentLowSprInput
): HoldemTournamentLowSprVerdict {
  const pot = Math.max(EPS, finiteOr(input.pot, 1));
  const equity = clamp(finiteOr(input.equity, 0), 0, 1);
  const heroStack = Math.max(EPS, finiteOr(input.heroStack, 1));
  const effBehind = Math.max(0, finiteOr(input.effBehind, 0));
  const minBet = Math.max(EPS, finiteOr(input.minBet, 1));
  const oppCount = Math.max(1, Math.round(finiteOr(input.oppCount, 1)));
  const wetness = clamp(finiteOr(input.wetness, 0.35), 0, 1);
  const bubblePressure = clamp(finiteOr(input.bubblePressure, 0), 0, 1);
  const ownBountyScale = Math.max(1, finiteOr(input.ownBountyScale, 1));

  // Check EV: free-card vulnerability on wet boards + OOP stab tax.
  const oppStab = estimateHoldemBetWhenCheckedTo(
    input.street,
    input.villain?.hudOpp,
    input.villain?.exploitCounters
  ).mean;
  const baseReal = input.inPosition ? 0.93 : 0.87;
  const wetDrag =
    wetness * (input.cat <= 3 ? 0.09 : 0.04) * (input.street === 'flop' ? 1.15 : 0.85);
  const mwDrag = Math.max(0, oppCount - 1) * 0.03;
  const oopTax = input.inPosition ? 0 : (oppStab - 0.35) * 0.1;
  const checkReal = clamp(baseReal - wetDrag - mwDrag - oopTax, 0.65, 0.97);
  const evCheck = pot * equity * checkReal;

  if (!(effBehind > 0)) {
    return {
      action: 'check',
      betFraction: null,
      evCheck,
      evJam: evCheck,
      evBest: evCheck,
      pFoldAll: 0,
      eqCalled: equity,
      icmLossMult: 1,
    };
  }

  const evalCandidate = (wager: number) => {
    const w = Math.min(wager, effBehind);
    const frac = w / pot;
    const spr = effBehind / pot;
    let pFoldOne =
      input.street === 'flop'
        ? estimateHoldemFlopCbetFold(
            {
              bettorInPosition: input.inPosition,
              potFraction: frac,
              texture: input.texture,
              spr,
              headsUp: oppCount === 1,
            },
            input.villain?.hudOpp,
            input.villain?.exploitCounters
          ).mean
        : estimateHoldemTurnBetFold(
            {
              bettorInPosition: input.inPosition,
              potFraction: frac,
              headsUp: oppCount === 1,
            },
            input.villain?.hudOpp,
            input.villain?.exploitCounters
          ).mean;

    // Low-SPR stickiness: opponents facing a bet at SPR <= 1.0 are pot-committed and fold
    // materially less than the deep-stack c-bet average (measured low-SPR multiplier 0.719x,
    // attenuated further as SPR approaches 0 and when leading without initiative).
    const lowSprMult =
      HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT.low.mult * (0.55 + 0.45 * clamp(spr, 0, 1));
    const initMult = input.hasInitiative === false ? 0.72 : 1.0;
    const villainCallPrice = w / (pot + 2 * w);
    const priceScale = clamp(villainCallPrice / 0.28, 0.45, 1.12);
    pFoldOne *= lowSprMult * initMult * priceScale;
    if (bubblePressure > 0) pFoldOne *= 1 + 0.15 * bubblePressure;
    if (ownBountyScale > 1.5) {
      pFoldOne *= Math.max(0.7, 1 - (ownBountyScale - 1.5) * 0.18);
    }
    pFoldOne = clamp(pFoldOne, 0.04, 0.72);

    const pFoldAll = Math.pow(pFoldOne, oppCount);
    const eqCalled = truncateCalledEquity(equity, pFoldAll, input.street, input.drawsLive);
    const icmLossMult = computeTournamentIcmLossMult(
      input.icmRisk,
      w,
      heroStack,
      input.bountyCoverDiscount
    );
    const ev =
      pFoldAll * pot + (1 - pFoldAll) * (eqCalled * (pot + w) - (1 - eqCalled) * w * icmLossMult);
    return { w, frac, ev, pFoldAll, eqCalled, icmLossMult };
  };

  const jam = evalCandidate(effBehind);
  let bestAction: 'all_in' | 'bet' | 'check' = 'check';
  let bestFraction: number | null = null;
  let bestEv = evCheck;
  let bestFold = jam.pFoldAll;
  let bestEqCalled = jam.eqCalled;
  let bestIcmMult = jam.icmLossMult;

  if (jam.ev > bestEv + pot * 0.005) {
    bestAction = 'all_in';
    bestFraction = jam.frac;
    bestEv = jam.ev;
    bestFold = jam.pFoldAll;
    bestEqCalled = jam.eqCalled;
    bestIcmMult = jam.icmLossMult;
  }

  // When effective SPR is ~0.58..1.00 and a non-jam 0.40x value/protection bet is legal,
  // allow it to win if it strictly outperforms both jamming and checking (e.g. under high ICM).
  const smallBetChips = pot * 0.4;
  if (effBehind >= pot * 0.58 && smallBetChips >= minBet && smallBetChips < effBehind * 0.85) {
    const bet = evalCandidate(smallBetChips);
    if (bet.ev > bestEv + pot * 0.01) {
      bestAction = 'bet';
      bestFraction = bet.frac;
      bestEv = bet.ev;
      bestFold = bet.pFoldAll;
      bestEqCalled = bet.eqCalled;
      bestIcmMult = bet.icmLossMult;
    }
  }

  return {
    action: bestAction,
    betFraction: bestFraction,
    evCheck,
    evJam: jam.ev,
    evBest: bestEv,
    pFoldAll: bestFold,
    eqCalled: bestEqCalled,
    icmLossMult: bestIcmMult,
  };
}

/**
 * 3. Deterministic EV + ICM priced turn/river barrel continuation (replaces `V7 BARREL
 *    CONTINUATION`'s `0.66`/`0.42` continuation roll and `0.65` unplanned give-up roll).
 */
export function priceHoldemTournamentBarrelContinue(
  input: HoldemTournamentBarrelContinueInput
): HoldemTournamentBarrelContinueVerdict {
  const pot = Math.max(EPS, finiteOr(input.pot, 1));
  const equity = clamp(finiteOr(input.equity, 0), 0, 1);
  const heroStack = Math.max(EPS, finiteOr(input.heroStack, 1));
  const effBehind = Math.max(0, finiteOr(input.effBehind, 0));
  const minBet = Math.max(EPS, finiteOr(input.minBet, 1));
  const oppCount = Math.max(1, Math.round(finiteOr(input.oppCount, 1)));
  const playersBehind = Math.max(0, Math.round(finiteOr(input.playersBehind, 0)));
  const wetness = clamp(finiteOr(input.wetness, 0.35), 0, 1);
  const bubblePressure = clamp(finiteOr(input.bubblePressure, 0), 0, 1);
  const ownBountyScale = Math.max(1, finiteOr(input.ownBountyScale, 1));
  const lightCallerMul = clamp(finiteOr(input.lightCallerBluffMul, 1), 0.7, 1);
  const selfImageMod = clamp(finiteOr(input.selfImageMod, 1), 0.85, 1.1);
  const geomFrac = finiteOr(input.geomFrac, 0);

  // Check EV on turn vs river.
  const oppStab = estimateHoldemBetWhenCheckedTo(
    input.street,
    input.villain?.hudOpp,
    input.villain?.exploitCounters
  ).mean;
  const checkReal =
    input.street === 'river'
      ? input.inPosition
        ? 1.0
        : clamp(0.92 - (oppStab - 0.31) * 0.25, 0.72, 0.96)
      : input.inPosition
        ? clamp(0.94 - wetness * 0.06, 0.8, 0.96)
        : clamp(0.86 - wetness * 0.08 - (oppStab - 0.39) * 0.2, 0.66, 0.92);
  const evCheck = pot * equity * checkReal;

  if (effBehind < minBet || !(effBehind > 0)) {
    return {
      action: 'check',
      betFraction: null,
      evCheck,
      evBestBet: evCheck,
      pFoldAll: 0,
      eqCalled: equity,
      icmLossMult: 1,
    };
  }

  const maxFrac = effBehind / pot;
  const rawFracs =
    input.street === 'turn'
      ? [0.35, 0.55, 0.75, ...(geomFrac > 0.35 && geomFrac <= 1.1 ? [geomFrac] : [])]
      : [0.45, 0.7, 1.0];

  const candidateFracs: number[] = [];
  for (const f of rawFracs) {
    const capped = Math.min(f, maxFrac);
    if (capped * pot < minBet - EPS) continue;
    if (!candidateFracs.some((existing) => Math.abs(existing - capped) < 0.04)) {
      candidateFracs.push(capped);
    }
  }
  if (candidateFracs.length === 0) {
    candidateFracs.push(maxFrac);
  }

  let best: {
    frac: number;
    ev: number;
    pFoldAll: number;
    eqCalled: number;
    icmLossMult: number;
  } | null = null;

  for (const frac of candidateFracs) {
    const w = Math.min(pot * frac, effBehind);
    let pFoldOne =
      input.street === 'turn'
        ? estimateHoldemTurnBetFold(
            {
              bettorInPosition: input.inPosition,
              potFraction: frac,
              headsUp: oppCount === 1,
            },
            input.villain?.hudOpp,
            input.villain?.exploitCounters
          ).mean
        : estimateRiverFirstBetFold(frac, input.villain);

    // Structural card-removal, outlook, line continuity, and tournament pressure modifiers.
    if (input.dangered) pFoldOne *= 0.55;
    if (input.outlook === 'good') pFoldOne *= 1.12;
    else if (input.outlook === 'scare') pFoldOne *= input.blocker ? 1.15 : 0.6;
    if (!input.barrelPlan) pFoldOne *= 0.85;
    if (bubblePressure > 0) pFoldOne *= 1 + 0.15 * bubblePressure;
    if (ownBountyScale > 1.5) {
      pFoldOne *= Math.max(0.75, 1 - (ownBountyScale - 1.5) * 0.15);
    }
    if (playersBehind > 0) {
      pFoldOne *= Math.max(0.65, 1 - playersBehind * 0.1);
    }
    pFoldOne *= lightCallerMul * selfImageMod;
    pFoldOne = clamp(pFoldOne, 0.04, 0.88);

    const pFoldAll = Math.pow(pFoldOne, oppCount);
    const eqCalled = truncateCalledEquity(equity, pFoldAll, input.street, input.drawsLive);
    const icmLossMult = computeTournamentIcmLossMult(
      input.icmRisk,
      w,
      heroStack,
      input.bountyCoverDiscount
    );
    const ev =
      pFoldAll * pot + (1 - pFoldAll) * (eqCalled * (pot + w) - (1 - eqCalled) * w * icmLossMult);

    if (best === null || ev > best.ev) {
      best = { frac, ev, pFoldAll, eqCalled, icmLossMult };
    }
  }

  const minEdge = pot * (input.barrelPlan ? 0.005 : 0.02);
  if (best !== null && best.ev > evCheck + minEdge) {
    return {
      action: 'bet',
      betFraction: best.frac,
      evCheck,
      evBestBet: best.ev,
      pFoldAll: best.pFoldAll,
      eqCalled: best.eqCalled,
      icmLossMult: best.icmLossMult,
    };
  }

  return {
    action: 'check',
    betFraction: null,
    evCheck,
    evBestBet: best?.ev ?? evCheck,
    pFoldAll: best?.pFoldAll ?? 0,
    eqCalled: best?.eqCalled ?? equity,
    icmLossMult: best?.icmLossMult ?? 1,
  };
}

/**
 * 4. Deterministic Bayesian + ICM EV-priced one-card flush call on a 4-flush board
 *    (replaces `v58_one_card_low_flush_fold`'s unconditional fold when committing >= 50% stack).
 *
 * Uses exact 4-flush live higher-rank combinatorics (`higherFlushRanks` out of 8 unseen
 * flush cards), empirical bluff share (`estimateHoldemRiverBluffShare` with EB shrinkage),
 * pot odds (`toCall` vs `pot`), street/raise polarity, and ICM survival penalty.
 */
export function priceHoldemTournamentOneCardFlushCall(
  input: HoldemTournamentOneCardFlushCallInput
): HoldemTournamentOneCardFlushCallVerdict {
  const pot = Math.max(EPS, finiteOr(input.pot, 1));
  const toCall = Math.max(0, finiteOr(input.toCall, 0));
  const heroStack = Math.max(EPS, finiteOr(input.heroStack, 1));
  const callAmt = Math.min(toCall, heroStack);
  const potFrac = Math.max(0, finiteOr(input.potFrac, callAmt / Math.max(EPS, pot - callAmt)));
  const oppCount = Math.max(1, Math.round(finiteOr(input.oppCount, 1)));
  const higher = clamp(Math.round(finiteOr(input.higherFlushRanks, 8)), 1, 8);
  const lower = Math.max(0, 8 - higher);

  // 1. Empirical villain bluff share, adjusted for street, raise polarity, field size, and aggression.
  let bluffShare = estimateHoldemRiverBluffShare(
    potFrac,
    input.villain?.hudOpp,
    input.villain?.styleSizeShown
  ).mean;
  if (input.street === 'turn') {
    bluffShare = clamp(bluffShare * 1.35 + 0.04, 0.05, 0.55);
  }
  if (input.raisedAfterAggr) {
    bluffShare *= 0.65;
  }
  bluffShare = clamp(bluffShare / Math.pow(oppCount, 0.7), 0.02, 0.65);
  const callDownMod = finiteOr(input.villain?.exploitCallDownMod, 1);
  if (callDownMod > 1) {
    bluffShare = clamp(bluffShare * Math.min(1.5, callDownMod), 0.02, 0.7);
  }

  // 2. Combinatorial probability hero beats villain's value range on a 4-flush board.
  // Higher flushes value-bet more heavily than low one-card flushes.
  const lowFlushValueWeight = 0.38;
  const higherShareOfFlushes = higher / Math.max(EPS, higher + lowFlushValueWeight * lower);
  const flushValueWeight = clamp(0.82 + 0.14 * Math.min(1, potFrac), 0.8, 0.96);
  const nonFlushBeatenShare = input.pairedBoard ? 0.15 : 0.75;
  const pHeroBeatsValue = clamp(
    (1 - flushValueWeight) * nonFlushBeatenShare + flushValueWeight * (1 - higherShareOfFlushes),
    0.01,
    0.85
  );

  // 3. Bayesian posterior equity against villain's betting/raising range.
  const posteriorEquity = clamp(bluffShare * 0.95 + (1 - bluffShare) * pHeroBeatsValue, 0.02, 0.92);

  // 4. ICM-weighted call EV (`pot` already includes villain's bet).
  const icmLossMult = computeTournamentIcmLossMult(
    input.icmRisk,
    callAmt,
    heroStack,
    input.bountyCoverDiscount
  );
  const evCall = posteriorEquity * pot - (1 - posteriorEquity) * callAmt * icmLossMult;
  const requiredEquity = (callAmt * icmLossMult) / Math.max(EPS, pot + callAmt * icmLossMult);

  return {
    action: evCall >= 0 ? 'call' : 'fold',
    evCall,
    posteriorEquity,
    requiredEquity,
    bluffShare,
    icmLossMult,
  };
}
