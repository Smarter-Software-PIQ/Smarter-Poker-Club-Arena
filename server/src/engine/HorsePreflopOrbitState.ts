/**
 * Dynamic Preflop Orbit, Straddle/Kill Normalization, and V38 Committed-Population Analyzer.
 *
 * Centralizes preflop action-history parsing so HorseLogic and HorsePreflop see:
 *   1. Exact separation between full raises (`isFullRaise !== false`) and short-stack
 *      incomplete all-ins (`action === 'all_in' && isFullRaise === false`), preventing
 *      2.7bb incomplete short-stack shoves over a 2.5bb open from masquerading as full 3-bets.
 *   2. Hero's own prior preflop investment (`heroPriorAction`) when action re-opens mid-orbit
 *      (e.g., limp -> iso-raise -> cold-calls -> back to hero; open -> 3-bet + cold-callers).
 *   3. Exact squeeze vs cold-called-3-bet classification (`callersOfPreviousRaise >= 1 && callers === 0`).
 *   4. Straddle and Kill-pot unopened detection across any posted multiplier, option-seat
 *      awareness, and effective-BB stack depth normalization.
 *   5. Safe V38 all-in / pressure call & re-jam population guards so horses never blind-jam
 *      100bb stacks into uncapped covering openers behind a short-stack all-in.
 */

import type { ActionRecord, SeatPlayer } from '../types.js';
import type { KillHandState } from './KillPot.js';
import { normalizeKillPotState, type KillPotNormalizationResult } from './HorseSideGameOverlay.js';

export type HeroPriorPreflopAction =
  | 'none'
  | 'limp'
  | 'complete_sb'
  | 'post_straddle_or_kill'
  | 'open_raise'
  | 'iso_raise'
  | 'cold_call'
  | 'three_bet'
  | 'four_bet_plus';

export interface PreflopOrbitInput {
  history: readonly ActionRecord[];
  players: ReadonlyArray<
    Pick<
      SeatPlayer,
      | 'seat'
      | 'user_id'
      | 'stack'
      | 'bet'
      | 'totalInvested'
      | 'is_folded'
      | 'is_all_in'
      | 'is_sitting_out'
    >
  >;
  heroSeat: number;
  heroStack: number;
  heroBet: number;
  bigBlind: number;
  smallBlind?: number;
  currentBet: number;
  dealerSeat?: number;
  dealtSeatIds?: readonly number[];
  straddleActive?: boolean;
  straddleSeat?: number | null;
  killPot?: KillHandState | null;
  isKillPot?: boolean;
  killMultiplier?: number;
  killPosterSeat?: number | null;
  killBlind?: number | null;
  v13?: boolean;
  v18Straddle?: boolean;
  v18Squeeze?: boolean;
}

export interface PreflopOrbitState {
  /** Legacy aggressive-action counter (full raises + incomplete raising all-ins). */
  raises: number;
  /** Strictly full raises that re-open betting (`isFullRaise !== false`). */
  fullRaises: number;
  /** Short-stack all-ins that raised the bet by less than a legal min-raise (`isFullRaise === false`). */
  incompleteAllIns: number;
  /**
   * Effective raise tier for preflop bar selection:
   * - 0 when unopened (including live straddle / kill blind with zero voluntary raises)
   * - 1 when facing a single open (even if an incomplete tiny short-stack all-in added <50% of a min-raise)
   * - >=2 when facing a genuine 3-bet / 4-bet+ or full-sized all-in re-raise.
   */
  effectiveRaises: number;
  limpers: number;
  callers: number;
  callersOfPreviousRaise: number;
  firstRaiserSeat: number;
  lastRaiserSeat: number;
  lastFullRaiserSeat: number;
  heroPreviouslyActed: boolean;
  heroWasInitialRaiser: boolean;
  heroPriorAction: HeroPriorPreflopAction;
  heroPriorVoluntaryChips: number;
  /** True strictly when hero opened, >=1 caller flatted, and 3-bettor squeezed with 0 cold-callers after. */
  squeezed: boolean;
  /** True when hero opened, a 3-bet landed, AND >=1 player cold-called the 3-bet before hero acts. */
  facingColdCalledThreeBet: boolean;
  straddleUnopened: boolean;
  killPotUnopened: boolean;
  killState: KillPotNormalizationResult;
  /** Effective big-blind unit (straddle bet when straddled <=1 raise, kill blind when kill active, else BB). */
  effectiveBigBlind: number;
  /** Hero remaining stack normalized by effectiveBigBlind. */
  effectiveUnitStackBB: number;
  /** Detected straddle poster seat when straddleActive is true. */
  straddleSeat: number | null;
  /** True when hero posted the straddle or kill blind and acts last preflop in an unraised pot. */
  isOptionCheckAvailable: boolean;
  /** Seat-order-corrected count of live players acting after hero preflop when straddle/kill shifts order. */
  straddleAdjustedBehind: number | undefined;
}

