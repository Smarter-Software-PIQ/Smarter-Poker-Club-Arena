/**
 * HOLD'EM RIVER BLOCK-BET TRAP, PRICED (option v87RiverBlockBetTrapIsPriced, 2026-11-22,
 * Horse Switch lane; default OFF, read only as === true, dark/ungraded).
 *
 * THE BLANKET RULE IT PRICES (V87 #13, v87RiverBlockBetTrap, REVIEW-HOLDEM-OFFLIST-20261121.md).
 * In single-board two-card no-limit hold'em:
 *   1. OOP heads-up river lead (~25045): with `trueRiverNutTrap87` and `singleOppStack > 0.45 * pot`,
 *      the blanket rule flips a hash-unit coin (`unit87('rivertrap') < 0.16 + trapFrequency * 0.18`)
 *      to fire a ~28-33% pot block bet (`blockBet87('rivertrap')`, also randomized by `unit87`).
 *   2. Facing a raise after hero's river block bet (~28070): with `trueRiverNutTrap87`, the blanket
 *      rule blindly 3-bets (all-in if `stack <= 1.5 * (pot + toCall)`, else `currentBet + 0.9 * (pot + toCall)`)
 *      regardless of villain fold-to-raise rates, stack depth, or whether vulnerable near-nuts isolate
 *      against better hands when 3-betting.
 *
 * WHAT THIS MODULE DOES. Independently of `v87RiverBlockBetTrap`, with zero `fastRandom` or hash-unit
 * coin flips, it prices both sites directly by expected value using pot, bet, stack, equity, and the
 * measured NLH empirical response curves in `holdemEmpiricalPriors.ts`:
 *   - Lead site: compares `EV(trap_block_lead)` vs `EV(normal_value_lead)` vs `EV(check)` (the check
 *     option is eligible whenever hero does not hold the exact river nuts enforced by `riverNutsRaise`),
 *     evaluating the villain-raises-hero's-lead branch by backward induction through the facing-raise
 *     pricing engine.
 *   - Facing-raise site: compares `EV(trap_reraise)` across legal deterministic 3-bet / jam sizes
 *     against `EV(call)` using `holdemVillainRaiseCallPrice`, `estimateHoldemRiverFoldToRaise`,
 *     `estimateHoldemRiverBluffShare`, and Bayes-conditioned equity against villain's continuing range.
 *
 * SCOPE. Strictly dark & default OFF (`=== true`). Single-board 2-card NLH river only; never
 * Omaha (PLO4/5/6, Hi-Lo), Short Deck, Fixed Limit, multi-board, bomb pot, or All-In-or-Fold.
 * Zero import dependency on `opponentHud/` (preserves `TheHudProviderChangesNoDecision.law.test.ts`).
 */
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO,
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemRiverBluffShare,
  estimateHoldemRiverFoldToRaise,
  holdemVillainRaiseCallPrice,
  readHudOpponentStat,
  type HoldemHudPacketOpponent,
} from './holdemEmpiricalPriors.js';

export const V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS = Object.freeze({
  blockLead: 'v87_river_block_bet_trap_priced_block_lead_seen',
  valueLead: 'v87_river_block_bet_trap_priced_value_lead_seen',
  check: 'v87_river_block_bet_trap_priced_check_seen',
  reraise: 'v87_river_block_bet_trap_priced_reraise_seen',
  call: 'v87_river_block_bet_trap_priced_call_seen',
} as const);

/** Deterministic small block-bet trap fraction (always <= 0.36 so blockTrap87 & v87HeroRiverBlockBetFrac align). */
export const V87_BLOCK_TRAP_POT_FRAC = 0.3;
/** Candidate normal value lead fractions for non-exact river nut traps. */
export const V87_VALUE_LEAD_FRACS_NON_EXACT: readonly number[] = Object.freeze([0.55, 0.75, 1.0]);
/** Candidate normal value lead fractions for exact river nuts (meets riverNutWagerTarget >= 1.0 pot). */
export const V87_VALUE_LEAD_FRACS_EXACT: readonly number[] = Object.freeze([1.0, 1.35]);

