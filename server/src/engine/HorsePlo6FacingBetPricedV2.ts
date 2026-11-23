/**
 * PLO6 FACING A BET IS PRICED V2 (six-card native pricing model; prototype
 * default OFF, read `=== true` via `plo6FacingBetIsPricedV2`).
 *
 * Root-cause replacement for the three defects measured in plo6FacingBetIsPriced
 * (eval-40aba893fbc9: -15.51 +/- 2.66 bb/100 on F6, -334.4 bb on HVH48 river
 * fold -> call):
 *
 * 1. NATIVE SIX-CARD VALUE SHARE (no four-card-to-six-card blowup):
 *    `plo6ValueShareAtSameStrength` mapped 4-card quantiles onto C(6,2) = 15-pair
 *    six-card holdings, expanding V from 0.20-0.56 to 0.42-0.89 across flop, turn,
 *    and river and defeating river fold guards (`vsValue < 0.15`). Here every
 *    street uses native six-card top-V quantiles directly, narrowed by bettor
 *    line, multiway field size, and preflop raise depth (3-bet / 4-bet pots).
 *
 * 2. LOW-SPR / ALL-IN JAM RANGE PRICING:
 *    Stack-truncated all-in jams (`bettor.is_all_in`, `heroAllIn`, or `final` on
 *    flop/turn) and truncated `potFrac` (when hero is shorter than `faced.wager`)
 *    never fall into `under40` / `mid` small-stab buckets. Range sizing uses
 *    `Math.max(potFrac, chosenFrac)` floored at `'big'` (or `'raise'`) on all-in
 *    jams, with preflop 3-bet / 4-bet narrowing and reduced jam bluff priors.
 *
 * 3. SIX-CARD NATIVE BLUFF PRIORS, TWO-WAY PRICED FOLDS, AND PAIRED-BOARD GUARD:
 *    - Six-card non-value / bluff priors are calibrated for C(6,2) = 15-pair games
 *      and scaled down across ALL streets for multiway pots, all-in jams, paired
 *      boards, and 3-bet/4-bet pots.
 *    - Multiway callers on all three streets (including river) use six-card
 *      concentrated shares (6/15 of the 4-card pool share), never blown up via
 *      `plo6ValueShareAtSameStrength`.
 *    - Paired-board fold discipline (`ploPairedBoardMustFold`) is preserved unless
 *      the call clears positive EV AND genuine value-range equity (bluff priors
 *      alone can never override `pairedBoardFold`).
 *    - Returns both `callPriced` (`evCall > margin`) and `foldPriced`
 *      (`evCall < -margin`) so flop/turn upgrades `fold -> call` when priced
 *      while river operates two-way (`fold <-> call` and value `raise`).
 *
 * Pure: no telemetry, no opponent memory, no brain RNG.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaDrawQuality, scoreOmahaHiPartial } from './HorseEval.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import { omahaComboStraightOuts } from './HorseOmahaBigDrawAggression.js';
import {
  OMAHA_EV_ALL_IN_SHARE,
  OMAHA_EV_CALLER_SHARE,
  OMAHA_EV_LINE_AGGRESSOR,
  OMAHA_EV_LINE_CALLER,
  OMAHA_FACING_BET_EV_TRIVIAL_BEHIND,
  omahaBetSizeBucket,
  omahaEvHandCounts,
  omahaEvHandCountsSixCardTurn,
  type OmahaBetSizeBucket,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_SHOWN_FIELD_MAX,
  OMAHA_SHOWN_TURN_REALIZATION,
  omahaShownTurnClass,
} from './HorseOmahaFacingBetEvShownField.js';
import { omahaFlopDefenceTreeEv, omahaFlopDefenceTreeInputs } from './HorseOmahaFlopDefenceTree.js';
import {
  OMAHA_FLOP_EV_CALLER_SHARE,
  OMAHA_FLOP_EV_LEAD,
  OMAHA_FLOP_EV_REALIZATION_FIT,
  OMAHA_FLOP_EV_REALIZATION_FULL_BEHIND,
  OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS,
  OMAHA_FLOP_EV_STAB,
  omahaFlopEvBehindContinue,
  omahaFlopEvCounts,
  omahaFlopFittedRealization,
  omahaFlopHandClass,
  omahaFlopRunoutRealization,
  type OmahaFlopHandClass,
} from './HorseOmahaFlopFacingBetEv.js';
import { OMAHA_PRICED_MODE_OFF, withOmahaPricedMode } from './HorseOmahaPricedMode.js';
import {
  OMAHA_PRICED_RAISE_MARGIN,
  OMAHA_PRICED_RAISE_STEPS,
  OMAHA_PRICED_RERAISE_SHARE,
  omahaPricedRaiseAloneEv,
} from './HorseOmahaPricedRules.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { plo6MultiwayTurnJoint } from './HorsePlo6MultiwayTurnField.js';
import { plo6BoardFlushPossible, plo6BoardPaired } from './HorsePlo6PricingPort.js';
import { plo6RiverCurrentNutsCallSpot } from './HorsePlo6RiverDefence.js';
import { ploPairedBoardMustFold } from './HorsePloPairedBoardFold.js';
import { hasRiverNuts } from './HorseRiverNuts.js';
import { RANK_VALUES } from './PokerEngine.js';
import { realizationFactor } from './GtoFacingDefenseV32.js';

export type Plo6V2Street = 'flop' | 'turn' | 'river';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
const WALK = 0.6180339887498949;

const clamp = (x: number, lo: number, hi: number): number => (x <= lo ? lo : x >= hi ? hi : x);
const clamp01 = (x: number): number => clamp(x, 0, 1);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Native six-card bettor value region quantiles (strongest share of unseen six-card
 * holdings on the current board), without any 4-card-to-6-card blowup.
 */
export const PLO6_V2_VALUE_SHARE: Readonly<
  Record<Plo6V2Street, Readonly<Record<OmahaBetSizeBucket | 'raise', number>>>
> = Object.freeze({
  flop: Object.freeze({ under40: 0.52, mid: 0.44, big: 0.34, over: 0.24, raise: 0.16 }),
  turn: Object.freeze({ under40: 0.48, mid: 0.36, big: 0.26, over: 0.18, raise: 0.14 }),
  river: Object.freeze({ under40: 0.42, mid: 0.28, big: 0.19, over: 0.12, raise: 0.1 }),
});

/**
 * Native six-card non-value / bluff priors (heads-up, single-raised unpaired pot,
 * non-jam). Scaled down further for multiway pots, all-in jams, paired boards,
 * earlier street aggression, and 3-bet / 4-bet pots.
 */
export const PLO6_V2_PRIOR_BLUFF: Readonly<
  Record<Plo6V2Street, Readonly<Record<OmahaBetSizeBucket | 'raise', number>>>
