/**
 * THE OUT-OF-POSITION 3-BET RANGE HOLDS AGAINST A 4-BET (lane PLO-LEAD-6, 2026-11-24; hand a6f9206d, trace
 * OOP-3BET-FOLD-TRACE.md). Two options, each default OFF and read `=== true`, switched live:
 *   omahaOopReraiseRangeHoldsVsReraise   PLO4 / PLO5 cash tables (horse.omahaGameScope.<option> confines it to one)
 *   holdemOopReraiseRangeHoldsVsReraise  no-limit hold'em cash tables
 * Never PLO6, a tournament, Short Deck, hi-lo, a bomb pot, more than one board, a Lightning pool or any other game.
 *
 * THE DEFECT. Out of position the Horse 3-bets a range that has no stack-depth term (HorsePreflop threeBetThresh) and
 * that the V53 pressure rule widens against an aggressive opener, while every rule that answers the 4-bet tightens
 * with depth. Deeper than about 135 bb two thirds of that range folds to a pot-sized 4-bet (replay, PLO5 no read: 65%
 * at 200 bb, 71% at 800 bb; live NLH cash: 75% against a 61% break-even), so a 4-bet with any hand profits.
 *
 * THE RULE, AS MATH (no blanket rule, no identity, no unshown card). At the Horse's out-of-position decision facing
 * one open (no caller), a 3-bet the brain chose stands only when
 *   EV(3-bet) >= max(EV(call) where the existing calling rule admits the call, 0)
 * and the Horse's own answer to the 4-bet is not a fold, unless the hand holds an ace (a blocker) and the seeded keep
 * draw admits it as a planned fold at the frequency that holds the fold-to-4-bet share of the whole out-of-position
 * 3-bet range at or under the cap. With every amount counted from folding now (the blinds already in are sunk):
 *   EV(call)  = R(oop, spr1) x eq(h | open range) x (P0 + c0) x (1 - rake) - c0
 *   V4        = the value of the Horse's OWN answer to the 4-bet (HorseLogic re-asks it on the 4-bet frame):
 *                 fold  -I3
 *                 call  R(oop, spr4) x eq(h | 4-bet range) x Pot4 x (1 - rake) - I3 - C4
 *                 raise eq(h | 4-bet range) x (dead + 2 x effective) x (1 - rake) - (effective - hero's bet)
 *   EV(3-bet) = phi x P0 + kappa x [R(oop, spr3) x eq(h | 3-bet calling range) x Pot3 x (1 - rake) - I3] + rho x V4
 * phi / kappa / rho are how the opener answers a 3-bet (OpenerAnswersThreeBet below): his measured fold to a 3-bet when
 * the read is measured, the fitted population answer otherwise. R is the engine's measured realization of a call in a
 * re-raised pot, out of position, by depth after the call and by the call's own equity (and hand shape in Omaha)
 * (HorseOmahaPreflopReraiseDefence.omahaPreflopDefenceRealization: 2,023 recorded calls; the same fit is used for
 * hold'em, which has no fit of its own); the equity is the engine's seeded sampler (Omaha:
 * omahaReraisedEquity over omahaPreflopPercentile bands; hold'em: holdemRangeEquity over STRENGTH_ORDER shares).
 *
 * A rejected 3-bet becomes the call only where the EXISTING calling rule admits it (Omaha:
 * omahaDowngradedThreeBetCalls, coordinated hands and aces or equity past the price plus the margin; hold'em: the
 * brain's own call bar for the spot, strength >= callThreshold) and EV(call) >= 0; otherwise it folds. The rule never
 * adds a call those rules refuse (owner: calling 3-bets and 4-bets out of position is a losing play).
 *
 * Pure: no I/O, no opponent memory, no random stream. The planned-fold keep draw is a hash of the Horse's id, the pot
 * and its own cards (like plo3BetRoll), recorded with its frequency on the receipt.
 */