/** Minimum opponent stack-to-pot ratio required for block-bet trap lead eligibility (matches V87 lead gate). */
export const V87_BLOCK_TRAP_MIN_OPP_STACK_FRAC = 0.45;
/** Typical river stab fraction when hero checks OOP to an IP villain. */
export const V87_TYPICAL_RIVER_STAB_FRAC = 0.58;
/** Baseline river raise rate facing a 0.30x pot block bet with stack leverage behind. */
export const V87_BLOCK_BET_BASE_RAISE_RATE = 0.14;

const EPS = 1e-9;

const clamp = (x: number, lo: number, hi: number): number =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;

export interface V87RiverBlockBetTrapLeadGateInput {
  enabled: unknown;
  isV87Nlh: boolean;
  isRiver: boolean;
  inPosition: boolean;
  oppCount: number;
  oppLive: boolean;
  initiative: string;
  trueRiverNutTrap: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  allInOrFold: boolean;
  satelliteActive: boolean;
  pot: number;
  heroStack: number;
  villainStack: number;
}

/**
 * Pure structural gate for the lead site of `v87RiverBlockBetTrapIsPriced`.
 * Strictly dark & default OFF (`=== true`), single-board 2-card NLH OOP heads-up river only;
 * zero PLO4/5/6, Hi-Lo, Short Deck, Fixed Limit, multi-board, bomb-pot, or AoF reach.
 */
export function v87RiverBlockBetTrapLeadApplies(input: V87RiverBlockBetTrapLeadGateInput): boolean {
  return (
    input.enabled === true &&
    input.isV87Nlh === true &&
    input.isRiver === true &&
    input.inPosition === false &&
    input.oppCount === 1 &&
    input.oppLive === true &&
    input.initiative !== 'opp' &&
    input.trueRiverNutTrap === true &&
    !input.multiBoard &&
    !input.bombPot &&
    !input.allInOrFold &&
    !input.satelliteActive &&
    Number.isFinite(input.pot) &&
    input.pot > EPS &&
    Number.isFinite(input.heroStack) &&
    input.heroStack > EPS &&
    Number.isFinite(input.villainStack) &&
    input.villainStack > input.pot * V87_BLOCK_TRAP_MIN_OPP_STACK_FRAC
  );
}

export interface V87RiverBlockBetTrapFacingRaiseGateInput {
  enabled: unknown;
  isV87Nlh: boolean;
  isRiver: boolean;
  oppCount: number;
  raisedAfterAggr: boolean;
  planCallOnly: boolean;
  trueRiverNutTrap: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  allInOrFold: boolean;
  blockBetFrac: number | null;
  pot: number;
  toCall: number;
  heroStack: number;
}

/**
 * Pure structural gate for the facing-raise site of `v87RiverBlockBetTrapIsPriced`.
 * Strictly dark & default OFF (`=== true`), single-board 2-card NLH heads-up (`oppCount === 1`)
 * river after hero's <= 36% pot block bet was raised; zero multiway, PLO4/5/6, Hi-Lo, Short Deck,
 * Fixed Limit, multi-board, bomb-pot, or AoF reach.
 */
export function v87RiverBlockBetTrapFacingRaiseApplies(
  input: V87RiverBlockBetTrapFacingRaiseGateInput
): boolean {
  return (
    input.enabled === true &&
    input.isV87Nlh === true &&
    input.isRiver === true &&
    input.oppCount === 1 &&
    input.raisedAfterAggr === true &&
    !input.planCallOnly &&
    input.trueRiverNutTrap === true &&
    !input.multiBoard &&
    !input.bombPot &&
    !input.allInOrFold &&
    input.blockBetFrac !== null &&
    Number.isFinite(input.blockBetFrac) &&
    input.blockBetFrac > 0 &&
    input.blockBetFrac <= 0.36 + EPS &&
    Number.isFinite(input.pot) &&
    input.pot > EPS &&
    Number.isFinite(input.toCall) &&
    input.toCall > EPS &&
    Number.isFinite(input.heroStack) &&
    input.heroStack > EPS
  );
}