> = Object.freeze({
  flop: Object.freeze({ under40: 0.26, mid: 0.26, big: 0.2, over: 0.16, raise: 0.1 }),
  turn: Object.freeze({ under40: 0.22, mid: 0.24, big: 0.15, over: 0.14, raise: 0.08 }),
  river: Object.freeze({ under40: 0.1, mid: 0.11, big: 0.12, over: 0.12, raise: 0.03 }),
});

export const PLO6_V2_FLOP_TREE_INPUTS = Object.freeze(omahaFlopDefenceTreeInputs(null, null));
const PLO6_V2_MW_RIVER_POOL = 640;
const PLO6_V2_MW_RIVER_SETS = 360;

export interface Plo6FacingBetPricedV2Inputs {
  rake: number;
  inPosition: boolean;
  realization: number;
}

export interface Plo6V2Spot {
  street: Plo6V2Street;
  bettorSeat: number;
  potFrac: number;
  chosenFrac: number;
  sizingFrac: number;
  bucket: OmahaBetSizeBucket | 'raise';
  isRaise: boolean;
  isAllInJam: boolean;
  preRaises: number;
  lead: boolean;
  stab: boolean;
  aggressorStreets: number;
  callerStreets: number;
  earlierRaised: boolean;
  boardPaired: boolean;
  callers: number;
  allIns: number;
  behind: number;
  behindCall: number;
  paid: number;
  winnable: number;
  allIn: boolean;
  final: boolean;
  later: number;
  bettorCanBarrelRiver: boolean;
  valueShare: number;
  priorBluff: number;
}

export interface Plo6FacingBetPricedV2Verdict {
  street: Plo6V2Street;
  action: 'fold' | 'call' | 'raise' | 'all_in';
  raiseTo: number;
  paid: number;
  allInCall: boolean;
  evCall: number;
  margin: number;
  callPriced: boolean;
  foldPriced: boolean;
  evRaise: number | null;
  pWin: number;
  pTie: number;
  vsValue: number;
  price: number;
  valueShare: number;
  priorBluff: number;
  isAllInJam: boolean;
  preRaises: number;
  source: 'exact' | 'sampled';
  pairedBoardGuardStands: boolean;
  riverFoldGuardStands: boolean;
  currentRiverNutsFloor: boolean;
  privateRiverNuts: boolean;
}