import { plannedFoldGuardWeight, type OpenerFourBetRead } from './HorseOpenerAnswersThreeBet.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';
import {
  EXPLOIT_DECAY,
  learnablePublicAction,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';
import { omahaReraisedEquityInPercentileBand } from './HorseOmahaReraisedPot.js';
import { preflopAnswerToReraise } from './HorsePreflopIndifferenceAnchor.js';
import {
  omahaPreflopDefenceRealization,
  omahaPreflopDefenceShape,
} from './HorseOmahaPreflopReraiseDefence.js';
import {
  holdemRangeEquity,
  holdemTopRange,
  type HoldemClassRange,
} from './HorseHoldemTournamentAllInCall.js';

export const OMAHA_OOP_RERAISE_RANGE_HOLDS = 'omahaOopReraiseRangeHoldsVsReraise';
export const HOLDEM_OOP_RERAISE_RANGE_HOLDS = 'holdemOopReraiseRangeHoldsVsReraise';
/** The default-off companions that read the opener's own record (HorseOpenerAnswersThreeBet). */
export const OMAHA_OOP_RERAISE_READS_OPENER_RECORD = 'omahaOopReraiseRangeReadsOpenerRecord';
export const HOLDEM_OOP_RERAISE_READS_OPENER_RECORD = 'holdemOopReraiseRangeReadsOpenerRecord';

/** The games each option acts in. */
export type OopReraiseGame = 'plo4' | 'plo5' | 'nlh';
export const OOP_RERAISE_GAMES: Readonly<Record<OopReraiseGame, string>> = Object.freeze({
  plo4: OMAHA_OOP_RERAISE_RANGE_HOLDS,
  plo5: OMAHA_OOP_RERAISE_RANGE_HOLDS,
  nlh: HOLDEM_OOP_RERAISE_RANGE_HOLDS,
});
const HOLE_COUNT: Readonly<Record<OopReraiseGame, number>> = { plo4: 4, plo5: 5, nlh: 2 };

/** The cap on the fold-to-4-bet share of the out-of-position 3-bet range (runtime setting
 *  horse.reraiseFoldShareCap). */
export const RERAISE_FOLD_SHARE_CAP_DEFAULT = 0.45;
/** A hold'em 4-bet is priced at this multiple of the 3-bet (pot limit: the pot-sized 4-bet). */
export const HOLDEM_FOUR_BET_MULTIPLE = 2.3;
/** Opponent holdings sampled per equity (Omaha), and iterations per equity (hold'em). */
export const OOP_RERAISE_OMAHA_SAMPLES = 400;
export const OOP_RERAISE_HOLDEM_ITERATIONS = 2400;
/** The narrowest band an equity is sampled against (a share of all hands). */
export const OOP_RERAISE_MIN_BAND = 0.01;
/** The opener's open band when none can be read (HorseOmahaOopReraisedPot OOP_PRIOR_BAND_OPEN). */
export const OOP_RERAISE_PRIOR_OPEN_BAND: readonly [number, number] = [0.4, 1];
/**
 * horse.openerAnswersPriorVersion (runtime setting, compiled default 1). 1: the fitted table OPENER_ANSWERS_PRIOR
 * (2026-11-24.v1, people and Horses pooled from hand_history: the mis-playing field the prior-anchor law forbids as a
 * prior; kept selectable for the comparison). 2: the indifference answer to the 3-bet faced
 * (HorsePreflopIndifferenceAnchor; fold = s/(1+s) at the 3-bet's size, call : 4-bet split from the pot 4-bet's own
 * indifference), the opener's own record on top with the same shrinkage.
 */
export const OPENER_ANSWERS_PRIOR_VERSION_DEFAULT = 1;
export const OPENER_ANSWERS_PRIOR_INDIFFERENCE = 2;
/**
 * The Horse's own out-of-position 3-bet range width facing one open, by game (its own measured 3-bet rate, live
 * 2026-11-17..24, OOP-3BET-FOLD-TRACE.md section 4: PLO4 5.0% of 94,777, PLO5 7.2% of 51,482, NLH 11.0% of 108,250):
 * the range the opener's anchored answer is taken against. It is the Horse's own play, not the field's.
 */
export const HORSE_OOP_THREE_BET_WIDTH: Readonly<Record<OopReraiseGame, number>> = Object.freeze({
  plo4: 0.05,
  plo5: 0.072,
  nlh: 0.11,
});
/** Posterior weight (in opportunities) of the population fold share against his measured one. */
export const OPENER_ANSWERS_PRIOR_MASS = 6;

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// HOW THE OPENER ANSWERS A 3-BET (the read counter; public actions only)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One node, `openFacesThreeBet`: he made the first raise of the preflop street (the open), the very next raise was
 * another player's (a 3-bet), and he then acted before any further raise: fold, call or raise. At most one opportunity
 * per player per hand. Admission is the pooled counters' own (learnablePublicAction: voluntary, attributed, never
 * forced); a raise is a bet, a raise or a full-raise all-in (the exploit counters' definition). The sibling of
 * HorseOmahaReraiseResponse's threeBetFacesFourBet, one raise earlier; decayed the same way (EXPLOIT_DECAY, a hand that
 * gave the node an opportunity ages it). The fitted population answer below is this definition run over hand_history
 * (server/scripts/oop-reraise-range/fit-opener-answers-three-bet.ts).
 */
export interface OpenerAnswersThreeBetCell {
  opp: number;
  fold: number;
  call: number;
  raise: number;
}
const OPENER_FIELDS = ['opp', 'fold', 'call', 'raise'] as const;

export function emptyOpenerAnswersThreeBet(): OpenerAnswersThreeBetCell {
  return { opp: 0, fold: 0, call: 0, raise: 0 };
}

const aggressive = (a: ExploitHandAction): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);

/** The raw (undecayed) increments one completed hand contributes, for the opener who answered a 3-bet (if any). */
export function openerAnswersThreeBetHandIncrements(
  actions: readonly ExploitHandAction[] | null | undefined
): Map<string, OpenerAnswersThreeBetCell> {
  const out = new Map<string, OpenerAnswersThreeBetCell>();
  if (!Array.isArray(actions)) return out;
  let raises = 0;
  let opener: string | null = null;
  let answered = false;
  for (const a of actions) {
    if (!a || typeof a.userId !== 'string' || !a.userId) continue;
    if (!learnablePublicAction(a)) continue;
    if (a.stage !== 'preflop') continue;
    const aggr = aggressive(a);
    if (raises === 2 && a.userId === opener && !answered) {
      answered = true;
      const cell = emptyOpenerAnswersThreeBet();
      cell.opp = 1;
      if (a.action === 'fold') cell.fold = 1;
      else if (aggr) cell.raise = 1;
      else cell.call = 1;
      out.set(a.userId, cell);
    }
    if (aggr) {
      raises++;
      if (raises === 1) opener = a.userId;
    }
  }
  return out;
}

/** Age `row` and add one hand's increments: the node ages only on a hand that gave it an opportunity. */
export function openerAnswersThreeBetDecayAndAdd(
  row: OpenerAnswersThreeBetCell,
  inc: OpenerAnswersThreeBetCell
): void {
  if (!(inc.opp > 0)) return;
  for (const f of OPENER_FIELDS) row[f] = row[f] * EXPLOIT_DECAY + inc[f];
}

/** Exact shape; every number finite and non-negative; the three answers never exceed the opportunities. */
export function validOpenerAnswersThreeBet(v: unknown): v is OpenerAnswersThreeBetCell {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== OPENER_FIELDS.length) return false;
  for (const f of OPENER_FIELDS) {
    const x = o[f];
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return false;
  }
  const c = o as unknown as OpenerAnswersThreeBetCell;
  return c.fold + c.call + c.raise <= c.opp + 1e-9;
}

export interface OpenerAnswersRates {
  fold: number;
  call: number;
  raise: number;
}
export interface OpenerAnswersRead extends OpenerAnswersRates {
  /** 'measured': his own fold to a 3-bet entered; 'population': the fitted table alone */
  source: 'measured' | 'population';
  /** decayed opportunities behind the measured part (0: population) */
  opportunities: number;
  /** the population row used (game x depth bucket) */
  prior: string;
}

/** Depth buckets of the fitted table (effective stack in big blinds). */
export type OopReraiseDepthBucket = 'le135' | '135_250' | '250_500' | 'gt500';
export function oopReraiseDepthBucket(effBB: number): OopReraiseDepthBucket {
  if (!(effBB > 135)) return 'le135';
  if (effBB <= 250) return '135_250';
  if (effBB <= 500) return '250_500';
  return 'gt500';
}