/**
 * Smooth piecewise-linear NLH river fold-to-first-bet prior interpolated through the four
 * measured empirical bands in `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET`.
 */
export function v87EmpiricalRiverFoldToLeadPrior(potFraction: number): number {
  const f = Math.max(0, Number.isFinite(potFraction) ? potFraction : 0);
  const f0 = 0.25;
  const f1 = 0.5;
  const f2 = 0.83;
  const f3 = 1.25;
  const r0 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.le_33.rate;
  const r1 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  const r2 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['67_100'].rate;
  const r3 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.gt_100.rate;
  if (f <= f0) return clamp(r0 * (0.75 + 0.25 * (f / f0)), 0.1, 0.92);
  if (f <= f1) return clamp(r0 + ((r1 - r0) * (f - f0)) / (f1 - f0), 0.1, 0.92);
  if (f <= f2) return clamp(r1 + ((r2 - r1) * (f - f1)) / (f2 - f1), 0.1, 0.92);
  if (f <= f3) return clamp(r2 + ((r3 - r2) * (f - f2)) / (f3 - f2), 0.1, 0.92);
  const extra = Math.min(0.08, (f - f3) * 0.04);
  return clamp(r3 + extra, 0.1, 0.92);
}

/**
 * Empirical-Bayes villain fold probability facing a hero river lead of size `potFraction`.
 * Smoothly shrinks the measured NLH pool prior with `hudOpp` (`r.fBet`) or `exploitCounters`
 * (`riverCall` / `riverCallOpp`) when available, scaling cleanly across bet sizes without cliffs.
 */
export function v87EmpiricalRiverFoldToLead(
  potFraction: number,
  hudOpp?: HoldemHudPacketOpponent | null,
  exploitCounters?: Pick<ExploitCounters, 'riverCall' | 'riverCallOpp'> | null
): number {
  const prior = v87EmpiricalRiverFoldToLeadPrior(potFraction);
  const baseMedPrior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  const hudFold = readHudOpponentStat(hudOpp, 'r.fBet');
  if (hudFold) {
    const shrunkBase = empiricalBayesShrink(
      hudFold.hits,
      hudFold.opportunities,
      baseMedPrior,
      HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
      'hud_street'
    ).mean;
    const ratio = baseMedPrior > EPS ? shrunkBase / baseMedPrior : 1;
    return clamp(prior * ratio, 0.08, 0.92);
  }
  if (exploitCounters && exploitCounters.riverCallOpp > 0) {
    const foldHits = Math.max(0, exploitCounters.riverCallOpp - exploitCounters.riverCall);
    const shrunkBase = empiricalBayesShrink(
      foldHits,
      exploitCounters.riverCallOpp,
      baseMedPrior,
      HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
      'exploit_counters'
    ).mean;
    const ratio = baseMedPrior > EPS ? shrunkBase / baseMedPrior : 1;
    return clamp(prior * ratio, 0.08, 0.92);
  }
  return clamp(prior, 0.08, 0.92);
}

/**
 * Empirical villain raise probability facing a hero river lead of chips `leadAmount` into `pot`.
 * Small block bets (<= 33% pot) induce materially more raises than large value bets when stack
 * leverage remains; scaled smoothly by villain's aggression (`betWhenCheckedTo` or HUD `r.raise`).
 */