function stream(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(hole: Card[], board: Card[], dead: Card[]): number {
  let h = 0x811c9dc5;
  for (const g of [hole, board, dead]) {
    for (const k of g.map(key).sort())
      for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 124, 0x01000193);
  }
  return h >>> 0 || 1;
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function hasNutQualityMultiwayDraw(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[]
): boolean {
  const bySuit = new Map<string, Card[]>();
  for (const c of board) {
    const arr = bySuit.get(c.suit) ?? [];
    arr.push(c);
    bySuit.set(c.suit, arr);
  }
  for (const [suit, bCards] of bySuit) {
    if (bCards.length !== 2) continue;
    const hCards = hole.filter((c) => c.suit === suit);
    if (hCards.length < 2) continue;
    const boardRanks = new Set(bCards.map((c) => RANK_VALUES[c.rank]));
    let topUnseen = 14;
    while (topUnseen >= 2 && boardRanks.has(topUnseen)) topUnseen--;
    if (hCards.some((c) => RANK_VALUES[c.rank] === topUnseen)) return true;
  }
  return omahaComboStraightOuts(hole, board, dead) >= 12;
}

function heroHasLiveBoatOutsOnPairedBoard(hole: Card[], board: Card[], dead: Card[]): boolean {
  if (board.length >= 5) return false;
  const catNow = Math.floor(scoreOmahaHiPartial(hole, board) / 0x100000);
  if (catNow >= 7) return true;
  const seen = new Set([...hole, ...board, ...dead].map(key));
  for (const s of SUITS) {
    for (const r of RANKS) {
      if (seen.has(`${r}:${s}`)) continue;
      if (scoreOmahaHiPartial(hole, [...board, { rank: r, suit: s }]) >= 7 * 0x100000) {
        return true;
      }
    }
  }
  return false;
}

export function plo6FacingBetPricedV2Scope(
  player: SeatPlayer,
  gs: HorseGameStateV2
): Plo6V2Street | null {
  try {
    if (String(gs.gameVariant ?? '').toLowerCase() !== 'plo6') return null;
    if (omahaIsTournamentMode(gs)) return null;
    if (
      gs.variantRules?.splitLow8OrBetter ||
      (gs.boardCount ?? 1) !== 1 ||
      gs.communityCards2?.length ||
      gs.communityCards3?.length ||
      gs.bombPot === true ||
      gs.allInOrFold ||
      gs.wagersCapped === true ||
      gs.bettingStructure === 'fixed_limit'
    )
      return null;
    const street: Plo6V2Street | null =
      gs.stage === 'flop'
        ? 'flop'
        : gs.stage === 'turn'
          ? 'turn'
          : gs.stage === 'river'
            ? 'river'
            : null;
    if (street === null) return null;
    const board = gs.communityCards ?? [];
    if (board.length !== (street === 'flop' ? 3 : street === 'turn' ? 4 : 5)) return null;
    if ((player.cards ?? []).length !== 6) return null;
    const toCall = fin(gs.toCall)
      ? gs.toCall
      : Math.max(0, (gs.currentBet || 0) - (player.bet || 0));
    if (!(toCall > 0.005)) return null;
    return street;
  } catch {
    return null;
  }
}

export function plo6V2Spot(player: SeatPlayer, gs: HorseGameStateV2): Plo6V2Spot | null {
  try {
    const street = plo6FacingBetPricedV2Scope(player, gs);
    if (street === null) return null;
    const board = gs.communityCards ?? [];
    const toCall = fin(gs.toCall)
      ? gs.toCall
      : fin(gs.currentBet) && fin(player.bet)
        ? Math.max(0, gs.currentBet - player.bet)
        : NaN;
    if (
      !fin(toCall) ||
      !(toCall > 0.005) ||
      !fin(gs.currentBet) ||
      !fin(gs.pot) ||
      !(gs.pot > 0) ||
      !fin(player.stack) ||
      !(player.stack > 0) ||
      !fin(player.bet) ||
      player.is_folded ||
      player.is_all_in ||
      player.is_sitting_out
    )
      return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return null;
    const allIn = player.stack <= toCall + 0.005;
    const paid = Math.min(player.stack, toCall);
    if (
      Array.isArray(gs.legalActions) &&
      !gs.legalActions.includes(allIn ? 'all_in' : 'call') &&
      !gs.legalActions.includes('call')
    )
      return null;

    const bets = new Map((gs.players ?? []).map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, street, bets, gs.pot);
    if (!faced || faced.bettorSeat === player.seat) return null;
    const bettor = (gs.players ?? []).find((p) => p.seat === faced.bettorSeat);
    if (!bettor || bettor.is_folded || bettor.is_sitting_out) return null;

    const onlyBettorLive = (gs.players ?? []).every(
      (p) =>
        p.seat === player.seat ||
        p.seat === faced.bettorSeat ||
        p.is_folded ||
        p.is_sitting_out ||
        (p.is_all_in && !(p.bet > 0.005))
    );
    const cover = Math.max(0, gs.currentBet - (player.bet + paid));
    const effectiveWager = onlyBettorLive ? Math.max(0, faced.wager - cover) : faced.wager;
    const potFrac = effectiveWager / faced.potBefore;
    const chosenFrac = faced.wager / faced.potBefore;
    if (!fin(potFrac) || !(potFrac > 0) || !fin(chosenFrac) || !(chosenFrac > 0)) return null;
    const sizingFrac = Math.max(potFrac, chosenFrac);

    // Preflop raise count (0 = limped, 1 = SRP, 2 = 3-bet pot, >=3 = 4-bet+ pot) and aggressor.
    let preLevel = 0;
    let preRaises = 0;
    let preAggressor: number | null = null;
    const preTotals = new Map<number, number>();
    const foldedBeforeFlopWager = new Set<number>();
    for (const a of gs.actionHistory ?? []) {
      if (String(a.stage) !== 'preflop') continue;
      const prev = preTotals.get(a.seat) ?? 0;
      const amt = fin(a.amount) ? Math.max(0, a.amount) : 0;
      if (a.action === 'fold') foldedBeforeFlopWager.add(a.seat);
      else if (a.action === 'call') preTotals.set(a.seat, prev + amt);
      else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
        const now = Math.max(prev, amt);
        preTotals.set(a.seat, now);
        if (now > preLevel + 0.005) {
          preLevel = now;
          preRaises++;
          preAggressor = a.seat;
        }
      } else if (amt > preLevel) {
        preLevel = amt;
      }
    }

    const lineOn = (
      st: string,
      seat: number
    ): { wagers: number; aggr: boolean; raised: boolean; called: boolean; aggChecked: boolean } => {
      let level = 0;
      let wagers = 0;
      let aggr = false;
      let raised = false;
      let called = false;
      let aggChecked = false;
      const totals = new Map<number, number>();
      for (const a of gs.actionHistory ?? []) {
        if (String(a.stage) !== st) continue;
        const prev = totals.get(a.seat) ?? 0;
        const amt = fin(a.amount) ? Math.max(0, a.amount) : 0;
        if (a.action === 'check') {
          if (st === 'flop' && a.seat === preAggressor && wagers === 0) aggChecked = true;
        } else if (a.action === 'fold') {
          if (st === 'flop' && wagers === 0) foldedBeforeFlopWager.add(a.seat);
        } else if (a.action === 'call') {
          totals.set(a.seat, prev + amt);
          if (a.seat === seat && amt > 0) called = true;
        } else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
          const now = Math.max(prev, amt);
          totals.set(a.seat, now);
          if (now > level + 0.005) {
            level = now;
            wagers++;
            if (a.seat === seat) {
              aggr = true;
              if (wagers >= 2) raised = true;
            }
          } else if (a.seat === seat && now > prev) called = true;
        }
      }
      return { wagers, aggr, raised, called, aggChecked };
    };

    const curLine = lineOn(street, faced.bettorSeat);
    const isRaise = curLine.wagers >= 2;
    let aggressorStreets = 0;
    let callerStreets = 0;
    let earlierRaised = false;
    for (const st of street === 'river' ? ['flop', 'turn'] : street === 'turn' ? ['flop'] : []) {
      const l = lineOn(st, faced.bettorSeat);
      if (l.aggr) {
        aggressorStreets++;
        if (l.raised) earlierRaised = true;
      } else if (l.called) {
        callerStreets++;
      }
    }

    let lead = false;
    let stab = false;
    if (street === 'flop') {
      const aggressorLive =
        preAggressor !== null &&
        !foldedBeforeFlopWager.has(preAggressor) &&
        (gs.players ?? []).some((p) => p.seat === preAggressor && !p.is_sitting_out);
      const intoAggressor = !isRaise && aggressorLive && preAggressor !== faced.bettorSeat;
      lead = intoAggressor && !curLine.aggChecked;
      stab = intoAggressor && curLine.aggChecked;
    }

    let callers = 0;
    let allIns = 0;
    let behind = 0;
    let behindCalls = 0;
    let uncovered = 0;
    let canStillBet = 0;
    const heroTotal = player.bet + paid;
    for (const p of gs.players ?? []) {
      if (p.seat === player.seat || p.is_folded || p.is_sitting_out) continue;
      const bet = fin(p.bet) ? Math.max(0, p.bet) : 0;
      uncovered += Math.max(0, Math.min(bet, gs.currentBet) - heroTotal);
      if (!p.is_all_in && fin(p.stack) && p.stack > 0.005) canStillBet++;
      if (p.seat === faced.bettorSeat) continue;
      if (p.is_all_in && bet <= 0.005) allIns++;
      else if (p.is_all_in || bet + 0.011 >= gs.currentBet) callers++;
      else {
        behind++;
        const stack = fin(p.stack) ? Math.max(0, p.stack) : 0;
        behindCalls += Math.max(0, Math.min(bet + stack, gs.currentBet, heroTotal) - bet);
      }
    }
    const winnable = gs.pot - uncovered;
    if (!(winnable > 0)) return null;
    const leftBehind = Math.max(0, player.stack - paid);
    const bettorAllIn = bettor.is_all_in === true || (fin(bettor.stack) && bettor.stack <= 0.005);
    const final =
      street === 'river' ||
      allIn ||
      canStillBet === 0 ||
      (street === 'turn' && leftBehind <= OMAHA_FACING_BET_EV_TRIVIAL_BEHIND * (winnable + paid));
    const later =
      street === 'flop' && !final
        ? clamp01(leftBehind / (OMAHA_FLOP_EV_REALIZATION_FULL_BEHIND * (winnable + paid)))
        : 0;
    const bettorCanBarrelRiver =
      street === 'turn' &&
      !bettorAllIn &&
      fin(bettor.stack) &&
      bettor.stack > 0.25 * (winnable + paid);

    const isAllInJam = bettorAllIn || allIn || (street !== 'river' && final);
    const boardPaired = plo6BoardPaired(board);
    const others = callers + allIns + behind;

    // Range bucket: stack-truncated all-in jams never drop into under40/mid stab buckets.
    let bucket: OmahaBetSizeBucket | 'raise' = isRaise ? 'raise' : omahaBetSizeBucket(sizingFrac);
    if (!isRaise && isAllInJam && (bucket === 'under40' || bucket === 'mid')) {
      bucket = 'big';
    }
    const pairedRiverMultiwayValue =
      street === 'river' && !isRaise && boardPaired && sizingFrac >= 0.25 && callers + behind >= 1;
    if (pairedRiverMultiwayValue && (bucket === 'under40' || bucket === 'mid')) {
      bucket = 'big';
    }
    const pairedRiverDonkIntoAggressor =
      street === 'river' &&
      !isRaise &&
      boardPaired &&
      sizingFrac >= 0.4 &&
      aggressorStreets === 0 &&
      callerStreets >= 1 &&
      lineOn('turn', player.seat).aggr;
    const earlierRaisedBigRiverBarrel =
      street === 'river' && !isRaise && earlierRaised && aggressorStreets >= 2 && sizingFrac >= 0.7;

    // Native six-card value share (NO 4-card-to-6-card blowup).
    let valueShare = pairedRiverDonkIntoAggressor
      ? PLO6_V2_VALUE_SHARE.river.raise * OMAHA_EV_LINE_AGGRESSOR ** callerStreets
      : PLO6_V2_VALUE_SHARE[street][bucket];

    if (street === 'flop') {
      const flopLine = lead ? OMAHA_FLOP_EV_LEAD : stab ? OMAHA_FLOP_EV_STAB : 1;
      valueShare *= flopLine;
    } else if (!pairedRiverDonkIntoAggressor) {
      valueShare *=
        OMAHA_EV_LINE_AGGRESSOR ** aggressorStreets * OMAHA_EV_LINE_CALLER ** callerStreets;
    }
    if (earlierRaisedBigRiverBarrel) valueShare *= 0.7;
    if (preRaises >= 3) valueShare *= 0.78;
    else if (preRaises === 2) valueShare *= 0.88;
    valueShare = clamp(valueShare, 0.06, 0.56);

    // Native six-card bluff / non-value prior.
    let priorBluff = pairedRiverDonkIntoAggressor
      ? PLO6_V2_PRIOR_BLUFF.river.raise
      : PLO6_V2_PRIOR_BLUFF[street][bucket];
    if (street === 'flop') {
      const flopLine = lead ? OMAHA_FLOP_EV_LEAD : stab ? OMAHA_FLOP_EV_STAB : 1;
      priorBluff *= flopLine;
    } else if (aggressorStreets >= 1) {
      priorBluff *= 0.9 ** aggressorStreets;
    }
    if (earlierRaisedBigRiverBarrel)
      priorBluff = Math.min(priorBluff, PLO6_V2_PRIOR_BLUFF.river.raise);
    if (preRaises >= 3) priorBluff *= 0.65;
    else if (preRaises === 2) priorBluff *= 0.8;
    if (isAllInJam) priorBluff *= 0.6;
    if (others > 0) {
      if (street === 'flop') priorBluff *= 0.55;
      else if (street === 'turn') priorBluff *= 0.45;
      else priorBluff *= 0.25;
    }
    if (boardPaired) priorBluff *= 0.75;
    priorBluff = clamp(priorBluff, 0.02, 0.3);

    return {
      street,
      bettorSeat: faced.bettorSeat,
      potFrac,
      chosenFrac,
      sizingFrac,
      bucket,
      isRaise,
      isAllInJam,
      preRaises,
      lead,
      stab,
      aggressorStreets,
      callerStreets,
      earlierRaised,
      boardPaired,
      callers,
      allIns,
      behind,
      behindCall: behind > 0 ? behindCalls / behind : 0,
      paid,
      winnable,
      allIn,
      final,
      later,
      bettorCanBarrelRiver,
      valueShare,
      priorBluff,
    };
  } catch {
    return null;
  }
}