/**
 * THE FITTED POPULATION ANSWER (version OPENER_ANSWERS_PRIOR_VERSION): how an opener answered an OUT-OF-POSITION 3-bet,
 * by game and depth, over every cash table hand in the window (people and Horses pooled: nothing here is keyed on who
 * the opener is). Fitted by server/scripts/oop-reraise-range/fit-opener-answers-three-bet.ts on a read-only
 * hand_history pull; n is the number of answers behind each row (a row under 30 carries the game's pooled answer).
 */
export const OPENER_ANSWERS_PRIOR_VERSION = '2026-11-24.v1';
export const OPENER_ANSWERS_PRIOR_WINDOW = '2026-11-17T07:00Z..2026-11-24T07:00Z';
export const OPENER_ANSWERS_PRIOR: Readonly<
  Record<
    OopReraiseGame,
    Readonly<Record<OopReraiseDepthBucket, OpenerAnswersRates & { n: number }>>
  >
> = Object.freeze({
  plo4: {
    le135: { fold: 0.2668, call: 0.6389, raise: 0.0943, n: 1994 },
    '135_250': { fold: 0.3937, call: 0.5574, raise: 0.0489, n: 4046 },
    '250_500': { fold: 0.3559, call: 0.6232, raise: 0.0209, n: 958 },
    gt500: { fold: 0.4839, call: 0.5161, raise: 0, n: 31 },
  },
  plo5: {
    le135: { fold: 0.211, call: 0.5521, raise: 0.2369, n: 1199 },
    '135_250': { fold: 0.4357, call: 0.4602, raise: 0.1041, n: 4276 },
    '250_500': { fold: 0.3595, call: 0.5181, raise: 0.1224, n: 2125 },
    gt500: { fold: 0.328, call: 0.4968, raise: 0.1752, n: 314 },
  },
  nlh: {
    le135: { fold: 0.483, call: 0.4385, raise: 0.0785, n: 4168 },
    '135_250': { fold: 0.6019, call: 0.3355, raise: 0.0626, n: 8601 },
    '250_500': { fold: 0.5648, call: 0.396, raise: 0.0392, n: 2578 },
    gt500: { fold: 0.5974, call: 0.3831, raise: 0.0195, n: 154 },
  },
});

/**
 * His answer to a 3-bet: the population row for the game and depth, with the fold share replaced by the posterior of
 * his own measured fold to a 3-bet (HorseOpponentExploit foldTo3Bet, the opener's own counter, public actions only)
 * against that row worth OPENER_ANSWERS_PRIOR_MASS opportunities. The continuing share is split call : 4-bet as the
 * population row splits it. A presumed read is no read (the caller passes null).
 */
export function openerAnswersThreeBetRead(
  game: OopReraiseGame,
  effBB: number,
  measuredFold: { mean: number; n: number } | null,
  /**
   * horse.openerAnswersPriorVersion 2 (OPENER_ANSWERS_PRIOR_INDIFFERENCE): the prior is the indifference answer to this
   * 3-bet (HorsePreflopIndifferenceAnchor.preflopAnswerToReraise) instead of the fitted table. Absent (version 1, the
   * compiled default): the fitted table, exactly as before.
   */
  anchor?: { size: number; openWidth: number; threeBetWidth: number } | null
): OpenerAnswersRead | null {
  const bucket = oopReraiseDepthBucket(effBB);
  const fitted = OPENER_ANSWERS_PRIOR[game]?.[bucket];
  if (!fitted) return null;
  const row: OpenerAnswersRates = anchor
    ? preflopAnswerToReraise(anchor.size, anchor.openWidth, anchor.threeBetWidth, 2)
    : fitted;
  const prior = anchor ? `${game}:indifference` : `${game}:${bucket}`;
  const n = measuredFold && Number.isFinite(measuredFold.n) ? Math.max(0, measuredFold.n) : 0;
  if (!measuredFold || !(n > 0) || !Number.isFinite(measuredFold.mean))
    return {
      fold: row.fold,
      call: row.call,
      raise: row.raise,
      source: 'population',
      opportunities: 0,
      prior,
    };
  const seen = Math.min(1, Math.max(0, measuredFold.mean));
  const fold = (seen * n + row.fold * OPENER_ANSWERS_PRIOR_MASS) / (n + OPENER_ANSWERS_PRIOR_MASS);
  const cont = row.call + row.raise;
  const callShare = cont > 0 ? row.call / cont : 0.5;
  return {
    fold,
    call: (1 - fold) * callShare,
    raise: (1 - fold) * (1 - callShare),
    source: 'measured',
    opportunities: n,
    prior,
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SPOT (public state and the Horse's own cards only)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface OopReraiseSpot {
  game: OopReraiseGame;
  openerSeat: number;
  openerId: string;
  heroBet: number;
  heroStack: number;
  openerBet: number;
  openerStack: number;
  /** the pot as it stands (every chip in, this street's bets included) */
  pot: number;
  currentBet: number;
  toCall: number;
  bigBlind: number;
  /** effective stack (hero against the opener, chips behind plus chips in) in big blinds */
  effBB: number;
  potLimit: boolean;
}

export interface OopReraiseExclusions {
  tournament: boolean;
  lightning: boolean;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  allInOrFold: boolean;
}

/** Order to act on a postflop street: the small blind first, the dealer last. */
function postflopOrder(seat: number, dealerSeat: number | undefined): number {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
}

const isAggression = (a: ActionRecord): boolean =>
  a.action === 'raise' || a.action === 'bet' || (a.action === 'all_in' && a.isFullRaise === true);

/** The game of a decision, or null outside the two options' games. */
export function oopReraiseGameOf(variant: unknown): OopReraiseGame | null {
  const v = String(variant ?? '').toLowerCase();
  return v === 'plo4' || v === 'plo5' || v === 'nlh' ? v : null;
}

/** The public state the spot reads. */
export interface OopReraiseState {
  stage?: unknown;
  gameVariant?: unknown;
  players: readonly SeatPlayer[];
  actionHistory?: readonly ActionRecord[];
  pot: number;
  currentBet: number;
  toCall?: number;
  bigBlind: number;
  dealerSeat?: number;
  legalActions?: readonly string[];
}

/**
 * The spot, or null: preflop, a cash table (never a tournament or a Lightning pool), high only, one board, no bomb
 * pot, exactly one raise so far (the open) by another player who is not all in, nobody in for the open but him, the
 * Horse out of position against him (acts first after the flop), facing a price, with a call and a raise legal.
 */
export function oopReraiseSpotOf(
  player: SeatPlayer,
  gs: OopReraiseState,
  ex: OopReraiseExclusions
): OopReraiseSpot | null {
  if (String(gs.stage ?? '') !== 'preflop') return null;
  const game = oopReraiseGameOf(gs.gameVariant);
  if (game === null) return null;
  if (ex.tournament || ex.lightning || ex.hiLo || ex.multiBoard || ex.bombPot || ex.allInOrFold)
    return null;
  if ((player.cards ?? []).length !== HOLE_COUNT[game]) return null;
  const legal = gs.legalActions;
  if (Array.isArray(legal)) {
    if (!legal.includes('call') || !legal.includes('fold')) return null;
    if (!legal.includes('raise') && !legal.includes('all_in')) return null;
  }
  const history = (gs.actionHistory ?? []).filter((a) => a.stage === 'preflop');
  // an all-in that is not a full raise still sets a price: the spot is not a clean open
  if (history.some((a) => a.action === 'all_in' && a.isFullRaise !== true)) return null;
  const raises = history.filter(isAggression);
  if (raises.length !== 1) return null;
  const openerSeat = raises[0]!.seat;
  if (openerSeat === player.seat) return null;
  const opener = gs.players.find((p) => p.seat === openerSeat);
  if (!opener || opener.is_folded || opener.is_all_in) return null;
  const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet) : 0;
  const heroStack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
  const openerBet = Number.isFinite(opener.bet) ? Math.max(0, opener.bet) : 0;
  const openerStack = Number.isFinite(opener.stack) ? Math.max(0, opener.stack) : 0;
  const currentBet = Number.isFinite(gs.currentBet) ? Math.max(0, gs.currentBet) : 0;
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, currentBet - heroBet);
  if (!(toCall > 0.005) || !(heroStack > toCall + 0.005) || !(openerStack > 0.005)) return null;
  // nobody else in for the open (a squeeze is another spot)
  const callers = gs.players.filter(
    (p) =>
      p.seat !== player.seat &&
      p.seat !== openerSeat &&
      !p.is_folded &&
      Number.isFinite(p.bet) &&
      p.bet >= currentBet - 0.005
  );
  if (callers.length > 0) return null;
  if (postflopOrder(player.seat, gs.dealerSeat) >= postflopOrder(openerSeat, gs.dealerSeat))
    return null;
  const bb = gs.bigBlind > 0 ? gs.bigBlind : 1;
  return {
    game,
    openerSeat,
    openerId: opener.user_id,
    heroBet,
    heroStack,
    openerBet,
    openerStack,
    pot: Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0,
    currentBet,
    toCall,
    bigBlind: bb,
    effBB: Math.min(heroStack + heroBet, openerStack + openerBet) / bb,
    potLimit: game !== 'nlh',
  };
}