export function v87EmpiricalRiverRaiseVsLead(
  leadAmount: number,
  pot: number,
  effStack: number,
  pFold: number,
  hudOpp?: HoldemHudPacketOpponent | null,
  exploitCounters?: Pick<ExploitCounters, 'betCheckedTo' | 'betCheckedToOpp'> | null
): number {
  if (!(pot > EPS) || !(effStack > leadAmount + EPS)) return 0;
  const f = Math.max(0, leadAmount / pot);
  const leverage = clamp((effStack - leadAmount) / (0.8 * pot), 0, 1);
  if (!(leverage > EPS)) return 0;
  const basePrior = clamp(
    V87_BLOCK_BET_BASE_RAISE_RATE * Math.exp(-2.8 * Math.max(0, f - V87_BLOCK_TRAP_POT_FRAC)),
    0.02,
    0.22
  );
  const betCkPrior = HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO.river.rate;
  const betCkMean = estimateHoldemBetWhenCheckedTo('river', hudOpp, exploitCounters).mean;
  const aggrRatio = clamp(betCkPrior > EPS ? betCkMean / betCkPrior : 1, 0.5, 2.0);
  let raiseRate = basePrior * leverage * aggrRatio;
  const hudRaise = readHudOpponentStat(hudOpp, 'r.raise');
  if (hudRaise) {
    raiseRate =
      empiricalBayesShrink(
        hudRaise.hits,
        hudRaise.opportunities,
        clamp(raiseRate, 0.01, 0.6),
        HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
        'hud_street'
      ).mean * leverage;
  }
  const maxAllowed = Math.max(0, (1 - clamp(pFold, 0, 1)) * 0.65);
  return clamp(raiseRate, 0, maxAllowed);
}

export interface V87RiverBlockBetTrapFacingRaiseInput {
  /** Total pot at the decision point (already includes hero's river block bet and villain's raise). */
  pot: number;
  /** Additional chips hero must put in to call villain's raise. */
  toCall: number;
  /** Hero's current river wager (the block bet). */
  heroBet: number;
  /** Current highest river wager (villain's raise total). */
  currentBet: number;
  /** Hero's remaining stack behind. */
  heroStack: number;
  /** Raiser's remaining stack behind. */
  villainStack: number;
  /** Table big blind (floor for min-raise when minRaiseTo is absent). */
  bigBlind: number;
  /** Legal minimum raise-to target if supplied by the controller. */
  minRaiseTo?: number | null;
  /** Hero's river equity in [0, 1]. */
  equity: number;
  /** True when hero holds the exact river nuts (`hasRiverNuts(player, gs, true)`). */
  isExactRiverNuts: boolean;
  /** Projected rake/jackpot deduction fraction on won pots in [0, 0.25]. */
  callDeductionFraction?: number;
  /** Optional structural opponent HUD slice (zero import dependency on opponentHud/). */
  hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional HorseMind showdown tally for villain's river bluff-share shrinkage. */
  styleSizeShown?: { readonly shown: number; readonly strong: number } | null;
  /**
   * Internal flag used by Site 1 backward induction when `equity` is already Bayes-conditioned
   * onto villain's raising/stabbing range (prevents double-concentrating `qVsRaise`).
   */
  alreadyConditionedForRaise?: boolean;
}

export interface V87ReraiseCandidateEval {
  readonly raiseTo: number;
  readonly isAllIn: boolean;
  readonly villainCall: number;
  readonly villainCallPrice: number;
  readonly pFold: number;
  readonly eqVsContinue: number;
  readonly ev: number;
}

export interface V87RiverBlockBetTrapFacingRaiseVerdict {
  readonly decision: 'reraise' | 'call';
  readonly raiseTo: number | null;
  readonly isAllIn: boolean;
  readonly evCall: number;
  readonly evReraise: number | null;
  readonly eqVsRaise: number;
  readonly candidates: readonly V87ReraiseCandidateEval[];
}

/**
 * Pure EV comparison of `EV(trap_reraise)` (across deterministic legal 3-bet / jam sizes)
 * vs `EV(call)` when hero's river block bet is raised.
 *
 * Uses `holdemVillainRaiseCallPrice`, `estimateHoldemRiverFoldToRaise`, and
 * `estimateHoldemRiverBluffShare` from `holdemEmpiricalPriors.ts` with Bayes-conditioned equity
 * against villain's 3-bet continuing range. Deterministic; zero `fastRandom` or hash-unit flips.
 */