function evalFlopV2(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot: Plo6V2Spot,
  rake: number,
  inPosition: boolean
): {
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  vsValue: number;
  price: number;
} | null {
  const hole: Card[] = player.cards ?? [];
  const board: Card[] = gs.communityCards ?? [];
  const dead: Card[] = player.knownDeadCards ?? [];
  const baseCaller =
    spot.potFrac < 0.25
      ? 1 - (1 - OMAHA_FLOP_EV_CALLER_SHARE) * (spot.potFrac / 0.25)
      : OMAHA_FLOP_EV_CALLER_SHARE;
  const callerShareSix =
    spot.callers + spot.behind > 0 ? clamp(baseCaller * (6 / 15), 0.15, 0.5) : baseCaller;
  const allInShareSix = spot.allIns > 0 ? clamp(OMAHA_EV_ALL_IN_SHARE * (6 / 15), 0.15, 0.45) : 0.2;
  const always: number[] = [];
  for (let i = 0; i < spot.callers; i++) always.push(callerShareSix);
  for (let i = 0; i < spot.allIns; i++) always.push(allInShareSix);

  const counted = omahaFlopEvCounts(
    hole,
    board,
    dead,
    spot.valueShare,
    { always, behind: spot.behind, behindShare: callerShareSix },
    0,
    undefined,
    true
  );
  if (!counted) return null;

  const rawKlass = omahaFlopHandClass(hole, board, dead);
  const q = clamp01(spot.priorBluff);
  const isMultiway = spot.callers + spot.allIns + spot.behind > 0;
  const klass: OmahaFlopHandClass =
    isMultiway && rawKlass === 'draw' && !hasNutQualityMultiwayDraw(hole, board, dead)
      ? 'pair'
      : rawKlass;
  let realization = 1;
  if (!spot.final) {
    const r = omahaFlopRunoutRealization(counted.rows, counted.turnOf, q, inPosition);
    if (!r) return null;
    realization = omahaFlopFittedRealization(
      r.realization,
      klass,
      inPosition,
      spot.later
    ).realization;
    if (isMultiway && klass === 'pair') {
      const mwOpps = spot.callers + spot.allIns + spot.behind;
      realization = 1 + (realization / (1 + 0.35 * mwOpps) - 1) * clamp01(spot.later);
    }
  }

  const B = spot.behind;
  const c = B > 0 ? clamp01(omahaFlopEvBehindContinue(spot.potFrac)) : 0;
  let ev = 0;
  let pWin = 0;
  let pTie = 0;
  let vsValue = 0;
  for (let j = 0; j <= B; j++) {
    const w = B > 0 ? binom(B, j) * c ** j * (1 - c) ** (B - j) : 1;
    if (!(w > 0)) continue;
    const jv = counted.jointValue[j];
    const jo = counted.jointOther[j];
    const win = Math.min(1, realization * (q * jo.win + (1 - q) * jv.win));
    const tie = Math.min(1 - win, realization * (q * jo.tie + (1 - q) * jv.tie));
    const tieShare = Math.min(tie, realization * (q * jo.tieShare + (1 - q) * jv.tieShare));
    const pot = (spot.winnable + j * spot.behindCall) * (1 - rake);
    ev +=
      w *
      (win * pot + tieShare * (pot + spot.paid) - tie * spot.paid - (1 - win - tie) * spot.paid);
    pWin += w * win;
    pTie += w * tie;
    vsValue += w * realization * (jv.win + jv.tieShare);
  }

  // Heads-up first flop bet with chips behind: also require survival through fitted two-street tree.
  if (
    !spot.final &&
    !spot.isRaise &&
    spot.callers === 0 &&
    spot.allIns === 0 &&
    spot.behind === 0 &&
    gs.bettingStructure !== 'fixed_limit'
  ) {
    const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
    const stack = fin(player.stack) ? Math.max(0, player.stack) : 0;
    const his = bettor && fin(bettor.stack) ? Math.max(0, bettor.stack) : Infinity;
    const left = Math.min(Math.max(0, stack - spot.paid), his);
    const tree = omahaFlopDefenceTreeEv(
      counted.rows,
      counted.turnOf,
      { paid: spot.paid, winnable: spot.winnable, left, rake, bluffShare: q },
      PLO6_V2_FLOP_TREE_INPUTS
    );
    if (tree) {
      const fitCell = OMAHA_FLOP_EV_REALIZATION_FIT[klass][inPosition ? 'ip' : 'oop'];
      const fitWeight = fitCell.n / (fitCell.n + OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS);
      const fitMul = 1 + (fitCell.ratio - 1) * fitWeight * clamp01(spot.later);
      const fittedTreeEv = (tree.ev + spot.paid) * fitMul - spot.paid;
      ev = Math.min(ev, fittedTreeEv);
    }
  }

  const baseMargin =
    omahaStrategyConstant('facingBetEvMargin', { gameVariant: 'plo6' }) *
    (spot.winnable + spot.paid);
  const margin = spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
  const price = spot.paid / (spot.winnable + spot.paid);
  return { ev, margin, pWin, pTie, vsValue, price };
}