export interface V38PopulationGuardInput {
  players: ReadonlyArray<SeatPlayer>;
  heroSeat: number;
  heroBet: number;
  heroStack: number;
  effCall: number;
  currentBet: number;
  bigBlind: number;
  firstRaiserSeat: number;
  lastRaiserSeat: number;
  raiserAllIn: boolean;
}

export interface V38PopulationGuardResult {
  /** Committed opponents at currentBet or all-in (exact population for simulateEquity). */
  committedOpponents: SeatPlayer[];
  /** True when any non-raiser live opponent still has chips to act. */
  otherLiveResponder: boolean;
  /**
   * Count of uncapped live opponents who already voluntarily entered the pot (e.g. initial opener)
   * or cover >1.5x effCall behind an all-in short stack.
   */
  uncappedCoveringOpponentsBehind: number;
  /** Extra equity realization margin required when calling a short-stack jam with uncapped raisers behind. */
  uncappedBehindMargin: number;
  /**
   * Safe gate for line 7459's isolation re-jam: blocks jamming 100bb into an uncapped covering
   * opener behind a short-stack shove unless hero's stack is already shallow/committed to the call.
   */
  allowIsolationJam: boolean;
}

function clockwiseDistance(fromSeat: number, toSeat: number): number {
  const d = toSeat - fromSeat;
  return d <= 0 ? d + 1024 : d;
}

function detectStraddleSeat(input: PreflopOrbitInput): number | null {
  if (typeof input.straddleSeat === 'number') return input.straddleSeat;
  if (input.straddleSeat === null) return null;
  if (input.straddleActive !== true) return null;
  const bb = Math.max(0.01, input.bigBlind);
  const preflopActions = input.history.filter((a) => !a.stage || a.stage === 'preflop');
  const raisedOrCalledSeats = new Set(
    preflopActions.filter((a) => a.action !== 'fold').map((a) => a.seat)
  );
  const dealt =
    input.dealtSeatIds && input.dealtSeatIds.length > 0 ? new Set(input.dealtSeatIds) : null;
  const activeSeats = input.players
    .filter((p) => (dealt ? dealt.has(p.seat) : !p.is_sitting_out || p.is_all_in))
    .map((p) => p.seat)
    .sort((a, b) => a - b);

  if (activeSeats.length >= 3 && typeof input.dealerSeat === 'number') {
    const ordered = [...activeSeats].sort(
      (a, b) => clockwiseDistance(input.dealerSeat!, a) - clockwiseDistance(input.dealerSeat!, b)
    );
    // Search active non-SB/BB seats in clockwise order so re-straddles (e.g. UTG1 over UTG)
    // and Mississippi button straddles resolve to the highest/latest posted live blind.
    let bestSeat: number | null = null;
    let bestBet = bb * 1.25;
    for (let i = 2; i < ordered.length; i++) {
      const candidateSeat = ordered[i]!;
      if (raisedOrCalledSeats.has(candidateSeat)) continue;
      const p = input.players.find((pl) => pl.seat === candidateSeat);
      if (p && p.bet >= bestBet - 0.005 && p.bet > bb * 1.25) {
        bestBet = p.bet;
        bestSeat = candidateSeat;
      }
    }
    if (bestSeat !== null) return bestSeat;
    if (preflopActions.length === 0 && input.currentBet > bb * 1.05) {
      return ordered[2] ?? null;
    }
    return null;
  }
  return null;
}