export function v87RiverBlockBetTrapFacingRaiseVerdict(
  input: V87RiverBlockBetTrapFacingRaiseInput
): V87RiverBlockBetTrapFacingRaiseVerdict {
  const pot = Math.max(0, Number.isFinite(input.pot) ? input.pot : 0);
  const heroStack = Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0);
  const villainStack = Math.max(0, Number.isFinite(input.villainStack) ? input.villainStack : 0);
  const heroBet = Math.max(0, Number.isFinite(input.heroBet) ? input.heroBet : 0);
  const currentBet = Math.max(heroBet, Number.isFinite(input.currentBet) ? input.currentBet : 0);
  const toCallRaw = Math.max(0, Number.isFinite(input.toCall) ? input.toCall : 0);
  const callable = Math.min(toCallRaw, heroStack);
  const deduction = clamp(input.callDeductionFraction ?? 0, 0, 0.25);
  const bb = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1;

  // Condition hero's losing share against villain's river raising range.
  const qRaw = input.isExactRiverNuts ? 0 : clamp(1 - clamp(input.equity, 0, 1), 0, 1);
  let qVsRaise = qRaw;
  if (!input.isExactRiverNuts && !input.alreadyConditionedForRaise && qRaw > 0) {
    const potBeforeRaise = Math.max(EPS, pot - toCallRaw);
    const raisePotFrac = toCallRaw / potBeforeRaise;
    const bluffShare = estimateHoldemRiverBluffShare(
      raisePotFrac,
      input.hudOpp,
      input.styleSizeShown
    ).mean;
    const raiseConc = clamp((1 - bluffShare) / 0.35, 1.0, 2.75);
    qVsRaise = clamp(qRaw * raiseConc, qRaw, 0.65);
  }
  const eqVsRaise = clamp(1 - qVsRaise, 0, 1);

  const potAfterCall = pot + callable;
  const evCall = eqVsRaise * potAfterCall * (1 - deduction) - callable;

  // Cannot profitably extract extra chips if hero has no chips beyond calling or villain is all-in.
  if (!(heroStack > callable + EPS) || !(villainStack > EPS)) {
    return {
      decision: 'call',
      raiseTo: null,
      isAllIn: false,
      evCall,
      evReraise: null,
      eqVsRaise,
      candidates: [],
    };
  }

  const maxHeroRaiseTo = heroBet + heroStack;
  const derivedMinRaiseTo = currentBet + Math.max(toCallRaw, bb);
  const minRaiseTo =
    input.minRaiseTo != null && Number.isFinite(input.minRaiseTo) && input.minRaiseTo > currentBet
      ? input.minRaiseTo
      : derivedMinRaiseTo;

  const rawTargets: number[] = [
    minRaiseTo,
    currentBet + 0.5 * potAfterCall,
    currentBet + 0.9 * potAfterCall,
    maxHeroRaiseTo,
  ];
  const uniqueTargets: number[] = [];
  for (const t of rawTargets) {
    if (!Number.isFinite(t)) continue;
    const clampedTarget = Math.min(maxHeroRaiseTo, Math.max(t, minRaiseTo));
    // Short all-in is still legal when maxHeroRaiseTo < minRaiseTo.
    const legalTarget = maxHeroRaiseTo < minRaiseTo ? maxHeroRaiseTo : clampedTarget;
    if (!(legalTarget > currentBet + EPS)) continue;
    if (!uniqueTargets.some((existing) => Math.abs(existing - legalTarget) <= 1e-4)) {
      uniqueTargets.push(legalTarget);
    }
  }

  const candidates: V87ReraiseCandidateEval[] = [];
  let best: V87ReraiseCandidateEval | null = null;
  for (const raiseTo of uniqueTargets) {
    const heroAdd = Math.max(0, Math.min(raiseTo - heroBet, heroStack));
    const villainCall = Math.max(0, Math.min(raiseTo - currentBet, villainStack));
    if (!(villainCall > EPS)) continue;
    const isAllIn = heroAdd >= heroStack - 1e-4 || villainCall >= villainStack - 1e-4;
    const villainCallPrice = holdemVillainRaiseCallPrice(
      pot,
      raiseTo,
      heroBet,
      currentBet,
      heroStack,
      villainStack
    );
    const foldEst = estimateHoldemRiverFoldToRaise(
      {
        raiseKind: isAllIn ? 'all_in_raise' : 'non_allin_raise',
        villainCallPrice,
      },
      input.hudOpp
    );
    const pFold = clamp(foldEst.mean, 0.05, 0.9);
    const pContinue = 1 - pFold;
    // Bayes' rule: hands that beat hero stay in villain's 3-bet continuing range.
    const qVsContinue = input.isExactRiverNuts
      ? 0
      : Math.min(1, qVsRaise / Math.max(pContinue, EPS));
    const eqVsContinue = clamp(1 - qVsContinue, 0, 1);
    const effectiveHeroAdd = callable + villainCall;
    const matchedFinalPot = pot + effectiveHeroAdd + villainCall;
    const ev =
      pFold * pot * (1 - deduction) +
      pContinue * (eqVsContinue * matchedFinalPot * (1 - deduction) - effectiveHeroAdd);
    const entry: V87ReraiseCandidateEval = {
      raiseTo,
      isAllIn,
      villainCall,
      villainCallPrice,
      pFold,
      eqVsContinue,
      ev,
    };
    candidates.push(entry);
    if (best === null || entry.ev > best.ev + EPS) {
      best = entry;
    }
  }

  if (best !== null && best.ev > evCall + EPS) {
    return {
      decision: 'reraise',
      raiseTo: best.raiseTo,
      isAllIn: best.isAllIn,
      evCall,
      evReraise: best.ev,
      eqVsRaise,
      candidates,
    };
  }

  return {
    decision: 'call',
    raiseTo: null,
    isAllIn: false,
    evCall,
    evReraise: best?.ev ?? null,
    eqVsRaise,
    candidates,
  };
}