function evalTurnV2(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot: Plo6V2Spot,
  rake: number,
  inPosition: boolean,
  huRealization: number
): {
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  vsValue: number;
  price: number;
  source: 'exact' | 'sampled';
} | null {
  const hole: Card[] = player.cards ?? [];
  const board: Card[] = gs.communityCards ?? [];
  const dead: Card[] = player.knownDeadCards ?? [];
  const q = clamp01(spot.priorBluff);
  const others = spot.callers + spot.allIns + spot.behind;

  const baseMargin =
    omahaStrategyConstant('facingBetEvMargin', { gameVariant: 'plo6' }) *
    (spot.winnable + spot.paid);
  const margin = spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
  const price = spot.paid / (spot.winnable + spot.paid);

  if (others > 0) {
    const baseCaller =
      spot.potFrac < 0.25
        ? 1 - (1 - OMAHA_EV_CALLER_SHARE.turn) * (spot.potFrac / 0.25)
        : OMAHA_EV_CALLER_SHARE.turn;
    const callerShareSix = clamp(baseCaller * (6 / 15), 0.12, 0.45);
    const allInShareSix = clamp(OMAHA_EV_ALL_IN_SHARE * (6 / 15), 0.15, 0.45);
    const always: number[] = [];
    for (let i = 0; i < spot.callers; i++) always.push(callerShareSix);
    for (let i = 0; i < spot.allIns; i++) always.push(allInShareSix);

    const joint = plo6MultiwayTurnJoint(
      hole,
      board,
      dead,
      spot.valueShare,
      always,
      spot.behind,
      callerShareSix
    );
    if (!joint) return null;

    const klass = omahaShownTurnClass(hole, board, dead);
    let R = 1;
    if (!spot.final) {
      R = OMAHA_SHOWN_TURN_REALIZATION[klass][inPosition ? 'ip' : 'oop'].r;
      if (
        spot.sizingFrac >= 0.4 &&
        spot.bettorCanBarrelRiver &&
        spot.boardPaired &&
        scoreOmahaHiPartial(hole, board) < 7 * 0x100000 &&
        !heroHasLiveBoatOutsOnPairedBoard(hole, board, dead)
      ) {
        R = Math.min(R, 0.42);
      }
    }

    const B = spot.behind;
    const c = B > 0 ? clamp01(omahaFlopEvBehindContinue(spot.potFrac)) : 0;
    let ev = 0;
    let equity = 0;
    let vsValue = 0;
    for (let j = 0; j <= B; j++) {
      const w = B > 0 ? binom(B, j) * c ** j * (1 - c) ** (B - j) : 1;
      const e = q * joint.other[j] + (1 - q) * joint.value[j];
      const T = (spot.winnable + j * spot.behindCall) * (1 - rake) + spot.paid;
      ev += w * (R * e * T - spot.paid);
      equity += w * e;
      vsValue += w * R * joint.value[j];
    }
    return {
      ev,
      margin,
      pWin: Math.min(1, R * equity),
      pTie: 0,
      vsValue,
      price,
      source: 'sampled',
    };
  }

  // Heads-up exact six-card turn count across all 42 unseen river cards.
  const counted = omahaEvHandCountsSixCardTurn(hole, board, dead, spot.valueShare);
  if (!counted) return null;
  let R = spot.final ? 1 : clamp(fin(huRealization) ? huRealization : 0.85, 0.5, 1);
  if (!spot.final && spot.bettorCanBarrelRiver) {
    if (
      spot.sizingFrac >= 0.4 &&
      spot.boardPaired &&
      scoreOmahaHiPartial(hole, board) < 7 * 0x100000 &&
      !heroHasLiveBoatOutsOnPairedBoard(hole, board, dead)
    ) {
      R = Math.min(R, 0.42);
    }
    if (
      spot.sizingFrac >= 0.7 &&
      spot.aggressorStreets >= 1 &&
      scoreOmahaHiPartial(hole, board) < 4 * 0x100000
    ) {
      const draw = omahaDrawQuality(hole, board, false);
      if (!draw.nutFlushDraw && draw.nutStraightOuts === 0 && draw.straightOuts < 8) {
        R = Math.min(R, 0.65);
      }
    }
  }
  const pWin = Math.min(1, R * (q * counted.other.win + (1 - q) * counted.value.win));
  const pTie = Math.min(1 - pWin, R * (q * counted.other.tie + (1 - q) * counted.value.tie));
  const winPot = spot.winnable * (1 - rake);
  const pLose = Math.max(0, 1 - pWin - pTie);
  const ev = pWin * winPot + pTie * ((winPot - spot.paid) / 2) - pLose * spot.paid;
  const vsValue = R * (counted.value.win + 0.5 * counted.value.tie);
  return { ev, margin, pWin, pTie, vsValue, price, source: 'exact' };
}