/** The raise-to of a decision in the spot, or null when the decision does not re-raise. */
export function oopReraiseRaiseTo(
  decision: { action: string; amount?: number },
  spot: OopReraiseSpot
): number | null {
  const all = spot.heroBet + spot.heroStack;
  if (decision.action === 'all_in') return all > spot.currentBet + 0.005 ? all : null;
  if (decision.action !== 'raise') return null;
  const to = Number.isFinite(decision.amount) ? Math.min(all, decision.amount as number) : all;
  return to > spot.currentBet + 0.005 ? to : null;
}

/** The 4-bet priced: the pot-sized 4-bet (pot limit) or HOLDEM_FOUR_BET_MULTIPLE x the 3-bet, capped by his stack. */
export function oopReraiseFourBetTo(spot: OopReraiseSpot, raiseTo: number): number {
  const openerAll = spot.openerBet + spot.openerStack;
  const heroIn = raiseTo - spot.heroBet;
  const potAfter3 = spot.pot + heroIn;
  const want = spot.potLimit
    ? raiseTo + (potAfter3 + (raiseTo - spot.openerBet))
    : raiseTo * HOLDEM_FOUR_BET_MULTIPLE;
  return Math.min(openerAll, Math.round(want * 100) / 100);
}

/** The state fields the 4-bet frame moves. */
export interface OopReraiseFrameState {
  players: SeatPlayer[];
  actionHistory?: ActionRecord[];
  pot: number;
  currentBet: number;
  minRaise: number;
  toCall?: number;
  minRaiseTo?: number | null;
  maxRaiseTo?: number | null;
  legalActions?: string[];
  lastRaise?: number;
  pots?: unknown;
  contestablePot?: number;
}

/**
 * The public frame of the 4-bet: the Horse has raised to `raiseTo`, the opener has raised to `fourTo`, and the Horse is
 * to act. Only public state moves (bets, stacks, pot, the price, the legal menu and two action records); the Horse's
 * own cards are its own. Null when the frame cannot be built (the 3-bet is all in: there is no 4-bet to answer).
 */