export function analyzePreflopOrbit(input: PreflopOrbitInput): PreflopOrbitState {
  const bb = Math.max(0.01, input.bigBlind);
  const preflopActions = input.history.filter((a) => !a.stage || a.stage === 'preflop');

  let raises = 0;
  let fullRaises = 0;
  let incompleteAllIns = 0;
  let limpers = 0;
  let callers = 0;
  let callersOfPreviousRaise = 0;
  let firstRaiserSeat = -1;
  let lastRaiserSeat = -1;
  let lastFullRaiserSeat = -1;
  let lastFullRaiseAmount = bb;
  let prevFullRaiseDelta = bb;
  let latestIncompleteAmount = 0;

  let heroPriorAction: HeroPriorPreflopAction = 'none';
  let heroPriorVoluntaryChips = 0;

  for (const a of preflopActions) {
    const isFullAggr =
      a.action === 'raise' ||
      a.action === 'bet' ||
      (a.action === 'all_in' && a.isFullRaise === true);
    const isIncompleteRaiseAllIn = a.action === 'all_in' && a.isFullRaise === false;
    const isLegacyAggr = isFullAggr || isIncompleteRaiseAllIn;

    if (a.seat === input.heroSeat && a.action !== 'fold' && a.action !== 'check') {
      if (typeof a.amount === 'number' && Number.isFinite(a.amount) && a.amount > 0) {
        heroPriorVoluntaryChips = Math.max(heroPriorVoluntaryChips, a.amount);
      }
      if (isLegacyAggr) {
        if (raises === 0) {
          heroPriorAction = limpers > 0 ? 'iso_raise' : 'open_raise';
        } else if (raises === 1) {
          heroPriorAction = 'three_bet';
        } else {
          heroPriorAction = 'four_bet_plus';
        }
      } else if (a.action === 'call' || a.action === 'all_in') {
        if (raises === 0) {
          const sb = input.smallBlind ?? bb * 0.5;
          heroPriorAction =
            typeof a.amount === 'number' && a.amount <= bb - sb + 0.01 ? 'complete_sb' : 'limp';
        } else {
          heroPriorAction = 'cold_call';
        }
      }
    }

    if (isLegacyAggr) {
      raises++;
      if (isFullAggr) {
        fullRaises++;
        callersOfPreviousRaise = callers;
        callers = 0;
        if (typeof a.amount === 'number' && a.amount > lastFullRaiseAmount) {
          prevFullRaiseDelta = Math.max(bb, a.amount - lastFullRaiseAmount);
          lastFullRaiseAmount = a.amount;
        }
        if (firstRaiserSeat < 0) firstRaiserSeat = a.seat;
        lastRaiserSeat = a.seat;
        lastFullRaiserSeat = a.seat;
      } else {
        incompleteAllIns++;
        if (typeof a.amount === 'number' && a.amount > 0) {
          latestIncompleteAmount = Math.max(latestIncompleteAmount, a.amount);
        }
        if (firstRaiserSeat < 0) firstRaiserSeat = a.seat;
        lastRaiserSeat = a.seat;
      }
    } else if (a.action === 'call' || a.action === 'all_in') {
      if (raises === 0) limpers++;
      else callers++;
    }
  }

  const killState = normalizeKillPotState(
    {
      bigBlind: bb,
      pot: 0,
      currentBet: input.currentBet,
      heroSeat: input.heroSeat,
      heroStack: input.heroStack,
      players: input.players,
      dealtSeatIds: input.dealtSeatIds,
      killPot: input.killPot,
      isKillPot: input.isKillPot,
      killMultiplier: input.killMultiplier,
      killPosterSeat: input.killPosterSeat,
      killBlind: input.killBlind,
    },
    fullRaises
  );

  const killPotUnopened =
    killState.active &&
    raises === 0 &&
    input.currentBet > bb * 1.05 &&
    input.currentBet <= killState.killBlind * 1.05;

  // V18 straddle detection generalized: when straddleActive is explicitly true and zero
  // raises have occurred in preflop history, any posted straddle (2x, 2.5x, 3x, Mississippi)
  // keeps the pot unopened! Preserve <= 2.2x guard only if history was truncated/empty and
  // currentBet exceeds any plausible straddle.
  const straddleUnopened =
    (input.v18Straddle ?? true) !== false &&
    input.straddleActive === true &&
    raises === 0 &&
    input.currentBet > bb * 1.05 &&
    (preflopActions.length > 0 || input.currentBet <= bb * 5.0);

  if (
    !straddleUnopened &&
    !killPotUnopened &&
    preflopActions.length === 0 &&
    input.currentBet > bb * 1.05
  ) {
    raises = input.currentBet > bb * 4.5 ? 2 : 1;
    fullRaises = raises;
  }

  // Compute effectiveRaises: if a full open occurred (`fullRaises >= 1`) and a short stack
  // pushed an incomplete all-in (`incompleteAllIns >= 1`) adding less than half a legal raise,
  // do NOT inflate effectiveRaises from 1 (facing open) to 2 (facing 3-bet)!
  let effectiveRaises = raises;
  if (straddleUnopened || killPotUnopened) {
    effectiveRaises = 0;
  } else if (fullRaises >= 1 && incompleteAllIns >= 1 && raises > fullRaises) {
    const extraOverFullRaise = Math.max(0, latestIncompleteAmount - lastFullRaiseAmount);
    if (extraOverFullRaise < prevFullRaiseDelta * 0.5) {
      effectiveRaises = fullRaises;
    }
  }

  const straddleSeat = detectStraddleSeat(input);
  if (
    heroPriorAction === 'none' &&
    ((straddleSeat !== null && straddleSeat === input.heroSeat) ||
      (killState.active && killState.killerSeat === input.heroSeat))
  ) {
    heroPriorAction = 'post_straddle_or_kill';
  }

  const heroPreviouslyActed = preflopActions.some(
    (action) =>
      action.seat === input.heroSeat && action.action !== 'fold' && action.action !== 'check'
  );
  const heroWasInitialRaiser = firstRaiserSeat >= 0 && firstRaiserSeat === input.heroSeat;

  // Squeeze requires: 1) initial open + >=1 cold-caller before the 3-bet, AND
  // 2) zero cold-callers AFTER the 3-bet (if someone cold-called the 3-bet, it's a multiway 3-bet pot).
  const squeezed =
    (input.v18Squeeze ?? true) !== false &&
    raises === 2 &&
    callersOfPreviousRaise >= 1 &&
    callers === 0 &&
    heroWasInitialRaiser;

  const facingColdCalledThreeBet = effectiveRaises === 2 && callers >= 1 && heroWasInitialRaiser;

  // Effective big blind unit for straddle / kill pots (unopened or single-raised):
  let effectiveBigBlind = bb;
  if (killState.active && killState.effectiveBigBlind > bb) {
    effectiveBigBlind = killState.effectiveBigBlind;
  } else if (
    input.straddleActive === true &&
    effectiveRaises === 0 &&
    input.currentBet > bb * 1.05
  ) {
    effectiveBigBlind = input.currentBet;
  }

  const toCallApprox = Math.max(0, input.currentBet - (input.heroBet || 0));
  const isOptionCheckAvailable =
    effectiveRaises === 0 &&
    toCallApprox <= 0.005 &&
    ((straddleSeat !== null && straddleSeat === input.heroSeat) || killState.isHeroKillerOption);

  // Compute straddle adjusted players behind when unopened.
  // HandController.setNextPlayer starts preflop left of bbSeat on Kill Pots (not left of killerSeat),
  // so only a live straddle shifts the closing seat away from bbSeat.
  let straddleAdjustedBehind: number | undefined;
  const optionPosterSeat = straddleSeat;
  if (optionPosterSeat !== null && effectiveRaises === 0) {
    if (input.heroSeat === optionPosterSeat) {
      straddleAdjustedBehind = 0;
    } else {
      // Count live non-folded players who act after hero up to and including optionPosterSeat.
      const heroToOption = clockwiseDistance(input.heroSeat, optionPosterSeat);
      let behind = 0;
      for (const p of input.players) {
        if (p.seat === input.heroSeat || p.is_folded) continue;
        if (input.v13 !== false && p.is_sitting_out && !p.is_all_in) continue;
        const dist = clockwiseDistance(input.heroSeat, p.seat);
        if (dist <= heroToOption) behind++;
      }
      straddleAdjustedBehind = behind;
    }
  }

  return {
    raises,
    fullRaises,
    incompleteAllIns,
    effectiveRaises,
    limpers,
    callers,
    callersOfPreviousRaise,
    firstRaiserSeat,
    lastRaiserSeat,
    lastFullRaiserSeat,
    heroPreviouslyActed,
    heroWasInitialRaiser,
    heroPriorAction,
    heroPriorVoluntaryChips,
    squeezed,
    facingColdCalledThreeBet,
    straddleUnopened,
    killPotUnopened,
    killState,
    effectiveBigBlind,
    effectiveUnitStackBB: input.heroStack / Math.max(0.01, effectiveBigBlind),
    straddleSeat,
    isOptionCheckAvailable,
    straddleAdjustedBehind,
  };
}