export interface V87RiverBlockBetTrapLeadInput {
  /** Pot at the start of hero's OOP river lead decision. */
  pot: number;
  /** Hero's remaining stack behind. */
  heroStack: number;
  /** Single live IP opponent's remaining stack behind. */
  villainStack: number;
  /** Table big blind. */
  bigBlind: number;
  /** Hero's river equity in [0, 1]. */
  equity: number;
  /** True when hero holds the exact river nuts (`hasRiverNuts(player, gs, true)`). */
  isExactRiverNuts: boolean;
  /** Projected rake/jackpot deduction fraction on won pots in [0, 0.25]. */
  callDeductionFraction?: number;
  /** Optional structural opponent HUD slice (zero import dependency on opponentHud/). */
  hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional HorseMind ExploitCounters for riverCall & betCheckedTo shrinkage. */
  exploitCounters?: Pick<
    ExploitCounters,
    'riverCall' | 'riverCallOpp' | 'betCheckedTo' | 'betCheckedToOpp'
  > | null;
  /** Optional HorseMind showdown tally for villain's river bluff-share shrinkage. */
  styleSizeShown?: { readonly shown: number; readonly strong: number } | null;
}

export interface V87LeadBranchEval {
  readonly potFrac: number;
  readonly betAmount: number;
  readonly pFold: number;
  readonly pCall: number;
  readonly pRaise: number;
  readonly ev: number;
}

export interface V87RiverBlockBetTrapLeadVerdict {
  readonly decision: 'trap_block_lead' | 'normal_value_lead' | 'check';
  readonly betPotFrac: number | null;
  readonly betAmount: number | null;
  readonly evBlockLead: number;
  readonly evValueLead: number;
  readonly evCheck: number | null;
  readonly canCheck: boolean;
  readonly blockEval: V87LeadBranchEval;
  readonly bestValueEval: V87LeadBranchEval;
}