export function oopReraiseFourBetFrame<G extends OopReraiseFrameState>(
  player: SeatPlayer,
  gs: G,
  spot: OopReraiseSpot,
  raiseTo: number,
  fourTo: number,
  at: number
): G | null {
  const heroAll = spot.heroBet + spot.heroStack;
  if (raiseTo >= heroAll - 0.005) return null;
  if (!(fourTo > raiseTo + 0.005)) return null;
  const heroIn = raiseTo - spot.heroBet;
  const openerIn = fourTo - spot.openerBet;
  const heroStack = Math.round((spot.heroStack - heroIn) * 100) / 100;
  const openerStack = Math.max(0, Math.round((spot.openerStack - openerIn) * 100) / 100);
  const pot = Math.round((spot.pot + heroIn + openerIn) * 100) / 100;
  const toCall = Math.min(fourTo - raiseTo, heroStack);
  const openerAllIn = openerStack <= 0.005;
  const raiseSize = fourTo - raiseTo;
  const minTo = fourTo + raiseSize;
  const maxTo = spot.potLimit ? Math.min(heroAll, fourTo + (pot + raiseSize)) : heroAll;
  const canRaise = !openerAllIn && heroStack > toCall + 0.005;
  // the replay harness's menu: with the opener all in the Horse calls or folds (all in is the call of everything)
  const legal = canRaise
    ? minTo < heroAll - 0.005
      ? ['fold', 'call', 'raise', 'all_in']
      : ['fold', 'call', 'all_in']
    : ['fold', 'call', 'all_in'];
  const players = gs.players.map((p) =>
    p.seat === player.seat
      ? { ...p, bet: raiseTo, stack: heroStack, totalInvested: (p.totalInvested ?? 0) + heroIn }
      : p.seat === spot.openerSeat
        ? {
            ...p,
            bet: fourTo,
            stack: openerStack,
            totalInvested: (p.totalInvested ?? 0) + openerIn,
            is_all_in: openerAllIn,
          }
        : p
  );
  const frame: G = {
    ...gs,
    players,
    pot,
    currentBet: fourTo,
    minRaise: raiseSize,
    toCall,
    minRaiseTo: canRaise ? Math.min(minTo, heroAll) : null,
    maxRaiseTo: canRaise ? maxTo : null,
    legalActions: legal,
    lastRaise: raiseSize,
    actionHistory: [
      ...(gs.actionHistory ?? []),
      {
        seat: player.seat,
        userId: player.user_id,
        action: 'raise',
        amount: raiseTo,
        timestamp: at,
        stage: 'preflop',
        isFullRaise: true,
      } as ActionRecord,
      {
        seat: spot.openerSeat,
        userId: spot.openerId,
        action: openerAllIn ? 'all_in' : 'raise',
        amount: fourTo,
        timestamp: at,
        stage: 'preflop',
        isFullRaise: true,
      } as ActionRecord,
    ],
  };
  // The pot layers are rebuilt by the engine at the street's end; a frame carries the one total.
  if (gs.pots !== undefined) delete (frame as { pots?: unknown }).pots;
  if (gs.contestablePot !== undefined) (frame as { contestablePot?: number }).contestablePot = pot;
  return frame;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PRICE
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type OopReraiseAnswer = 'fold' | 'call' | 'raise';

export interface OopReraiseInput {
  spot: OopReraiseSpot;
  hole: readonly Card[];
  dead: readonly Card[];
  raiseTo: number;
  answers: OpenerAnswersRead;
  /** the opener's open band (a percentile band of the game's preflop scale), or null for the prior band */
  openBand: readonly [number, number] | null;
  /** the Horse's own answer to the 4-bet on the frame (HorseLogic re-asks it); null when it could not be asked */
  fourBetAnswer: OopReraiseAnswer | null;
  /** the share of a pot (contested past the flop) the deduction takes: each branch is raked on its own pot */
  rakeOfPot: (pot: number) => number;
  /** whether the existing calling rule admits the call of the open (Omaha: omahaDowngradedThreeBetCalls; hold'em:
   *  the brain's call bar) */
  callAdmitted: boolean;
  /** the cap on the range's fold-to-4-bet share (horse.reraiseFoldShareCap) */
  cap: number;
  /** the Horse's id, for the planned-fold keep draw */
  horseId: string;
  /** holdem/omahaOopReraiseRangeReadsOpenerRecord (default OFF): this opener's own record of answering a 3-bet in
   *  position (HorseOpenerAnswersThreeBet), anchored to its baseline. Absent: the rule exactly as without it. */
  openerRecord?: OpenerFourBetRead | null;
}

export interface OopReraiseReceipt {
  version: 1;
  option: string;
  game: OopReraiseGame;
  effBB: number;
  raiseTo: number;
  fourBetTo: number;
  answers: {
    fold: number;
    call: number;
    raise: number;
    source: 'measured' | 'population';
    prior: string;
  };
  equity: { open: number | null; threeBetCalled: number; fourBet: number };
  realization: { call: number; threeBetCalled: number; fourBetCalled: number };
  ev: {
    call: number | null;
    alternative: number;
    threeBet: number;
    fourBet: { fold: number; call: number; raise: number; answered: number };
  };
  fourBetAnswer: OopReraiseAnswer | null;
  callAdmitted: boolean;
  plannedFold: boolean;
  blocker: boolean;
  /** the planned-fold keep: frequency asked for and the seeded unit drawn (null when no blocker planned fold) */
  keep: { frequency: number; unit: number; bucket: string } | null;
  cap: number;
  bluffBreakEven: number;
  verdict: 'kept' | 'called' | 'folded';
  reason:
    | 'priced_continue'
    | 'blocker_planned_fold'
    | 'below_alternative'
    | 'planned_fold'
    | 'opener_record_planned_fold'
    | 'opener_record_price';
  /** present only with the opener-record option on: his 4-bet read, and how hard the planned-fold guard bound */
  openerRecord?: {
    node: string;
    raise: number;
    answers: number;
    source: 'measured' | 'baseline';
    guardWeight: number;
  };
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function fnv(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const cardKey = (c: Card): string => `${c.rank}${c.suit[0]}`;

/** The planned-fold keep unit in [0, 1): a hash of the Horse's id, the pot and its own cards (no random stream). */
export function oopReraiseKeepUnit(horseId: string, pot: number, hole: readonly Card[]): number {
  const key = `${horseId}|${Math.round(pot * 100)}|${[...hole].map(cardKey).sort().join('')}|oop3`;
  return fnv(key) / 4294967296;
}

/** A blocker: the hand holds an ace (it removes the top of the 4-bettor's value range). */
export function oopReraiseBlocker(hole: readonly Card[]): boolean {
  return hole.some((c) => c.rank === 'A');
}

/**
 * Per bucket (game : depth : the opener's fold to a 3-bet, f0 under 0.25, f25 to 0.5, f50 above), measured by
 * server/scripts/oop-reraise-range/replay.ts with the options on (arm on2, 2026-11-24, the production options of the
 * day; four positions, three opener reads, the strategy stream from spread seeds):
 * cont = 3-bets that stand on their price and the Horse's own continue against the 4-bet, block = blocker 3-bets that
 * pass the price but whose answer is a fold, mix = the share of the standing 3-bets that fold at the replay's
 * separately asked 4-bet node (the Horse's own answer to a 4-bet is itself a mixed decision for some hands).
 */
export const OOP_RERAISE_BLOCKER_MASS_VERSION = '2026-11-24.v3';
export const OOP_RERAISE_BLOCKER_MASS: Readonly<
  Record<string, { cont: number; block: number; mix: number }>
> = Object.freeze({
  'nlh:135_250:f0': { cont: 405, block: 0, mix: 0.0 },
  'nlh:135_250:f50': { cont: 472, block: 876, mix: 0.0678 },
  'nlh:250_500:f0': { cont: 259, block: 0, mix: 0.0 },
  'nlh:250_500:f50': { cont: 250, block: 817, mix: 0.192 },
  'nlh:80_135:f0': { cont: 260, block: 0, mix: 0.0 },
  'nlh:80_135:f25': { cont: 160, block: 184, mix: 0.025 },
  'nlh:80_135:f50': { cont: 160, block: 235, mix: 0.025 },
  'nlh:gt500:f0': { cont: 131, block: 0, mix: 0.0 },
  'nlh:gt500:f50': { cont: 104, block: 357, mix: 0.2308 },
  'nlh:le80:f0': { cont: 331, block: 0, mix: 0.0 },
  'nlh:le80:f25': { cont: 160, block: 128, mix: 0.025 },
  'nlh:le80:f50': { cont: 160, block: 145, mix: 0.025 },
  'plo4:135_250:f0': { cont: 77, block: 0, mix: 0.0 },
  'plo4:135_250:f25': { cont: 54, block: 47, mix: 0.0 },
  'plo4:135_250:f50': { cont: 75, block: 139, mix: 0.0 },
  'plo4:250_500:f0': { cont: 48, block: 0, mix: 0.0 },
  'plo4:250_500:f25': { cont: 44, block: 24, mix: 0.0 },
  'plo4:250_500:f50': { cont: 48, block: 148, mix: 0.0 },
  'plo4:80_135:f0': { cont: 36, block: 0, mix: 0.0 },
  'plo4:80_135:f25': { cont: 40, block: 0, mix: 0.0 },
  'plo4:80_135:f50': { cont: 127, block: 0, mix: 0.0 },
  'plo4:gt500:f0': { cont: 36, block: 0, mix: 0.0 },
  'plo4:gt500:f25': { cont: 24, block: 12, mix: 0.0 },
  'plo4:gt500:f50': { cont: 28, block: 79, mix: 0.0 },
  'plo4:le80:f0': { cont: 63, block: 0, mix: 0.0 },
  'plo4:le80:f25': { cont: 65, block: 0, mix: 0.0 },
  'plo4:le80:f50': { cont: 127, block: 0, mix: 0.0 },
  'plo5:135_250:f0': { cont: 31, block: 0, mix: 0.0 },
  'plo5:135_250:f25': { cont: 56, block: 15, mix: 0.0 },
  'plo5:135_250:f50': { cont: 60, block: 66, mix: 0.0 },
  'plo5:250_500:f0': { cont: 25, block: 0, mix: 0.0 },
  'plo5:250_500:f25': { cont: 48, block: 8, mix: 0.0 },
  'plo5:250_500:f50': { cont: 48, block: 73, mix: 0.0 },
  'plo5:80_135:f0': { cont: 60, block: 0, mix: 0.0 },
  'plo5:80_135:f50': { cont: 81, block: 0, mix: 0.0 },
  'plo5:gt500:f0': { cont: 10, block: 0, mix: 0.0 },
  'plo5:gt500:f25': { cont: 16, block: 0, mix: 0.0 },
  'plo5:gt500:f50': { cont: 24, block: 21, mix: 0.0 },
  'plo5:le80:f0': { cont: 67, block: 0, mix: 0.0 },
  'plo5:le80:f50': { cont: 90, block: 0, mix: 0.0 },
});

/** The keep table's depth buckets (effective stack in big blinds). */
export function oopReraiseKeepDepth(effBB: number): string {
  if (!(effBB > 80)) return 'le80';
  if (effBB <= 135) return '80_135';
  if (effBB <= 250) return '135_250';
  if (effBB <= 500) return '250_500';
  return 'gt500';
}

/** The keep table's bucket: game, depth and the band of the opener's fold to a 3-bet. */
export function oopReraiseKeepBucket(
  game: OopReraiseGame,
  effBB: number,
  foldShare: number
): string {
  const band = !(foldShare >= 0.25) ? 'f0' : foldShare < 0.5 ? 'f25' : 'f50';
  return `${game}:${oopReraiseKeepDepth(effBB)}:${band}`;
}

/**
 * The keep frequency aims this far under the cap: the table pools positions and reads inside a bucket, its masses are
 * counts, and the keep draw is one seeded unit per hand, so the realized share of one table varies around the aim
 * (replay: aimed at the cap the NLH unread and tight-read rows at 100-200 bb came out up to 0.09 over it; aimed 0.05
 * under it, up to 0.03 over; realized keep frequency up to 0.07 above the asked one in a bucket).
 */
export const OOP_RERAISE_KEEP_MARGIN = 0.08;

/**
 * The planned-fold keep frequency q for a bucket. Kept blockers fold to the 4-bet, the standing range folds at its
 * measured mix share, so the range's fold share is (mix x cont + q x block) / (cont + q x block); holding it at
 * F = F* - OOP_RERAISE_KEEP_MARGIN (F* the cap) gives q = cont x (F - mix) / (block x (1 - F)), clamped to [0, 1]
 * (OOP_RERAISE_BLOCKER_MASS). A bucket not measured, or with no blocker mass, gets 0: no planned fold is kept.
 */
export function oopReraiseKeepFrequency(cap: number, bucket: string): number {
  const m = OOP_RERAISE_BLOCKER_MASS[bucket];
  if (!m || !(m.block > 0) || !(m.cont >= 0)) return 0;
  const f = clamp(cap - OOP_RERAISE_KEEP_MARGIN, 0, 0.95);
  const mix = clamp(Number.isFinite(m.mix) ? m.mix : 0, 0, 1);
  return clamp((m.cont * (f - mix)) / (m.block * (1 - f)), 0, 1);
}

/** The fold share at which a 4-bet of the given size breaks even with any hand when it is never called. */
export function oopReraiseBluffBreakEven(
  spot: OopReraiseSpot,
  raiseTo: number,
  fourTo: number
): number {
  const risk = Math.max(0, fourTo - spot.openerBet);
  const reward = spot.pot + (raiseTo - spot.heroBet);
  return risk + reward > 0 ? risk / (risk + reward) : 1;
}

/** Equity of the Horse's cards against the percentile band [lo, hi] of the game's hands. */
function equityAgainstBand(
  game: OopReraiseGame,
  hole: readonly Card[],
  dead: readonly Card[],
  lo: number,
  hi: number
): number | null {
  let a = clamp(lo, 0, 1);
  let b = clamp(hi, 0, 1);
  if (b - a < OOP_RERAISE_MIN_BAND) a = Math.max(0, b - OOP_RERAISE_MIN_BAND);
  if (b - a < OOP_RERAISE_MIN_BAND) b = Math.min(1, a + OOP_RERAISE_MIN_BAND);
  if (game === 'nlh') {
    // a percentile band [a, b] is the top (1 - a) of hands less the top (1 - b)
    const outer: HoldemClassRange = holdemTopRange(1 - a);
    const inner: HoldemClassRange = holdemTopRange(1 - b);
    const range = new Float64Array(169);
    let any = false;
    for (let i = 0; i < 169; i++) {
      range[i] = Math.max(0, outer[i] - inner[i]);
      if (range[i] > 0) any = true;
    }
    if (!any) return null;
    const seed = fnv(`${[...hole].map(cardKey).sort().join('')}|${r4(a)}|${r4(b)}`);
    return holdemRangeEquity(hole, [], [range], seed, OOP_RERAISE_HOLDEM_ITERATIONS);
  }
  // The same equity as omahaReraisedEquity(hole, [], dead, percentile in [a, b]), bit for bit, without its cost
  // (HorseOmahaReraisedPot.omahaReraisedEquityInPercentileBand, 2026-11-26).
  return omahaReraisedEquityInPercentileBand(hole, dead, a, b, OOP_RERAISE_OMAHA_SAMPLES);
}

/**
 * The verdict and its receipt, or null when the spot cannot be priced (no equity could be sampled): then the 3-bet
 * stands as the brain made it.
 */
export function oopReraiseVerdict(i: OopReraiseInput): OopReraiseReceipt | null {
  const { spot, hole, dead } = i;
  const unraked = (pot: number): number => {
    let r = 0;
    try {
      r = i.rakeOfPot(pot);
    } catch {
      r = 0;
    }
    return 1 - clamp(Number.isFinite(r) ? r : 0, 0, 0.5);
  };
  const raiseTo = Math.min(spot.heroBet + spot.heroStack, i.raiseTo);
  const fourTo = oopReraiseFourBetTo(spot, raiseTo);
  const P0 = spot.pot;
  const c0 = Math.min(spot.toCall, spot.heroStack);
  const I3 = raiseTo - spot.heroBet;
  // The opener's open band and the three answer bands inside it, strongest first: 4-bet, call, fold.
  const [blo, bhi] =
    i.openBand && i.openBand[1] > i.openBand[0] ? i.openBand : OOP_RERAISE_PRIOR_OPEN_BAND;
  const W = bhi - blo;
  // With the opener-record option and a measured record, the 4-bet share is his own (anchored) rate and the rest of
  // what does not fold is a call; otherwise the population's split, as without the option.
  const rec = i.openerRecord ?? null;
  const measuredSplit = rec !== null && rec.source === 'measured';
  const fold0 = clamp(i.answers.fold, 0, 1);
  const rho = measuredSplit ? clamp(rec.raise, 0, 1 - fold0) : clamp(i.answers.raise, 0, 1);
  const kappa = measuredSplit ? clamp(1 - fold0 - rho, 0, 1) : clamp(i.answers.call, 0, 1 - rho);
  const phi = clamp(1 - rho - kappa, 0, 1);
  const fourLo = bhi - rho * W;
  const callLo = bhi - (rho + kappa) * W;
  const eqFour = equityAgainstBand(spot.game, hole, dead, fourLo, bhi);
  const eqCalled = equityAgainstBand(spot.game, hole, dead, callLo, fourLo);
  if (eqFour === null || eqCalled === null) return null;
  const eqOpen = i.callAdmitted ? equityAgainstBand(spot.game, hole, dead, blo, bhi) : null;
  // The call of the open.
  const potCall = P0 + c0;
  const spr1 = Math.max(0, Math.min(spot.heroStack - c0, spot.openerStack)) / potCall;
  const shape = spot.game === 'nlh' ? 0 : omahaPreflopDefenceShape(hole);
  const R = (spr: number, equity: number | null): number =>
    omahaPreflopDefenceRealization(false, spr, 0, shape, 0, equity ?? undefined);
  const rCall = R(spr1, eqOpen);
  const evCall = eqOpen === null ? null : rCall * eqOpen * potCall * unraked(potCall) - c0;
  const alternative = i.callAdmitted && evCall !== null ? Math.max(0, evCall) : 0;
  // The 3-bet called.
  const openerCalls = Math.min(spot.openerStack, Math.max(0, raiseTo - spot.openerBet));
  const pot3 = P0 + I3 + openerCalls;
  const spr3 = Math.max(0, Math.min(spot.heroStack - I3, spot.openerStack - openerCalls)) / pot3;
  const r3 = R(spr3, eqCalled);
  const evCalled = r3 * eqCalled * pot3 * unraked(pot3) - I3;
  // The 4-bet.
  const openerIn4 = Math.max(0, fourTo - spot.openerBet);
  const C4 = Math.min(Math.max(0, fourTo - raiseTo), Math.max(0, spot.heroStack - I3));
  const pot4 = P0 + I3 + openerIn4 + C4;
  const spr4 = Math.max(0, Math.min(spot.heroStack - I3 - C4, spot.openerStack - openerIn4)) / pot4;
  const rFour = R(spr4, eqFour);
  const v4Fold = -I3;
  const v4Call = rFour * eqFour * pot4 * unraked(pot4) - I3 - C4;
  const eff = Math.min(spot.heroBet + spot.heroStack, spot.openerBet + spot.openerStack);
  const dead0 = Math.max(0, P0 - spot.heroBet - spot.openerBet);
  const potJam = dead0 + 2 * eff;
  const v4Raise = eqFour * potJam * unraked(potJam) - (eff - spot.heroBet);
  const answer = i.fourBetAnswer;
  const v4 =
    answer === 'fold'
      ? v4Fold
      : answer === 'call'
        ? v4Call
        : answer === 'raise'
          ? v4Raise
          : Math.max(v4Fold, v4Call, v4Raise);
  const evThree = phi * P0 + kappa * evCalled + rho * v4;
  const plannedFold = answer === 'fold';
  const blocker = oopReraiseBlocker(hole);
  const be = oopReraiseBluffBreakEven(spot, raiseTo, fourTo);
  const cap = clamp(Number.isFinite(i.cap) ? i.cap : RERAISE_FOLD_SHARE_CAP_DEFAULT, 0, be);
  let keep: OopReraiseReceipt['keep'] = null;
  const guardWeight = rec !== null ? plannedFoldGuardWeight(rec) : 1;
  let verdict: OopReraiseReceipt['verdict'];
  let reason: OopReraiseReceipt['reason'];
  const called = (): OopReraiseReceipt['verdict'] =>
    i.callAdmitted && evCall !== null && evCall >= 0 ? 'called' : 'folded';
  // With the opener-record option, the price test binds in proportion to this opener's own 4-bet record too: the rule
  // exists for the 4-bet, and against an opener whose record shows he does not 4-bet a 3-bet priced below the call
  // stands at the seeded frequency 1 - w (league probes 2026-11-24: the NLH price borrows the Omaha realization fit
  // and, applied in full, cost 21 bb/100 heads-up against an opener who calls every 3-bet).
  const priceRelaxed = rec !== null && oopReraiseKeepUnit(i.horseId, P0, hole) < 1 - guardWeight;
  if (evThree < alternative && !priceRelaxed) {
    verdict = called();
    reason = 'below_alternative';
  } else if (!plannedFold) {
    verdict = 'kept';
    reason = evThree < alternative ? 'opener_record_price' : 'priced_continue';
  } else if (blocker) {
    const bucket = oopReraiseKeepBucket(spot.game, spot.effBB, phi);
    // the guard binds in proportion to this opener's 4-bet record (1, as without the option, with none)
    const relax = rec !== null ? 1 - guardWeight : 0;
    const frequency = Math.max(oopReraiseKeepFrequency(cap, bucket), relax);
    const unit = oopReraiseKeepUnit(i.horseId, P0, hole);
    keep = { frequency: r4(frequency), unit: r4(unit), bucket };
    if (unit < frequency) {
      verdict = 'kept';
      reason = 'blocker_planned_fold';
    } else {
      verdict = called();
      reason = 'planned_fold';
    }
  } else if (rec !== null && guardWeight < 1) {
    // a planned fold without a blocker stands only as often as this opener's own record says he does not 4-bet
    const relax = 1 - guardWeight;
    const unit = oopReraiseKeepUnit(i.horseId, P0, hole);
    keep = { frequency: r4(relax), unit: r4(unit), bucket: 'opener_record' };
    if (unit < relax) {
      verdict = 'kept';
      reason = 'opener_record_planned_fold';
    } else {
      verdict = called();
      reason = 'planned_fold';
    }
  } else {
    verdict = called();
    reason = 'planned_fold';
  }
  return {
    version: 1,
    option: OOP_RERAISE_GAMES[spot.game],
    game: spot.game,
    effBB: r4(spot.effBB),
    raiseTo: r4(raiseTo),
    fourBetTo: r4(fourTo),
    answers: {
      fold: r4(phi),
      call: r4(kappa),
      raise: r4(rho),
      source: i.answers.source,
      prior: i.answers.prior,
    },
    equity: {
      open: eqOpen === null ? null : r4(eqOpen),
      threeBetCalled: r4(eqCalled),
      fourBet: r4(eqFour),
    },
    realization: { call: r4(rCall), threeBetCalled: r4(r3), fourBetCalled: r4(rFour) },
    ev: {
      call: evCall === null ? null : r4(evCall),
      alternative: r4(alternative),
      threeBet: r4(evThree),
      fourBet: { fold: r4(v4Fold), call: r4(v4Call), raise: r4(v4Raise), answered: r4(v4) },
    },
    fourBetAnswer: answer,
    callAdmitted: i.callAdmitted,
    plannedFold,
    blocker,
    keep,
    cap: r4(cap),
    bluffBreakEven: r4(be),
    verdict,
    reason,
    ...(rec !== null
      ? {
          openerRecord: {
            node: rec.node,
            raise: r4(rec.raise),
            answers: r4(rec.answers),
            source: rec.source,
            guardWeight: r4(guardWeight),
          },
        }
      : {}),
  };
}

/** The answer class of a decision on the 4-bet frame. */
export function oopReraiseAnswerOf(
  decision: { action: string },
  frameToCall: number,
  heroStackOnFrame: number
): OopReraiseAnswer {
  if (decision.action === 'fold') return 'fold';
  if (decision.action === 'raise') return 'raise';
  if (decision.action === 'all_in')
    return heroStackOnFrame > frameToCall + 0.005 ? 'raise' : 'call';
  return 'call';
}

/**
 * Receipt validation (responseValidation): at this request, could the rule turn a raise into a call of exactly
 * `amount`? The spot re-derived from the request (public state, own cards) and the exact chips of the call; the price
 * reads the opponent memory, which the request does not carry, so this is the request-pure superset the gate admits
 * only under the decision's own option.
 */
export function oopReraiseAdmitsCall(
  player: SeatPlayer,
  gs: OopReraiseState & {
    gameMode?: string;
    tournament?: unknown;
    bombPot?: boolean;
    allInOrFold?: boolean;
  },
  amount: number | null | undefined
): boolean {
  try {
    const spot = oopReraiseSpotOf(player, gs, {
      tournament:
        gs.gameMode === 'tournament' || (gs.gameMode === undefined && gs.tournament != null),
      lightning: false,
      hiLo: false,
      multiBoard: false,
      bombPot: gs.bombPot === true,
      allInOrFold: gs.allInOrFold === true,
    });
    if (spot === null) return false;
    return (
      amount !== null &&
      amount !== undefined &&
      Math.abs(amount - Math.round(Math.min(spot.toCall, spot.heroStack) * 100) / 100) <= 0.005
    );
  } catch {
    return false;
  }
}