/**
 * Evaluates the V38 preflop all-in / pressure population and prevents blind 100bb
 * isolation re-jams into uncapped covering raisers behind a short-stack shove.
 */
export function analyzeV38CommittedPopulation(
  input: V38PopulationGuardInput
): V38PopulationGuardResult {
  const committedOpponents = input.players.filter(
    (p) =>
      !p.is_folded &&
      (!p.is_sitting_out || p.is_all_in) &&
      p.seat !== input.heroSeat &&
      (p.is_all_in || (Number.isFinite(p.bet) && p.bet >= input.currentBet - 0.005))
  );

  const otherLiveResponder = input.players.some(
    (p) =>
      !p.is_folded &&
      !p.is_sitting_out &&
      !p.is_all_in &&
      p.stack > 0 &&
      p.seat !== input.heroSeat &&
      p.seat !== input.lastRaiserSeat
  );

  let uncappedCoveringOpponentsBehind = 0;
  let livePriorRaiserBehind = false;
  const heroTotalAfterCall = (input.heroBet || 0) + input.effCall;

  for (const p of input.players) {
    if (p.seat === input.heroSeat || p.is_folded || p.is_sitting_out || p.is_all_in) continue;
    if (p.seat === input.lastRaiserSeat) continue;
    const oppTotal = (p.bet || 0) + p.stack;
    if (oppTotal > heroTotalAfterCall + input.effCall * 0.5) {
      uncappedCoveringOpponentsBehind++;
      if ((p.bet || 0) > input.bigBlind * 1.05 || p.seat === input.firstRaiserSeat) {
        livePriorRaiserBehind = true;
      }
    }
  }

  // When the current bet is an all-in short stack (`raiserAllIn`) AND an uncapped prior
  // raiser (e.g., 100bb UTG opener) still acts behind hero, hero's call does NOT close
  // action — hero faces squeeze/re-jam risk from the uncapped opener!
  const uncappedBehindMargin =
    input.raiserAllIn && livePriorRaiserBehind
      ? Math.min(0.06, 0.035 * uncappedCoveringOpponentsBehind)
      : 0;

  // Never blind-jam >2.5x effCall into an uncapped prior raiser behind a short stack's
  // all-in (`raiserAllIn && livePriorRaiserBehind`), unless hero is already shallow (<= 2.5x effCall).
  // Unacted blinds behind (`!livePriorRaiserBehind`) keep `allowIsolationJam = true` so V38
  // short-stack isolation jams still fire with dominant equity.
  const unpricedRiskRatio = input.heroStack / Math.max(0.01, input.effCall);
  const allowIsolationJam =
    otherLiveResponder && !(input.raiserAllIn && livePriorRaiserBehind && unpricedRiskRatio > 2.5);

  return {
    committedOpponents,
    otherLiveResponder,
    uncappedCoveringOpponentsBehind,
    uncappedBehindMargin,
    allowIsolationJam,
  };
}