function evalMultiwayRiverV2(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot: Plo6V2Spot,
  rake: number
): { ev: number; pWin: number; vsValue: number } | null {
  const B = spot.behind;
  const others = spot.callers + spot.allIns + B;
  if (others < 1 || others > OMAHA_SHOWN_FIELD_MAX) return null;
  const hole: Card[] = player.cards ?? [];
  const board: Card[] = gs.communityCards ?? [];
  const dead: Card[] = player.knownDeadCards ?? [];
  if (new Set([...hole, ...board].map(key)).size !== 11) return null;

  const removed = new Set([...hole, ...board, ...dead].map(key));
  const unseen: Card[] = [];
  for (const s of SUITS)
    for (const r of RANKS) {
      const c = { rank: r, suit: s } as Card;
      if (!removed.has(key(c))) unseen.push(c);
    }
  const m = unseen.length;
  const maxDisjointOthers = Math.min(others, Math.floor((m - 6) / 6));
  if (maxDisjointOthers < 1) return null;

  // Native six-card caller / all-in shares (6/15 concentration, NO 4-card blowup).
  const baseCaller =
    spot.potFrac < 0.25
      ? 1 - (1 - OMAHA_EV_CALLER_SHARE.river) * (spot.potFrac / 0.25)
      : OMAHA_EV_CALLER_SHARE.river;
  const callerShareSix = clamp(baseCaller * (6 / 15), 0.1, 0.4);
  const allInShareSix = clamp(OMAHA_EV_ALL_IN_SHARE * (6 / 15), 0.12, 0.4);
  const always: number[] = [];
  for (let i = 0; i < spot.callers; i++) always.push(callerShareSix);
  for (let i = 0; i < spot.allIns; i++) always.push(allInShareSix);

  const pairScores = new Float64Array(m * m);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < m; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < m; j++) {
      two[1] = unseen[j];
      const sc = scoreOmahaHiPartial(two, board);
      pairScores[i * m + j] = sc;
      pairScores[j * m + i] = sc;
    }
  }

  const rnd = stream(seedOf(hole, board, dead));
  const P = PLO6_V2_MW_RIVER_POOL;
  const n = 6;
  const cards = new Int8Array(P * n);
  const strength = new Float64Array(P);
  const deck = new Int8Array(m);
  for (let p = 0; p < P; p++) {
    for (let i = 0; i < m; i++) deck[i] = i;
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(rnd() * (m - k));
      const t = deck[k];
      deck[k] = deck[j];
      deck[j] = t;
      cards[p * n + k] = deck[k];
    }
    let best = 0;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const sc = pairScores[cards[p * n + a] * m + cards[p * n + b]];
        if (sc > best) best = sc;
      }
    strength[p] = best;
  }

  const order = Array.from({ length: P }, (_, p) => p).sort(
    (a, b) => strength[b] - strength[a] || a - b
  );
  const clampShare = (s: number): number => clamp(fin(s) ? s : 1, 0.02, 1);
  const vc = Math.max(1, Math.min(P - 1, Math.round(clampShare(spot.valueShare) * P)));
  const A = always.length;
  const fieldCount = Array.from({ length: others }, (_, f) =>
    Math.max(1, Math.min(P, Math.round(clampShare(f < A ? always[f] : callerShareSix) * P)))
  );
  const walks = Array.from({ length: others + 2 }, () => rnd());
  const used = new Uint8Array(m);
  const draw = (w: number, from: number, count: number): number => {
    const i = Math.floor(walks[w] * count);
    walks[w] = (walks[w] + WALK) % 1;
    const tries = Math.min(count, 320);
    for (let t = 0; t < tries; t++) {
      const p = order[from + ((i + t) % count)];
      let ok = true;
      for (let k = 0; k < n; k++)
        if (used[cards[p * n + k]]) {
          ok = false;
          break;
        }
      if (ok) return p;
    }
    return -1;
  };
  const mark = (p: number, v: number): void => {
    for (let k = 0; k < n; k++) used[cards[p * n + k]] = v;
  };

  const hero = scoreOmahaHiPartial(hole, board);
  const accV = new Float64Array(B + 1);
  const accO = new Float64Array(B + 1);
  let nV = 0;
  let nO = 0;
  const fieldScore = new Float64Array(others);
  const picked = new Int32Array(others + 1);

  for (let s = 0; s < PLO6_V2_MW_RIVER_SETS; s++) {
    const isValue = s % 2 === 0;
    const p = isValue ? draw(0, 0, vc) : draw(1, vc, P - vc);
    if (p < 0) continue;
    mark(p, 1);
    picked[0] = p;
    let drawn = 0;
    let whole = true;
    for (let k = 0; k < others; k++) {
      const g = draw(2 + k, 0, fieldCount[k]);
      if (g < 0) {
        whole = false;
        break;
      }
      if (k < maxDisjointOthers) {
        mark(g, 1);
        picked[++drawn] = g;
      }
      fieldScore[k] = strength[g];
    }
    for (let u = 1; u <= drawn; u++) mark(picked[u], 0);
    mark(p, 0);
    if (!whole) continue;
    const bettor = strength[p];
    let best = bettor;
    let tied = hero === bettor ? 1 : 0;
    for (let f = 0; f < A; f++) {
      if (fieldScore[f] > best) best = fieldScore[f];
      if (fieldScore[f] === hero) tied++;
    }
    const acc = isValue ? accV : accO;
    for (let j = 0; j <= B; j++) {
      if (j > 0) {
        const x = fieldScore[A + j - 1];
        if (x > best) best = x;
        if (x === hero) tied++;
      }
      if (hero > best) acc[j] += 1;
      else if (hero === best) acc[j] += 1 / (1 + tied);
    }
    if (isValue) nV++;
    else nO++;
  }
  if (!(nV > 0) || !(nO > 0)) return null;

  const q = clamp01(spot.priorBluff);
  const c = B > 0 ? clamp01(omahaFlopEvBehindContinue(spot.potFrac)) : 0;
  let ev = 0;
  let equity = 0;
  let vsValue = 0;
  for (let j = 0; j <= B; j++) {
    const w = B > 0 ? binom(B, j) * c ** j * (1 - c) ** (B - j) : 1;
    const e = q * (accO[j] / nO) + (1 - q) * (accV[j] / nV);
    const T = (spot.winnable + j * spot.behindCall) * (1 - rake) + spot.paid;
    ev += w * (e * T - spot.paid);
    equity += w * e;
    vsValue += w * (accV[j] / nV);
  }
  return { ev, pWin: Math.min(1, equity), vsValue };
}