/**
 * Pure EV comparison of `EV(trap_block_lead)` vs `EV(normal_value_lead)` vs `EV(check)`
 * on an OOP heads-up NLH river with `trueRiverNutTrap87`.
 *
 * Uses `holdemEmpiricalPriors.ts` fold/call/raise and bet-when-checked-to response curves,
 * Law-of-Total-Probability Bayes conditioning across fold/call/raise and check-back/stab branches,
 * and backward induction through `v87RiverBlockBetTrapFacingRaiseVerdict`.
 * Deterministic; zero `fastRandom` or hash-unit flips.
 */
export function v87RiverBlockBetTrapLeadVerdict(
  input: V87RiverBlockBetTrapLeadInput
): V87RiverBlockBetTrapLeadVerdict {
  const pot = Math.max(EPS, Number.isFinite(input.pot) ? input.pot : EPS);
  const heroStack = Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0);
  const villainStack = Math.max(0, Number.isFinite(input.villainStack) ? input.villainStack : 0);
  const effStack = Math.min(heroStack, villainStack);
  const bb = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1;
  const deduction = clamp(input.callDeductionFraction ?? 0, 0, 0.25);
  const qArrival = input.isExactRiverNuts ? 0 : clamp(1 - clamp(input.equity, 0, 1), 0, 1);

  const evaluateLead = (potFrac: number): V87LeadBranchEval => {
    const betAmount = Math.min(effStack, pot * potFrac);
    const actualFrac = betAmount / pot;
    const pFold = v87EmpiricalRiverFoldToLead(actualFrac, input.hudOpp, input.exploitCounters);
    const pRaise = v87EmpiricalRiverRaiseVsLead(
      betAmount,
      pot,
      effStack,
      pFold,
      input.hudOpp,
      input.exploitCounters
    );
    const pCall = Math.max(0, 1 - pFold - pRaise);

    // Conserve hero-beating probability mass qArrival across call and raise buckets.
    const rhoRaise =
      pRaise > EPS
        ? clamp(0.55 - 0.25 * Math.max(0, actualFrac - V87_BLOCK_TRAP_POT_FRAC), 0.3, 0.55)
        : 0;
    const qGivenCall = pCall > EPS ? Math.min(1, ((1 - rhoRaise) * qArrival) / pCall) : 0;
    const eqGivenCall = clamp(1 - qGivenCall, 0, 1);
    const qGivenRaise = pRaise > EPS ? Math.min(1, (rhoRaise * qArrival) / pRaise) : 0;
    const eqGivenRaise = clamp(1 - qGivenRaise, 0, 1);

    const evFoldBranch = pot * (1 - deduction);
    const evCallBranch = eqGivenCall * (pot + 2 * betAmount) * (1 - deduction) - betAmount;

    let evRaiseBranch = evCallBranch;
    if (pRaise > EPS && effStack > betAmount + EPS) {
      const rTo = Math.min(effStack, betAmount + Math.max(betAmount, bb, 0.65 * (pot + betAmount)));
      const facingRaise = v87RiverBlockBetTrapFacingRaiseVerdict({
        pot: pot + betAmount + rTo,
        toCall: Math.max(0, rTo - betAmount),
        heroBet: betAmount,
        currentBet: rTo,
        heroStack: Math.max(0, heroStack - betAmount),
        villainStack: Math.max(0, villainStack - rTo),
        bigBlind: bb,
        equity: eqGivenRaise,
        isExactRiverNuts: input.isExactRiverNuts,
        callDeductionFraction: deduction,
        hudOpp: input.hudOpp,
        styleSizeShown: input.styleSizeShown,
        alreadyConditionedForRaise: true,
      });
      const bestPostRaiseEv =
        facingRaise.decision === 'reraise' && facingRaise.evReraise !== null
          ? facingRaise.evReraise
          : facingRaise.evCall;
      // Convert Site 2's post-block-bet EV back to start-of-river reference frame.
      evRaiseBranch = bestPostRaiseEv - betAmount;
    }

    const ev = pFold * evFoldBranch + pCall * evCallBranch + pRaise * evRaiseBranch;
    return {
      potFrac: actualFrac,
      betAmount,
      pFold,
      pCall,
      pRaise,
      ev,
    };
  };

  const blockEval = evaluateLead(V87_BLOCK_TRAP_POT_FRAC);

  const valueFracs = input.isExactRiverNuts
    ? V87_VALUE_LEAD_FRACS_EXACT
    : V87_VALUE_LEAD_FRACS_NON_EXACT;
  let bestValueEval: V87LeadBranchEval | null = null;
  for (const frac of valueFracs) {
    const evalItem = evaluateLead(frac);
    if (bestValueEval === null || evalItem.ev > bestValueEval.ev + EPS) {
      bestValueEval = evalItem;
    }
  }
  const valueEval = bestValueEval!;

  // Exact river nuts cannot check (riverNutsRaise enforces betting exact river nuts unless block-trapping).
  const canCheck = !input.isExactRiverNuts;
  let evCheck: number | null = null;
  if (canCheck) {
    const pStab = clamp(
      estimateHoldemBetWhenCheckedTo('river', input.hudOpp, input.exploitCounters).mean,
      0.05,
      0.85
    );
    const pCheckBack = 1 - pStab;
    const rhoStab = 0.75;
    const qCheckBack = pCheckBack > EPS ? Math.min(1, ((1 - rhoStab) * qArrival) / pCheckBack) : 0;
    const eqCheckBack = clamp(1 - qCheckBack, 0, 1);
    const qStab = pStab > EPS ? Math.min(1, (rhoStab * qArrival) / pStab) : 0;
    const eqStab = clamp(1 - qStab, 0, 1);

    const evCheckBackBranch = eqCheckBack * pot * (1 - deduction);
    const sStab = Math.min(effStack, pot * V87_TYPICAL_RIVER_STAB_FRAC);
    const facingStab = v87RiverBlockBetTrapFacingRaiseVerdict({
      pot: pot + sStab,
      toCall: sStab,
      heroBet: 0,
      currentBet: sStab,
      heroStack,
      villainStack: Math.max(0, villainStack - sStab),
      bigBlind: bb,
      equity: eqStab,
      isExactRiverNuts: false,
      callDeductionFraction: deduction,
      hudOpp: input.hudOpp,
      styleSizeShown: input.styleSizeShown,
      alreadyConditionedForRaise: true,
    });
    const evStabBranch =
      facingStab.decision === 'reraise' && facingStab.evReraise !== null
        ? facingStab.evReraise
        : facingStab.evCall;
    evCheck = pCheckBack * evCheckBackBranch + pStab * evStabBranch;
  }

  // Deterministic argmax; tie preference: normal_value_lead > trap_block_lead > check.
  if (
    canCheck &&
    evCheck !== null &&
    evCheck > valueEval.ev + EPS &&
    evCheck > blockEval.ev + EPS
  ) {
    return {
      decision: 'check',
      betPotFrac: null,
      betAmount: null,
      evBlockLead: blockEval.ev,
      evValueLead: valueEval.ev,
      evCheck,
      canCheck,
      blockEval,
      bestValueEval: valueEval,
    };
  }
  if (blockEval.ev > valueEval.ev + EPS) {
    return {
      decision: 'trap_block_lead',
      betPotFrac: blockEval.potFrac,
      betAmount: blockEval.betAmount,
      evBlockLead: blockEval.ev,
      evValueLead: valueEval.ev,
      evCheck,
      canCheck,
      blockEval,
      bestValueEval: valueEval,
    };
  }
  return {
    decision: 'normal_value_lead',
    betPotFrac: valueEval.potFrac,
    betAmount: valueEval.betAmount,
    evBlockLead: blockEval.ev,
    evValueLead: valueEval.ev,
    evCheck,
    canCheck,
    blockEval,
    bestValueEval: valueEval,
  };
}