function evalRiverRaiseV2(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot: Plo6V2Spot,
  counts: NonNullable<ReturnType<typeof omahaEvHandCounts>>,
  evCall: number,
  vsValue: number,
  rake: number
): { action: 'raise' | 'all_in'; raiseTo: number; evRaise: number } | null {
  if (vsValue < 0.6) return null;
  const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
  if (spot.allIn || !bettor || bettor.is_all_in || !fin(bettor.stack) || !(bettor.stack > 0.005))
    return null;
  const menu = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  const canRaise = menu === null || menu.includes('raise');
  const canShove = menu === null || menu.includes('all_in');
  if (!canRaise && !canShove) return null;

  const heroBet = fin(player.bet) ? Math.max(0, player.bet) : 0;
  const cur = gs.currentBet;
  const toCall = spot.paid;
  const heroAll = heroBet + player.stack;
  if (!(heroAll > cur + 0.005)) return null;
  const potTo = heroBet + toCall + gs.pot + toCall;
  const maxTo = Math.min(fin(gs.maxRaiseTo) ? gs.maxRaiseTo : potTo, heroAll, cur + bettor.stack);
  const minTo = fin(gs.minRaiseTo) ? gs.minRaiseTo : cur * 2;
  const whole = (gs.bigBlind ?? 1) >= 1;

  const sizes: number[] = [];
  const add = (raw: number): void => {
    const to = round2(clamp(whole ? Math.round(raw) : round2(raw), minTo, maxTo));
    const shove = to >= heroAll - 0.005;
    if (shove ? !canShove : !canRaise) return;
    if (!sizes.includes(to)) sizes.push(to);
  };
  if (maxTo + 0.005 < minTo) {
    if (canShove && heroAll <= maxTo + 0.005) sizes.push(round2(heroAll));
  } else {
    for (const f of OMAHA_PRICED_RAISE_STEPS) add(minTo + f * (maxTo - minTo));
  }
  if (sizes.length === 0) return null;

  const win = spot.winnable * (1 - rake);
  const q = clamp01(spot.priorBluff);
  const raiseMargin = OMAHA_PRICED_RAISE_MARGIN * gs.pot;
  const topOf = (region: number) => {
    let r = counts.top(region);
    for (const f of [1.5, 2, 3, 5, 8]) {
      if (r.share > 0) break;
      r = counts.top(Math.min(0.95, region * f));
    }
    return r;
  };
  const holds = (share: number): number => {
    const s = counts.top(share);
    return s.win + s.tie * 0.5;
  };
  const callerShareSix = clamp(OMAHA_EV_CALLER_SHARE.river * (6 / 15), 0.1, 0.4);
  const allInField =
    spot.allIns > 0 ? holds(clamp(OMAHA_EV_ALL_IN_SHARE * (6 / 15), 0.12, 0.4)) ** spot.allIns : 1;

  let best: { action: 'raise' | 'all_in'; raiseTo: number; evRaise: number } | null = null;
  for (const to of sizes) {
    const put = to - heroBet;
    const his = Math.min(to - cur, bettor.stack);
    if (!(his > 0.005) || !(put > toCall + 0.005)) continue;
    const allIn = to >= heroAll - 0.005;
    const price = (win + toCall) / (win + toCall + his);
    const folds = clamp(1 - price, 0.03, 0.95);
    const keep = clamp(1 - folds, 0.03, 0.97);
    const continues = Math.min(1 - q, keep);
    const region = clamp((counts.valueShare * continues) / Math.max(1e-9, 1 - q), 0.001, 0.95);
    const top = topOf(region);
    const again = allIn ? 0 : Math.min(OMAHA_PRICED_RERAISE_SHARE, continues);
    const at =
      again > 1e-6
        ? topOf(clamp((counts.valueShare * again) / Math.max(1e-9, 1 - q), 0.001, 0.95))
        : null;
    const alone = omahaPricedRaiseAloneEv({
      win,
      his,
      put,
      rake,
      real: 1,
      continues,
      continuing: top,
      again,
      reraisers: at,
    });
    let field = allInField;
    if (spot.callers > 0) {
      const callerKeep = clamp(1 - price, 0.05, 1);
      field *= (1 - callerKeep + callerKeep * holds(callerShareSix * callerKeep)) ** spot.callers;
    }
    if (spot.behind > 0) {
      const behindShare = clamp(callerShareSix * 0.6, 0.06, 0.25);
      field *= (1 - behindShare + behindShare * holds(behindShare)) ** spot.behind;
    }
    const ev = alone * field - (1 - field) * put;
    if (!best || ev > best.evRaise) {
      best = { action: allIn ? 'all_in' : 'raise', raiseTo: to, evRaise: ev };
    }
  }

  const bestOther = Math.max(0, evCall);
  if (best && best.evRaise > bestOther + raiseMargin) return best;
  return null;
}

/**
 * Six-card native facing-bet verdict (V2).
 * Pure, deterministic, request-only.
 */
export function plo6FacingBetPricedV2(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  inputs: Plo6FacingBetPricedV2Inputs
): Plo6FacingBetPricedV2Verdict | null {
  const spot = plo6V2Spot(player, gs);
  if (!spot) return null;
  try {
    return withOmahaPricedMode(OMAHA_PRICED_MODE_OFF, () => {
      const rake = clamp(fin(inputs.rake) ? inputs.rake : 0, 0, 0.2);
      const inPosition = inputs.inPosition === true;
      const hole: Card[] = player.cards ?? [];
      const board: Card[] = gs.communityCards ?? [];
      const dead: Card[] = player.knownDeadCards ?? [];

      const mustFoldPaired = ploPairedBoardMustFold({
        gameVariant: gs.gameVariant,
        hiLo: false,
        multiBoard: false,
        board,
        hero: player,
        players: gs.players ?? [],
        currentBet: gs.currentBet,
        toCall: gs.toCall,
        pot: gs.pot,
        v86MultiStreetUnblocked: true,
      });

      if (spot.street === 'flop') {
        const fl = evalFlopV2(player, gs, spot, rake, inPosition);
        if (!fl) return null;
        const pairedGuardStands =
          mustFoldPaired &&
          !(
            fl.ev > fl.margin &&
            heroHasLiveBoatOutsOnPairedBoard(hole, board, dead) &&
            fl.vsValue >= fl.price * 0.75
          );
        const callBar = spot.isAllInJam ? fl.margin * 2 : fl.margin;
        const callPriced = !pairedGuardStands && fl.ev > callBar;
        const foldPriced = pairedGuardStands || fl.ev < -fl.margin;
        return {
          street: 'flop',
          action: callPriced ? 'call' : 'fold',
          raiseTo: 0,
          paid: spot.paid,
          allInCall: spot.allIn,
          evCall: fl.ev,
          margin: fl.margin,
          callPriced,
          foldPriced,
          evRaise: null,
          pWin: fl.pWin,
          pTie: fl.pTie,
          vsValue: fl.vsValue,
          price: fl.price,
          valueShare: spot.valueShare,
          priorBluff: spot.priorBluff,
          isAllInJam: spot.isAllInJam,
          preRaises: spot.preRaises,
          source: 'sampled',
          pairedBoardGuardStands: pairedGuardStands,
          riverFoldGuardStands: false,
          currentRiverNutsFloor: false,
          privateRiverNuts: false,
        };
      }

      if (spot.street === 'turn') {
        const tn = evalTurnV2(player, gs, spot, rake, inPosition, inputs.realization);
        if (!tn) return null;
        const pairedGuardStands =
          mustFoldPaired &&
          !(
            tn.ev > tn.margin &&
            heroHasLiveBoatOutsOnPairedBoard(hole, board, dead) &&
            tn.vsValue >= tn.price * 0.75
          );
        const turnOthers = spot.callers + spot.allIns + spot.behind;
        const callPriced = !pairedGuardStands && tn.ev > tn.margin;
        const foldBar = turnOthers > 0 ? -tn.margin : -tn.margin * 2.5;
        const foldPriced = pairedGuardStands || tn.ev < foldBar;
        return {
          street: 'turn',
          action: callPriced ? 'call' : 'fold',
          raiseTo: 0,
          paid: spot.paid,
          allInCall: spot.allIn,
          evCall: tn.ev,
          margin: tn.margin,
          callPriced,
          foldPriced,
          evRaise: null,
          pWin: tn.pWin,
          pTie: tn.pTie,
          vsValue: tn.vsValue,
          price: tn.price,
          valueShare: spot.valueShare,
          priorBluff: spot.priorBluff,
          isAllInJam: spot.isAllInJam,
          preRaises: spot.preRaises,
          source: tn.source,
          pairedBoardGuardStands: pairedGuardStands,
          riverFoldGuardStands: false,
          currentRiverNutsFloor: false,
          privateRiverNuts: false,
        };
      }

      // RIVER: exact six-card counts against native six-card valueShare + multiway disjoint river.
      const nutsSpot = plo6RiverCurrentNutsCallSpot(player, gs);
      const counts = omahaEvHandCounts(hole, board, dead, spot.valueShare);
      const baseMargin =
        omahaStrategyConstant('facingBetEvMargin', { gameVariant: 'plo6' }) *
        (spot.winnable + spot.paid);
      const margin = spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
      const price = spot.paid / (spot.winnable + spot.paid);

      if (!counts) {
        if (nutsSpot) {
          return {
            street: 'river',
            action: 'call',
            raiseTo: 0,
            paid: nutsSpot.paid,
            allInCall: nutsSpot.allIn,
            evCall: Math.max(0.01, spot.winnable - nutsSpot.paid),
            margin: 0,
            callPriced: true,
            foldPriced: false,
            evRaise: null,
            pWin: 1,
            pTie: 0,
            vsValue: 1,
            price,
            valueShare: spot.valueShare,
            priorBluff: spot.priorBluff,
            isAllInJam: spot.isAllInJam,
            preRaises: spot.preRaises,
            source: 'exact',
            pairedBoardGuardStands: false,
            riverFoldGuardStands: false,
            currentRiverNutsFloor: true,
            privateRiverNuts: hasRiverNuts(player, gs, true),
          };
        }
        return null;
      }

      const beaten = Math.max(0, 1 - counts.all.win - counts.all.tie);
      const huVsValue = counts.value.win + 0.5 * counts.value.tie;
      const privateRiverNuts =
        hasRiverNuts(player, gs, true) || (beaten <= 0.02 && huVsValue >= 0.75);

      const others = spot.callers + spot.allIns + spot.behind;
      const mwRiver = others > 0 ? evalMultiwayRiverV2(player, gs, spot, rake) : null;

      const q = clamp01(spot.priorBluff);
      const huPWin = q * counts.other.win + (1 - q) * counts.value.win;
      const huPTie = q * counts.other.tie + (1 - q) * counts.value.tie;
      const winPot = spot.winnable * (1 - rake);
      const huPLose = Math.max(0, 1 - huPWin - huPTie);
      const huEv = huPWin * winPot + huPTie * ((winPot - spot.paid) / 2) - huPLose * spot.paid;

      const evRaw = mwRiver !== null ? mwRiver.ev : huEv;
      const pWin = mwRiver !== null ? mwRiver.pWin : huPWin;
      const pTie = mwRiver !== null ? 0 : huPTie;
      const vsValue = mwRiver !== null ? mwRiver.vsValue : huVsValue;

      // Native six-card river value-domination fold guard (evaluated on native valueShare).
      let riverGuardStands = false;
      if (nutsSpot === null && price > 0.1) {
        if (spot.isRaise && beaten >= 0.15 && vsValue < 0.35) {
          riverGuardStands = true;
        } else {
          const cat = Math.floor(scoreOmahaHiPartial(hole, board) / 0x100000);
          const flushBlocked = plo6BoardFlushPossible(board) && cat < 6;
          const boatBlocked = spot.boardPaired && cat < 7;
          if ((flushBlocked || boatBlocked) && beaten >= 0.6 && vsValue < 0.15) {
            riverGuardStands = true;
          }
        }
      }

      // Paired-board fold guard on river: bluff prior alone cannot override a committing paired-board fold.
      const pairedGuardStands =
        nutsSpot === null && mustFoldPaired && !(evRaw > margin && vsValue >= price);

      const guardBlocks = riverGuardStands || pairedGuardStands;
      const callPriced = nutsSpot !== null ? true : !guardBlocks && evRaw > margin;
      const riverFoldBar = mwRiver !== null ? -margin : -margin * 1.5;
      const foldPriced = nutsSpot === null && (guardBlocks || evRaw < riverFoldBar);

      const raiseVerdict =
        !guardBlocks && (mwRiver === null || callPriced || privateRiverNuts)
          ? evalRiverRaiseV2(player, gs, spot, counts, evRaw, vsValue, rake)
          : null;

      let action: Plo6FacingBetPricedV2Verdict['action'];
      if (guardBlocks) {
        action = 'fold';
      } else if (raiseVerdict) {
        action = raiseVerdict.action;
      } else {
        action = callPriced ? 'call' : 'fold';
      }

      return {
        street: 'river',
        action,
        raiseTo: raiseVerdict && !guardBlocks ? raiseVerdict.raiseTo : 0,
        paid: spot.paid,
        allInCall: spot.allIn,
        evCall: nutsSpot !== null && evRaw <= margin ? margin + 0.01 : evRaw,
        margin,
        callPriced,
        foldPriced,
        evRaise: raiseVerdict ? raiseVerdict.evRaise : null,
        pWin,
        pTie,
        vsValue,
        price,
        valueShare: spot.valueShare,
        priorBluff: spot.priorBluff,
        isAllInJam: spot.isAllInJam,
        preRaises: spot.preRaises,
        source: mwRiver !== null ? 'sampled' : 'exact',
        pairedBoardGuardStands: pairedGuardStands,
        riverFoldGuardStands: riverGuardStands,
        currentRiverNutsFloor: nutsSpot !== null,
        privateRiverNuts,
      };
    });
  } catch {
    return null;
  }
}

/**
 * Receipt validator admission helper for V2 (request-pure, no rake, either position).
 */
export function plo6FacingBetPricedV2AdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
    if (plo6FacingBetPricedV2Scope(player, gs) === null) return false;
    for (const inPosition of [true, false]) {
      const v = plo6FacingBetPricedV2(player, gs, {
        rake: 0,
        inPosition,
        realization: realizationFactor({ street: 'turn', inPosition }),
      });
      if (!v) return false;
      if (v.allInCall || Math.abs(v.paid - amount) > 0.005) return false;
      if (v.callPriced) return true;
    }
    return false;
  } catch {
    return false;
  }
}
