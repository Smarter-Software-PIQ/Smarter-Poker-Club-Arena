/**
 * OMAHA FACING A BET ON THE FLOP: THE SAME PRICED DECISION THE TURN AND THE
 * RIVER HAVE (2026-11-17, PLO Strategy lane; option omahaFlopFacingBetEv,
 * default OFF, read `=== true`).
 *
 * Owner, 2026-11-16: a decision rests on the hand, the equity, the opponent's
 * range and the price, never on the size of the bet alone, and no blanket
 * rule may block a correct decision.
 *
 * What decided before. HorseOmahaFacingBetEv gives the turn and the river one
 * expected-value verdict facing a bet. The flop had none, so two rules with
 * no equity term decided there: the paired-board fold (a call of a quarter of
 * the stack below a full house folds, HorsePloPairedBoardFold) and the range
 * read's 20 big blind "big bet" mark (HorseMind), which tiers the bettor's
 * range by a chip count; omahaBigBetIsPotShare corrects that mark on the turn
 * and the river only. Measured against one winning player (archive
 * plo-handoff-review-01a1cbbd/audit2-01BNteGZ): Horses folded to 71 percent
 * of his flop bets and folded the best hand on 21 percent of those folds.
 *
 * What this module is: for PLO4 / PLO5 cash, one board, high only, on the
 * flop, when the Horse faces a bet or a raise, the verdict of
 * HorseOmahaFacingBetEv with two cards to come.
 *
 *  HAND    The Horse's showdown result on two-card runouts against opponent
 *          holdings drawn from the unseen cards (its own cards, the flop and
 *          known dead cards removed). The turn walks every river card and
 *          counts every holding exactly; the flop has 946 to 990 runouts and
 *          that count would take seconds, so the flop is SAMPLED with a fixed
 *          seed taken from the cards: a balanced set of runouts (every unseen
 *          card the turn card of the same number of them and the river card
 *          of as many), and on each the hand meets holdings of the bettor's
 *          value region and of his other holdings, walked evenly through
 *          each. The same cards always give the same numbers; the brain's
 *          random stream is not touched.
 *  PLAYER  The bettor's range is a VALUE region (the strongest share V of
 *          holdings on the flop as it stands) and a share q of every other
 *          holding (draws, weaker made hands, air). V comes from the bet's
 *          share of the pot, whether it is a raise and the line (a lead into
 *          the preflop aggressor, or a stab after he checked; never absolute
 *          chips); q from the same, moved by his measured tendencies
 *          (omahaEvBluffShare, the turn and river function). The size sets
 *          the RANGE; it never decides.
 *  PRICE   EV(call) on the actual pot and call, against the one margin of
 *          the turn and river rule.
 *  LATER   A flop call with chips behind does not get its showdown equity:
 *          there are two streets of betting first. The realization factor is
 *          read from the hand's OWN runouts (omahaFlopRunoutRealization):
 *          equity that sits on runouts where the hand can call again is
 *          realized, equity that sits on runouts where it is a bluff-catcher
 *          is realized only when the street is checked. That model is then
 *          CORRECTED BY MEASUREMENT (2026-11-18): what flop calls of each
 *          hand class (made hand, draw, one pair or less) in and out of
 *          position really returned in production, shrunk toward the model
 *          by the size of each sample (OMAHA_FLOP_EV_REALIZATION_FIT), and
 *          scaled by how much is left to bet (a straight line from nothing
 *          behind to a pot behind; no step). No flat factor and no term in
 *          the size of the bet or a share of the stack.
 *  FIELD   Every other player in the hand is priced on the SAME runouts as
 *          the bettor (2026-11-18; the first cut multiplied separate "must
 *          also beat him" shares, gave no pot credit for a player behind and
 *          capped the realization at 0.85, and folded sets). A caller or an
 *          earlier all-in holds a hand from his range that must be beaten
 *          together with the bettor's. A player still to act folds, or
 *          continues with his call in the pot and his hand to beat, at the
 *          measured continue rate for a bet of this share of the pot.
 *
 * Measured constants (docs/horse-option-authority.d/
 * omahaFlopFacingBetEv.CONSTANTS.md: sources, sample sizes, intervals): the
 * realization cells, the continue rate of a player behind, the stab factor
 * and the sampling error. Still STATED, not measured: the flop value shares
 * and non-value shares (they extend the turn rows), the caller's range share
 * and the bounds of the runout model. The option stays OFF until its declared
 * league evaluation passes (docs/horse-option-authority.d/
 * omahaFlopFacingBetEv.md).
 *
 * Pure: no telemetry, no opponent memory, no draw from the brain's random
 * stream; the only state is a memo of the last few sampled hands (the same
 * cards give the same sample). The rule that applies the verdict is
 * HorseOmahaFlopFacingBetEvRule.ts.
 */
import type { Card, SeatPlayer } from '../types.js';
import { plo6ValueShareAtSameStrength } from './HorsePlo6ValueShare.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import { omahaComboStraightOuts } from './HorseOmahaBigDrawAggression.js';
import {
  OMAHA_EV_ALL_IN_SHARE,
  omahaBetSizeBucket,
  omahaEvBluffShare,
  type OmahaBetSizeBucket,
  type OmahaFacingBetEvRead,
} from './HorseOmahaFacingBetEv.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import {
  omahaFlopDefenceTreeEv,
  type OmahaFlopDefenceTreeInputs,
  type OmahaFlopDefenceTreeResult,
} from './HorseOmahaFlopDefenceTree.js';

/** PLO4 and PLO5 only. PLO6 is not opened by omahaStrategyInPlo6: the six-card flop is unmeasured. */
export const OMAHA_FLOP_FACING_BET_EV_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/**
 * VALUE REGION on the flop: the share of all holdings (strongest on the flop
 * first) the bettor bets for value at this size. Wider than the turn row of
 * HorseOmahaFacingBetEv at every size (turn 0.5 / 0.38 / 0.28 / 0.18, raise
 * 0.14): ranges narrow street by street. Stated, not measured.
 */
export const OMAHA_FLOP_EV_VALUE_SHARE: Readonly<Record<OmahaBetSizeBucket | 'raise', number>> = {
  under40: 0.56,
  mid: 0.46,
  big: 0.36,
  over: 0.26,
  raise: 0.18,
};
/**
 * The share of a flop bet that is NOT in the value region (a draw, a weaker
 * made hand, air), by the bet's share of the pot: the prior the measured read
 * then moves. Above the turn row (0.34 / 0.4 / 0.22 / 0.22, raise 0.15): a
 * flop bet holds more draws than a turn bet. One measured anchor, one player
 * (archive audit2-01BNteGZ, 721 PLO5 hands): 45 percent of his bets on
 * unpaired rainbow flops and 57 percent on two-tone flops were a draw, one
 * pair or air; on paired flops 27 percent were pair-level or less. The
 * population is assumed tighter than that player. Stated, not measured.
 */
export const OMAHA_FLOP_EV_PRIOR_OTHER: Readonly<Record<OmahaBetSizeBucket | 'raise', number>> = {
  under40: 0.4,
  mid: 0.42,
  big: 0.32,
  over: 0.28,
  raise: 0.18,
};
/**
 * THE LINE. A bet into the preflop aggressor BEFORE he has acted on the flop
 * (a lead) is a narrower range than a continuation bet: the value share and
 * the non-value share both take OMAHA_FLOP_EV_LEAD (the later streets' own
 * aggressor-line factor). A bet AFTER the preflop aggressor checked the flop
 * (a stab) is not a lead: it is wider than a lead and narrower than a
 * continuation bet, and takes OMAHA_FLOP_EV_STAB.
 *
 * Measured (docs/horse-option-authority.d/omahaFlopFacingBetEv.CONSTANTS.md,
 * section "Line"): in 9,974 PLO4/PLO5 cash hands with a person seated the
 * preflop raiser bet 59.6 percent of the flops he could open (n 6,332), a
 * player acting before him led 5.1 percent (n 6,686) and a player he had
 * checked to bet 30.9 percent (n 2,249). The stab factor sits between the
 * lead factor and 1 where the stab rate sits between the lead rate and the
 * continuation-bet rate: 0.8 + 0.2 x (0.309 - 0.051) / (0.596 - 0.051) = 0.89,
 * rounded to 0.9.
 */
export const OMAHA_FLOP_EV_LEAD = 0.8;
export const OMAHA_FLOP_EV_STAB = 0.9;
/** The field on the flop: a caller of this bet holds this share of holdings (turn 0.45, river 0.35). Stated. */
export const OMAHA_FLOP_EV_CALLER_SHARE = 0.55;
/**
 * A PLAYER STILL TO ACT continues against the bet this often, by the bet's
 * share of the pot (points joined by straight lines, flat outside them).
 * Measured on the same hands (CONSTANTS file, section "Continue"): every
 * decision facing the first flop bet, 8,875 of them: bets under a quarter of
 * the pot were continued 79.2 percent (n 576), a quarter to a half 60.7
 * (n 2,882), a half to four fifths 40.7 (n 2,860), larger 30.3 (n 2,557).
 * The size sets how often he comes along (a range), never the decision.
 */
export const OMAHA_FLOP_EV_BEHIND_CONTINUE: ReadonlyArray<readonly [number, number]> = [
  [0.125, 0.792],
  [0.375, 0.607],
  [0.65, 0.407],
  [1, 0.303],
];
export function omahaFlopEvBehindContinue(potFrac: number): number {
  const pts = OMAHA_FLOP_EV_BEHIND_CONTINUE;
  if (!Number.isFinite(potFrac) || potFrac <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++)
    if (potFrac <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (potFrac - x0)) / (x1 - x0);
    }
  return pts[pts.length - 1][1];
}
/** Most other players (beyond the bettor) the joint count draws a holding for; a larger field is not answered. */
export const OMAHA_FLOP_EV_FIELD_MAX = 5;

/**
 * THE SAMPLE. The pool places the value region (holdings drawn uniformly and
 * ordered by strength on the flop). The runouts are a balanced design: the
 * unseen cards are shuffled once into a circle, every card is the turn card
 * of RIVERS runouts and the river card of RIVERS others, and no runout
 * repeats (RIVERS by the number of other players the count draws a holding
 * for: none, one, two, three or more; a larger field costs more per runout).
 * On each runout the hand meets VALUE_PER_RUNOUT holdings of the bettor's
 * value region and OTHER_PER_RUNOUT of his other holdings, each walked
 * evenly through its region, and with every such holding one holding for
 * each other player, all on disjoint cards. The number of holdings per
 * runout is the same for every field, so the realization read from the
 * runouts does not depend on how many players are in.
 *
 * Measured (CONSTANTS file, section "Sampling"): the spread of EV over other
 * seeds of the same decision, as a share of the pot, against the margin of
 * 0.02; and the time it takes.
 */
export const OMAHA_FLOP_EV_POOL = 1280;
export const OMAHA_FLOP_EV_RIVERS: readonly number[] = [12, 8, 6, 4];
export const OMAHA_FLOP_EV_VALUE_PER_RUNOUT = 2;
export const OMAHA_FLOP_EV_OTHER_PER_RUNOUT = 1;
/** Holdings looked at, in order of strength from the walk's place, for one clear of the cards already in use. */
export const OMAHA_FLOP_EV_DRAW_TRIES = 256;

/** Columns of one runout's row (OmahaFlopEvCounts.rows): wins (+ half ties) vs value, value holdings, the same vs the rest. */
export const OMAHA_FLOP_RUNOUT_ROW = 4;
/**
 * REALIZATION, read from the runouts. On the river of a runout the hand calls
 * a bet when it beats at least CALLS_AT of his value region there and folds
 * under FOLDS_AT; on the turn card of a runout (one card to come) the same
 * with the turn bounds, on its average over the river cards sampled for that
 * turn card. Linear in between.
 */
export const OMAHA_FLOP_RUNOUT_RIVER_CALLS_AT = 0.5;
export const OMAHA_FLOP_RUNOUT_RIVER_FOLDS_AT = 0.2;
export const OMAHA_FLOP_RUNOUT_TURN_CALLS_AT = 0.35;
export const OMAHA_FLOP_RUNOUT_TURN_FOLDS_AT = 0.15;
/** Share of streets a non-value holding checks rather than bets, by the Horse's position. */
export const OMAHA_FLOP_RUNOUT_CHECKDOWN: Readonly<Record<'ip' | 'oop', number>> = {
  ip: 0.6,
  oop: 0.45,
};
/** His non-value share at which a bluff-catch is right whatever the hand: the checkdown share rises to 1 from MIN to MAX. */
export const OMAHA_FLOP_RUNOUT_BLUFF_CATCH_MIN = 0.35;
export const OMAHA_FLOP_RUNOUT_BLUFF_CATCH_MAX = 0.6;
/** Bounds of the factor read from the runouts (the model, before the measured correction). */
export const OMAHA_FLOP_RUNOUT_REALIZATION_MIN = 0.3;
export const OMAHA_FLOP_RUNOUT_REALIZATION_MAX = 1;

// ─────────────────── realization measured by class and position ───────────────────

/** What the hand is on the flop, for the measured correction. */
export type OmahaFlopHandClass = 'made' | 'draw' | 'pair';
/**
 * The class of a flop hand: 'made' is two pair or better under the two-card
 * rule; 'draw' is anything below that with a flush draw or eight or more
 * straight outs (the repository's one definition of a draw,
 * HorseOmahaBigDrawAggression); 'pair' is one pair or less with no such draw.
 */
export function omahaFlopHandClass(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = []
): OmahaFlopHandClass {
  const h = [...hole];
  const b = [...board];
  if (Math.floor(scoreOmahaHiPartial(h, b) / 0x100000) >= 3) return 'made';
  const onBoard = new Map<string, number>();
  for (const c of b) onBoard.set(c.suit, (onBoard.get(c.suit) ?? 0) + 1);
  for (const [suit, count] of onBoard)
    if (count === 2 && h.filter((c) => c.suit === suit).length >= 2) return 'draw';
  return omahaComboStraightOuts(hole, board, dead) >= 8 ? 'draw' : 'pair';
}

/**
 * THE MEASURED CORRECTION of the realization factor, by hand class and
 * position. The runout model above says how much of its share of the pot a
 * call keeps; production says what such calls really brought back.
 *
 * Source: the lane's shared realization table (realfit-013U37,
 * realization-fit.json): Horse callers, any bettor, PLO4/PLO5 cash with a
 * person seated, flop calls; realization = chips realized / (EXACT equity
 * against the hands really left in x the pot at stake), hierarchically shrunk.
 * Its classes are pooled into ours by equity mass (made = two pair or better;
 * draw = nut or combo draw + weak draw; pair = one pair + air).
 *
 * That realization is on exact equity; this verdict multiplies a share of the
 * pot against MODELLED ranges, which runs high (exact / model 0.78 to 0.94 by
 * cell on the same calls). So `ratio` is solved, cell by cell, on the lane's
 * 2,010 first flop calls by a Horse (starting stacks corrected): the
 * multiplier on the model's factor for which the verdict's expected realized
 * chips, sum S x P x (1 + (m x ratio - 1) x L), equal the measured
 * realization times the exact equity, R x sum E x P (S the verdict's share,
 * E the exact share, P the pot net of rake, m the model's factor, L the share
 * of later streets left to play). `n` is the table's number of calls.
 * Source, intervals, the solve and the scripts:
 * docs/horse-option-authority.d/omahaFlopFacingBetEv.CONSTANTS.md.
 *
 * The factor applied is the model's factor times
 *   1 + (ratio - 1) x n / (n + OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS):
 * a cell with few calls stays near the model, a cell with many moves to its
 * measurement, continuously. No term is the size of the bet or a share of
 * the stack.
 */
export interface OmahaFlopRealizationCell {
  ratio: number;
  n: number;
}
export type OmahaFlopRealizationFit = Readonly<
  Record<OmahaFlopHandClass, Readonly<Record<'ip' | 'oop', OmahaFlopRealizationCell>>>
>;
export const OMAHA_FLOP_EV_REALIZATION_FIT: OmahaFlopRealizationFit = {
  made: { ip: { ratio: 0.892, n: 504 }, oop: { ratio: 0.688, n: 829 } },
  draw: { ip: { ratio: 0.9, n: 333 }, oop: { ratio: 1.027, n: 510 } },
  pair: { ip: { ratio: 0.576, n: 747 }, oop: { ratio: 0.518, n: 1136 } },
};
/**
 * Calls the model's own factor is worth: (the spread of the realization per
 * call in the table, measured 2.92 on the flop: SE 0.046 x sqrt(4,059)) over
 * (the uncertainty of the model's factor, stated 0.3), squared (CONSTANTS
 * file, section "Shrinkage").
 */
export const OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS = 95;
/** Bounds of the factor after the correction. Above 1: made hands were paid on later streets. */
export const OMAHA_FLOP_EV_REALIZATION_FLOOR = 0;
export const OMAHA_FLOP_EV_REALIZATION_CEILING = 1.25;
/**
 * LATER STREETS COUNT BY WHAT IS LEFT TO BET. With nothing behind there is no
 * later decision and the hand gets its showdown equity; with a pot-sized bet
 * or more behind (this many pots after the call) it gets the factor in full.
 * In between the factor moves in a straight line: no step at any stack share.
 */
export const OMAHA_FLOP_EV_REALIZATION_FULL_BEHIND = 1;

export interface OmahaFlopFittedRealization {
  /** the factor applied */
  realization: number;
  /** the measured ratio of the cell, the weight it was given and the multiplier that results */
  ratio: number;
  weight: number;
  multiplier: number;
}

/**
 * The realization applied to a flop call: the model's factor, corrected by
 * the measured cell (shrunk by its sample), then moved toward 1 by the share
 * of the later streets that has no chips left to play (`later` in [0, 1]).
 */
export function omahaFlopFittedRealization(
  model: number,
  klass: OmahaFlopHandClass,
  inPosition: boolean,
  later: number,
  fit: OmahaFlopRealizationFit = OMAHA_FLOP_EV_REALIZATION_FIT
): OmahaFlopFittedRealization {
  const cell = fit[klass][inPosition ? 'ip' : 'oop'];
  const n = Number.isFinite(cell.n) ? Math.max(0, cell.n) : 0;
  const weight = n / (n + OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS);
  const ratio = Number.isFinite(cell.ratio) ? cell.ratio : 1;
  const multiplier = 1 + (ratio - 1) * weight;
  const corrected = Math.max(
    OMAHA_FLOP_EV_REALIZATION_FLOOR,
    Math.min(OMAHA_FLOP_EV_REALIZATION_CEILING, model * multiplier)
  );
  return { realization: 1 + (corrected - 1) * clamp01(later), ratio, weight, multiplier };
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

// ───────────────────────────── the sample ─────────────────────────────

export interface OmahaFlopEvShares {
  win: number;
  tie: number;
}

/** The other players the hand must beat on the same runout, beyond the bettor. */
export interface OmahaFlopEvField {
  /** range share (strongest share of holdings) of each player already in: a caller, a player all in before the flop */
  always: readonly number[];
  /** players still to act, and the range share of one who continues */
  behind: number;
  behindShare: number;
}

/** Against the bettor and every player already in, with j of the players still to act continuing. */
export interface OmahaFlopEvJointShares {
  /** the hand wins the whole pot */
  win: number;
  /** it ties for the pot, and the share of the pot it takes on those ties (summed over them) */
  tie: number;
  tieShare: number;
}

export interface OmahaFlopEvCounts {
  /** unseen cards, hole count */
  unseen: number;
  holeCount: number;
  /** the seed the sample was drawn with (a function of the cards alone) */
  seed: number;
  /** holdings drawn to place the value region, runouts walked, showdowns scored */
  pool: number;
  runouts: number;
  samples: number;
  /** against the bettor alone: his value region and every other holding, over the runouts */
  value: OmahaFlopEvShares;
  other: OmahaFlopEvShares;
  /** against the bettor and the field TOGETHER on the same runout, by the number of players behind who continue (index 0..behind) */
  jointValue: OmahaFlopEvJointShares[];
  jointOther: OmahaFlopEvJointShares[];
  /** the value region's share of the drawn holdings */
  valueShare: number;
  /** against the strongest share of holdings on the flop, by share */
  top: (share: number) => OmahaFlopEvShares & { share: number };
  /** OMAHA_FLOP_RUNOUT_ROW numbers per runout, and the turn card (index) of each */
  rows: Float64Array;
  turnOf: Int16Array;
}

function unseenCards(hole: Card[], board: Card[], dead: Card[]): Card[] | null {
  const known = [...hole, ...board, ...dead];
  if (known.some((c) => !c || !RANKS.includes(c.rank as never) || !SUITS.includes(c.suit as never)))
    return null;
  if (new Set([...hole, ...board].map(key)).size !== hole.length + board.length) return null;
  const removed = new Set(known.map(key));
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!removed.has(key(card))) unseen.push(card);
    }
  return unseen;
}

/** The sample's seed: the cards, whatever order they were given in. */
export function omahaFlopEvSeed(hole: Card[], board: Card[], dead: Card[]): number {
  let h = 0x811c9dc5;
  const mix = (t: string): void => {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const group of [hole, board, dead]) {
    for (const k of group.map(key).sort()) mix(k);
    mix('|');
  }
  return h >>> 0 || 1;
}

/** mulberry32: this module's own stream, never the brain's. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FlopSample {
  id: string;
  counts: Map<string, OmahaFlopEvCounts>;
}
const FLOP_SAMPLES: FlopSample[] = [];
const FLOP_SAMPLES_MAX = 4;
const NO_FIELD: OmahaFlopEvField = { always: [], behind: 0, behindShare: 1 };
/** The golden-ratio step: successive draws walk a region evenly. */
const WALK = 0.6180339887498949;

let flopEvSampledRunCount = 0;
/** How many times omahaFlopEvCounts has dealt a fresh flop sample in this process (for latency work laws). */
export function omahaFlopEvSampledRuns(): number {
  return flopEvSampledRunCount;
}

/** Test seam: forget the remembered hands. */
export function omahaFlopEvCountsResetCache(): void {
  FLOP_SAMPLES.length = 0;
}

/**
 * The sampled counts for one flop hand: the Horse's win and tie shares at
 * showdown against the bettor's value region (the strongest `valueShare` of
 * holdings on the flop) and against his other holdings, over two-card
 * runouts, alone and TOGETHER with the field (one holding for every other
 * player on the same runout, on disjoint cards: a caller or an all-in from
 * his range share, a player still to act from the range he continues with).
 * Null when the cards do not form a four or five card Omaha flop hand or the
 * field is larger than OMAHA_FLOP_EV_FIELD_MAX. Deterministic: the seed is
 * the cards (omahaFlopEvSeed); an optional `salt` moves it (measurement of
 * the sampling error only; the decision never passes one).
 */
export function omahaFlopEvCounts(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number,
  field: OmahaFlopEvField = NO_FIELD,
  salt = 0,
  riversPerTurn?: number,
  sixCards = false
): OmahaFlopEvCounts | null {
  if (!Array.isArray(hole) || !Array.isArray(board)) return null;
  // sixCards: plo6FacingBetIsPriced's own caller only (HorsePlo6FacingBetIsPriced.ts); every other caller four or five.
  if (
    (hole.length !== 4 && hole.length !== 5 && !(sixCards === true && hole.length === 6)) ||
    board.length !== 3
  )
    return null;
  const deadCards = Array.isArray(dead) ? dead : [];
  const unseen = unseenCards(hole, board, deadCards);
  if (!unseen) return null;
  const m = unseen.length;
  const n = hole.length;
  if (m < n + 10 || m > 48) return null;
  if (!(scoreOmahaHiPartial(hole, board) > 0)) return null;
  const share = Math.max(0.02, Math.min(0.95, Number.isFinite(valueShare) ? valueShare : 0.5));
  const regionOf = (s: number): number => Math.max(0.02, Math.min(1, Number.isFinite(s) ? s : 1));
  const always = (Array.isArray(field?.always) ? field.always : []).map(regionOf);
  const B = Math.max(0, Math.floor(Number.isFinite(field?.behind) ? field.behind : 0));
  const behindShare = regionOf(field?.behindShare ?? 1);
  const A = always.length;
  if (A + B > OMAHA_FLOP_EV_FIELD_MAX) return null;
  const id = `${hole.map(key).sort().join(',')}|${board.map(key).sort().join(',')}|${deadCards
    .map(key)
    .sort()
    .join(',')}`;
  const countsKey = `${Math.round(share * 10000)}|${always
    .map((s) => Math.round(s * 10000))
    .join(',')}|${B}|${Math.round(behindShare * 10000)}|${salt >>> 0}${
    riversPerTurn === undefined ? '' : `|r${riversPerTurn}`
  }`;
  let entry = FLOP_SAMPLES.find((s) => s.id === id);
  if (entry) {
    const hit = entry.counts.get(countsKey);
    if (hit) return hit;
    if (entry.counts.size > 12) entry.counts.clear();
  } else {
    entry = { id, counts: new Map() };
    FLOP_SAMPLES.unshift(entry);
    if (FLOP_SAMPLES.length > FLOP_SAMPLES_MAX) FLOP_SAMPLES.length = FLOP_SAMPLES_MAX;
  }
  flopEvSampledRunCount++;
  const seed =
    (omahaFlopEvSeed(hole, board, deadCards) ^ Math.imul(salt >>> 0, 0x85ebca6b)) >>> 0 || 1;
  const rnd = stream(seed);
  const pick = stream((seed ^ 0x9e3779b9) >>> 0 || 1);

  // Every unseen pair's score on the flop: a holding is worth its best pair.
  const scores = new Float64Array(m * m);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < m; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < m; j++) {
      two[1] = unseen[j];
      scores[i * m + j] = scoreOmahaHiPartial(two, board);
    }
  }

  // The pool: holdings drawn uniformly, ordered by their strength on the flop.
  const P = OMAHA_FLOP_EV_POOL;
  const cards = new Int8Array(P * n);
  const strength = new Float64Array(P);
  // each holding's cards as two bit sets (unseen index under 24, and from 24)
  const lo = new Int32Array(P);
  const hi = new Int32Array(P);
  const deck = new Int8Array(m);
  for (let i = 0; i < m; i++) deck[i] = i;
  for (let p = 0; p < P; p++) {
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(rnd() * (m - k));
      const t = deck[k];
      deck[k] = deck[j];
      deck[j] = t;
      const c = deck[k];
      cards[p * n + k] = c;
      if (c < 24) lo[p] |= 1 << c;
      else hi[p] |= 1 << (c - 24);
    }
    let best = 0;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const x = cards[p * n + a];
        const y = cards[p * n + b];
        const s = x < y ? scores[x * m + y] : scores[y * m + x];
        if (s > best) best = s;
      }
    strength[p] = best;
  }
  const order = Array.from({ length: P }, (_, p) => p).sort(
    (a, b) => strength[b] - strength[a] || a - b
  );
  /** percentile of each pool holding: 1/P is the strongest */
  const pct = new Float64Array(P);
  for (let k = 0; k < P; k++) pct[order[k]] = (k + 1) / P;
  const vc = Math.max(1, Math.min(P - 1, Math.round(share * P)));

  // The runouts: the unseen cards in a shuffled circle; every card is the turn
  // card with the cards R evenly spaced steps further round as its rivers. A
  // step is under half the circle, so no two runouts hold the same two cards.
  const circle = new Int16Array(m);
  for (let i = 0; i < m; i++) circle[i] = i;
  for (let i = m - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = circle[i];
    circle[i] = circle[j];
    circle[j] = t;
  }
  const half = Math.floor((m - 1) / 2);
  const others = A + B;
  // riversPerTurn (a caller's smaller sample; absent for every facing-bet caller): fewer rivers per turn card.
  const R = Math.min(
    riversPerTurn !== undefined && Number.isFinite(riversPerTurn) && riversPerTurn >= 1
      ? Math.floor(riversPerTurn)
      : OMAHA_FLOP_EV_RIVERS[Math.min(3, others)],
    half
  );

  const start = rnd();
  const steps = new Int16Array(R);
  for (let k = 0; k < R; k++) steps[k] = 1 + (Math.floor(((k + start) * half) / R) % half);

  const perValue = OMAHA_FLOP_EV_VALUE_PER_RUNOUT;
  const perOther = OMAHA_FLOP_EV_OTHER_PER_RUNOUT;
  const rows = new Float64Array(m * R * OMAHA_FLOP_RUNOUT_ROW);
  const turnOf = new Int16Array(m * R);
  const five: Card[] = [board[0], board[1], board[2], board[0], board[0]];
  const opp: Card[] = new Array<Card>(n);
  // per showdown against the bettor: the holding's percentile and the result (1 win, 0.5 tie, 0 loss)
  const valPct: number[] = [];
  const valRes: number[] = [];
  const othPct: number[] = [];
  const othRes: number[] = [];
  let valWin = 0;
  let valTie = 0;
  let valN = 0;
  let othWin = 0;
  let othTie = 0;
  let othN = 0;
  // joint counts by the number of players behind who continue: win, tie, tie share
  const jv = new Float64Array((B + 1) * 3);
  const jo = new Float64Array((B + 1) * 3);
  let showdowns = 0;
  const scoreOf = (p: number): number => {
    for (let k = 0; k < n; k++) opp[k] = unseen[cards[p * n + k]];
    showdowns++;
    return scoreOmahaHiPartial(opp, five);
  };
  // The walk of each region: the bettor's value holdings, his others, and one per other player.
  let walkValue = pick();
  let walkOther = pick();
  const walkField = new Float64Array(others);
  const fieldCount = new Int32Array(others);
  for (let f = 0; f < others; f++) {
    walkField[f] = pick();
    fieldCount[f] = Math.max(1, Math.min(P, Math.round((f < A ? always[f] : behindShare) * P)));
  }
  const fieldScore = new Float64Array(others);
  /** A holding of a region (`count` positions of the order from `from`) clear of the cards in use, or -1. */
  const draw = (
    at: number,
    from: number,
    count: number,
    usedLo: number,
    usedHi: number
  ): number => {
    const i = Math.floor(at * count);
    const most = Math.min(count, OMAHA_FLOP_EV_DRAW_TRIES);
    for (let tries = 0; tries < most; tries++) {
      const p = order[from + ((i + tries) % count)];
      if ((lo[p] & usedLo) === 0 && (hi[p] & usedHi) === 0) return p;
    }
    return -1;
  };
  let at = 0;
  for (let t = 0; t < m; t++) {
    const turn = circle[t];
    five[3] = unseen[turn];
    for (let k = 0; k < R; k++) {
      const river = circle[(t + steps[k]) % m];
      five[4] = unseen[river];
      const hero = scoreOmahaHiPartial(hole, five);
      let boardLo = 0;
      let boardHi = 0;
      if (turn < 24) boardLo |= 1 << turn;
      else boardHi |= 1 << (turn - 24);
      if (river < 24) boardLo |= 1 << river;
      else boardHi |= 1 << (river - 24);
      let vw = 0;
      let vn = 0;
      let ow = 0;
      let on = 0;
      for (let s = 0; s < perValue + perOther; s++) {
        const isValue = s < perValue;
        let p: number;
        if (isValue) {
          walkValue = (walkValue + WALK) % 1;
          p = draw(walkValue, 0, vc, boardLo, boardHi);
        } else {
          walkOther = (walkOther + WALK) % 1;
          p = draw(walkOther, vc, P - vc, boardLo, boardHi);
        }
        if (p < 0) continue;
        let usedLo = boardLo | lo[p];
        let usedHi = boardHi | hi[p];
        let whole = true;
        for (let f = 0; f < others; f++) {
          walkField[f] = (walkField[f] + WALK) % 1;
          const g = draw(walkField[f], 0, fieldCount[f], usedLo, usedHi);
          if (g < 0) {
            whole = false;
            break;
          }
          usedLo |= lo[g];
          usedHi |= hi[g];
          fieldScore[f] = scoreOf(g);
        }
        if (!whole) continue;
        const bettor = scoreOf(p);
        const res = hero > bettor ? 1 : hero === bettor ? 0.5 : 0;
        if (isValue) {
          vn++;
          vw += res;
          valN++;
          if (res === 1) valWin++;
          else if (res === 0.5) valTie++;
          valPct.push(pct[p]);
          valRes.push(res);
        } else {
          on++;
          ow += res;
          othN++;
          if (res === 1) othWin++;
          else if (res === 0.5) othTie++;
          othPct.push(pct[p]);
          othRes.push(res);
        }
        // Together: the bettor and every player already in, then the players behind one by one.
        let best = bettor;
        let tied = hero === bettor ? 1 : 0;
        for (let f = 0; f < A; f++) {
          if (fieldScore[f] > best) best = fieldScore[f];
          if (fieldScore[f] === hero) tied++;
        }
        const acc = isValue ? jv : jo;
        for (let j = 0; j <= B; j++) {
          if (j > 0) {
            const x = fieldScore[A + j - 1];
            if (x > best) best = x;
            if (x === hero) tied++;
          }
          if (hero > best) acc[j * 3]++;
          else if (hero === best) {
            acc[j * 3 + 1]++;
            acc[j * 3 + 2] += 1 / (1 + tied);
          }
        }
      }
      const o4 = at * OMAHA_FLOP_RUNOUT_ROW;
      rows[o4] = vw;
      rows[o4 + 1] = vn;
      rows[o4 + 2] = ow;
      rows[o4 + 3] = on;
      turnOf[at] = turn;
      at++;
    }
  }
  if (!(valN > 0) || !(othN > 0)) return null;
  const vShare = vc / P;
  const value = { win: valWin / valN, tie: valTie / valN };
  const other = { win: othWin / othN, tie: othTie / othN };
  const jointOf = (acc: Float64Array, count: number): OmahaFlopEvJointShares[] =>
    Array.from({ length: B + 1 }, (_, j) => ({
      win: acc[j * 3] / count,
      tie: acc[j * 3 + 1] / count,
      tieShare: acc[j * 3 + 2] / count,
    }));
  const topMemo = new Map<number, OmahaFlopEvShares & { share: number }>();
  /** The showdowns against holdings at or above a percentile, in one region. */
  const within = (
    pcts: number[],
    res: number[],
    upTo: number,
    whole: OmahaFlopEvShares
  ): OmahaFlopEvShares => {
    let w = 0;
    let ti = 0;
    let c = 0;
    for (let i = 0; i < pcts.length; i++)
      if (pcts[i] <= upTo + 1e-12) {
        c++;
        if (res[i] === 1) w++;
        else if (res[i] === 0.5) ti++;
      }
    // Too few showdowns to read a narrower slice: the region as a whole.
    return c >= 24 ? { win: w / c, tie: ti / c } : whole;
  };
  const out: OmahaFlopEvCounts = {
    unseen: m,
    holeCount: n,
    seed,
    pool: P,
    runouts: at,
    samples: showdowns,
    value,
    other,
    jointValue: jointOf(jv, valN),
    jointOther: jointOf(jo, othN),
    valueShare: vShare,
    top: (s: number) => {
      const want = Math.max(0.02, Math.min(1, s));
      const k = Math.round(want * 1000);
      let r = topMemo.get(k);
      if (!r) {
        if (want <= vShare) r = { ...within(valPct, valRes, want, value), share: want };
        else {
          const rest = within(othPct, othRes, want, other);
          const a = vShare / want;
          r = {
            win: a * value.win + (1 - a) * rest.win,
            tie: a * value.tie + (1 - a) * rest.tie,
            share: want,
          };
        }
        topMemo.set(k, r);
      }
      return r;
    },
    rows: rows.subarray(0, at * OMAHA_FLOP_RUNOUT_ROW),
    turnOf: turnOf.subarray(0, at),
  };
  entry.counts.set(countsKey, out);
  return out;
}

// ─────────────────────────── realization ───────────────────────────

export interface OmahaFlopRunoutRealization {
  /** the factor, within [MIN, MAX] */
  realization: number;
  /** share of the hand's flop equity that sits on runouts where it calls the turn and the river */
  robustShare: number;
  runouts: number;
}

/**
 * The realization factor of a flop call with chips behind, from the hand's
 * own runouts (OmahaFlopEvCounts.rows / turnOf), or null when there is
 * nothing to read.
 *
 * Runout by runout it asks what realization is about: can the hand call
 * again? On the turn card of the runout it calls a bet when its equity
 * against his value region with one card to come (the average over the river
 * cards sampled for that turn card) reaches the turn bounds; on the river
 * when it beats enough of his value region there. Equity against his value
 * region is realized only where the hand calls both streets. Equity against
 * his other holdings is also realized on a street he checks
 * (OMAHA_FLOP_RUNOUT_CHECKDOWN by position; all of it when his non-value
 * share is high enough that a bluff-catch is right). No term is the size of
 * the bet; the board's texture enters through the cards.
 *
 * @param bluffShare  q: the share of the bettor's range that is not value
 * @param inPosition  the Horse acts last on the later streets
 * @param laterBetFactor  omahaFlopVerdictReadsTheBettor only: this bettor's turn and river bet rate over his
 *                    kind's (HorseOmahaFlopBettorRead); the share of later streets a non-value holding BETS is
 *                    multiplied by it. Absent or 1: the population's share, the arithmetic unchanged.
 */
export function omahaFlopRunoutRealization(
  rows: ArrayLike<number> | null | undefined,
  turnOf: ArrayLike<number> | null | undefined,
  bluffShare: number,
  inPosition: boolean,
  laterBetFactor?: number
): OmahaFlopRunoutRealization | null {
  const W = OMAHA_FLOP_RUNOUT_ROW;
  if (!rows || !turnOf || rows.length < W || rows.length !== turnOf.length * W) return null;
  if (!Number.isFinite(bluffShare)) return null;
  const q = clamp01(bluffShare);
  const count = turnOf.length;
  let valN = 0;
  let othN = 0;
  const turnWin = new Map<number, number>();
  const turnN = new Map<number, number>();
  for (let k = 0; k < count; k++) {
    const vw = rows[k * W];
    const vn = rows[k * W + 1];
    const ow = rows[k * W + 2];
    const on = rows[k * W + 3];
    if (![vw, vn, ow, on].every((x) => Number.isFinite(x) && x >= 0)) return null;
    valN += vn;
    othN += on;
    const t = turnOf[k];
    turnWin.set(t, (turnWin.get(t) ?? 0) + vw);
    turnN.set(t, (turnN.get(t) ?? 0) + vn);
  }
  // The weights of the verdict's own blend: pWin = q x other + (1 - q) x value.
  const wVal = valN > 0 ? (1 - q) / valN : 0;
  const wOth = othN > 0 ? q / othN : 0;
  const population = OMAHA_FLOP_RUNOUT_CHECKDOWN[inPosition ? 'ip' : 'oop'];
  const base =
    laterBetFactor === undefined || laterBetFactor === 1 || !Number.isFinite(laterBetFactor)
      ? population
      : clamp01(1 - (1 - population) * Math.max(0, laterBetFactor));
  const catches = clamp01(
    (q - OMAHA_FLOP_RUNOUT_BLUFF_CATCH_MIN) /
      (OMAHA_FLOP_RUNOUT_BLUFF_CATCH_MAX - OMAHA_FLOP_RUNOUT_BLUFF_CATCH_MIN)
  );
  const checked = base + (1 - base) * catches;
  let total = 0;
  let realized = 0;
  let robust = 0;
  for (let k = 0; k < count; k++) {
    const vw = rows[k * W];
    const vn = rows[k * W + 1];
    const ow = rows[k * W + 2];
    // No value holding met on this runout: nothing there bets the hand off.
    const beatsRiver = vn > 0 ? vw / vn : 1;
    const tn = turnN.get(turnOf[k]) ?? 0;
    const beatsTurn = tn > 0 ? (turnWin.get(turnOf[k]) ?? 0) / tn : 1;
    const callsRiver = clamp01(
      (beatsRiver - OMAHA_FLOP_RUNOUT_RIVER_FOLDS_AT) /
        (OMAHA_FLOP_RUNOUT_RIVER_CALLS_AT - OMAHA_FLOP_RUNOUT_RIVER_FOLDS_AT)
    );
    const callsTurn = clamp01(
      (beatsTurn - OMAHA_FLOP_RUNOUT_TURN_FOLDS_AT) /
        (OMAHA_FLOP_RUNOUT_TURN_CALLS_AT - OMAHA_FLOP_RUNOUT_TURN_FOLDS_AT)
    );
    const eqVal = wVal * vw;
    const eqOth = wOth * ow;
    total += eqVal + eqOth;
    realized +=
      eqVal * callsTurn * callsRiver +
      eqOth * (checked + (1 - checked) * callsTurn) * (checked + (1 - checked) * callsRiver);
    robust += (eqVal + eqOth) * callsTurn * callsRiver;
  }
  if (!(total > 0)) return null;
  return {
    realization: Math.max(
      OMAHA_FLOP_RUNOUT_REALIZATION_MIN,
      Math.min(OMAHA_FLOP_RUNOUT_REALIZATION_MAX, realized / total)
    ),
    robustShare: robust / total,
    runouts: count,
  };
}

// ───────────────────────────── the spot ─────────────────────────────

export interface OmahaFlopFacingBetEvSpot {
  street: 'flop';
  /** The seat whose bet or raise the Horse faces. */
  bettorSeat: number;
  /** The wager as a share of the pot before it (heads-up: the part of it the Horse can call). */
  potFrac: number;
  bucket: OmahaBetSizeBucket;
  /** The wager is a raise over an earlier wager on the flop. */
  isRaise: boolean;
  /** The bettor did not make the last preflop raise and bets into the live player who did, before that player acted on the flop. */
  lead: boolean;
  /** The bettor did not make the last preflop raise and bets after the live player who did checked the flop. */
  stab: boolean;
  /** Other players in the hand: called this wager, all in before the flop, still to act. */
  callers: number;
  allIns: number;
  behind: number;
  /** What a player still to act adds to the pot this call can win when he calls (the average over them; 0 with none). */
  behindCall: number;
  /** Chips the call puts in, and the chips it can win. */
  paid: number;
  winnable: number;
  /** The call is for the whole stack. */
  allIn: boolean;
  /** No later decision: the whole stack, or nobody left who can bet. */
  final: boolean;
  /** The share of the later streets left to play: 0 (nothing behind) to 1 (a pot-sized bet or more behind). */
  later: number;
  /** The value share used for this bet and line, and the prior non-value share. */
  valueShare: number;
  priorBluff: number;
}

/**
 * The flop spot the decision covers, with its public numbers, or null outside
 * it: PLO4 / PLO5 cash (never a tournament), high only, one board, not a bomb
 * pot, not all-in-or-fold, wagers not capped, the flop, facing a bet or a
 * raise with a fold and a call both legal. It does not look at the Horse's
 * hand beyond its card count, or at the decision it will judge.
 */
export function omahaFlopFacingBetEvSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  scope?: { plo6Priced?: boolean }
): OmahaFlopFacingBetEvSpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    // plo6FacingBetIsPriced's own caller (HorsePlo6FacingBetIsPriced.ts) opens the PLO6 cash flop.
    const plo6Priced = scope?.plo6Priced === true && variant === 'plo6';
    if (!plo6Priced && !OMAHA_FLOP_FACING_BET_EV_VARIANTS.has(variant)) return null;
    if (omahaIsTournamentMode(gs)) return null;
    if (
      gs.stage !== 'flop' ||
      gs.variantRules?.splitLow8OrBetter ||
      (gs.boardCount ?? 1) !== 1 ||
      gs.communityCards2?.length ||
      gs.communityCards3?.length ||
      gs.bombPot === true ||
      gs.allInOrFold ||
      gs.wagersCapped === true
    )
      return null;
    const board = gs.communityCards ?? [];
    const hole = player.cards ?? [];
    if (board.length !== 3 || hole.length !== Number(variant.at(-1))) return null;
    // The league and offline states carry no toCall: it is the current bet less the Horse's own.
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Number.isFinite(gs.currentBet) && Number.isFinite(player.bet)
        ? Math.max(0, gs.currentBet - player.bet)
        : NaN;
    if (
      !Number.isFinite(toCall) ||
      !(toCall > 0.005) ||
      !Number.isFinite(gs.currentBet) ||
      !Number.isFinite(gs.pot) ||
      !(gs.pot > 0) ||
      !Number.isFinite(player.stack) ||
      !(player.stack > 0) ||
      !Number.isFinite(player.bet) ||
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

    const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, 'flop', bets, gs.pot);
    if (!faced || faced.bettorSeat === player.seat) return null;
    const bettor = gs.players.find((p) => p.seat === faced.bettorSeat);
    if (!bettor || bettor.is_folded || bettor.is_sitting_out) return null;
    // Heads-up, a wager the Horse cannot cover is a bet of what the Horse can call.
    const onlyBettorLive = gs.players.every(
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
    if (!Number.isFinite(potFrac) || !(potFrac > 0)) return null;

    // The last preflop raiser (the level raised over the forced posts), when there was one.
    let preLevel = 0;
    let preAggressor: number | null = null;
    const preTotals = new Map<number, number>();
    const foldedBeforeWager = new Set<number>();
    for (const a of gs.actionHistory ?? []) {
      if (String(a.stage) !== 'preflop') continue;
      const prev = preTotals.get(a.seat) ?? 0;
      const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
      if (a.action === 'fold') foldedBeforeWager.add(a.seat);
      else if (a.action === 'call') preTotals.set(a.seat, prev + amt);
      else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
        const now = Math.max(prev, amt);
        preTotals.set(a.seat, now);
        if (now > preLevel + 0.005) {
          preLevel = now;
          preAggressor = a.seat;
        }
      } else if (amt > preLevel) preLevel = amt; // a forced post sets the level; it is not a raise
    }
    // The flop line: how many times the level was raised (a second wager is a
    // raise), and whether the preflop raiser was still in the hand and had
    // checked WHEN THE FIRST WAGER WAS MADE (what he does afterwards does not
    // change the range that bet came from).
    let level = 0;
    let wagers = 0;
    let aggressorChecked = false;
    const totals = new Map<number, number>();
    for (const a of gs.actionHistory ?? []) {
      if (String(a.stage) !== 'flop') continue;
      const prev = totals.get(a.seat) ?? 0;
      const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
      if (a.action === 'check') {
        if (a.seat === preAggressor && wagers === 0) aggressorChecked = true;
      } else if (a.action === 'fold') {
        if (wagers === 0) foldedBeforeWager.add(a.seat);
      } else if (a.action === 'call') totals.set(a.seat, prev + amt);
      else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
        const now = Math.max(prev, amt);
        totals.set(a.seat, now);
        if (now > level + 0.005) {
          level = now;
          wagers++;
        }
      }
    }
    const isRaise = wagers >= 2;
    const aggressorLive =
      preAggressor !== null &&
      !foldedBeforeWager.has(preAggressor) &&
      gs.players.some((p) => p.seat === preAggressor && !p.is_sitting_out);
    const intoAggressor = !isRaise && aggressorLive && preAggressor !== faced.bettorSeat;
    const lead = intoAggressor && !aggressorChecked;
    const stab = intoAggressor && aggressorChecked;

    // The field.
    let callers = 0;
    let allIns = 0;
    let behind = 0;
    let behindCalls = 0;
    let uncovered = 0;
    let canStillBet = 0;
    const heroTotal = player.bet + paid;
    for (const p of gs.players) {
      if (p.seat === player.seat || p.is_folded || p.is_sitting_out) continue;
      const bet = Number.isFinite(p.bet) ? Math.max(0, p.bet) : 0;
      // What a short call cannot win from this player's street wager.
      uncovered += Math.max(0, Math.min(bet, gs.currentBet) - heroTotal);
      if (!p.is_all_in && Number.isFinite(p.stack) && p.stack > 0.005) canStillBet++;
      if (p.seat === faced.bettorSeat) continue;
      if (p.is_all_in && bet <= 0.005) allIns++;
      else if (p.is_all_in || bet + 0.011 >= gs.currentBet) callers++;
      else {
        behind++;
        // What his call adds that this call can win: up to the Horse's own total on the street.
        const stack = Number.isFinite(p.stack) ? Math.max(0, p.stack) : 0;
        behindCalls += Math.max(0, Math.min(bet + stack, gs.currentBet, heroTotal) - bet);
      }
    }
    const winnable = gs.pot - uncovered;
    if (!(winnable > 0)) return null;
    const leftBehind = player.stack - paid;
    const final = allIn || canStillBet === 0;
    const later = final
      ? 0
      : clamp01(leftBehind / (OMAHA_FLOP_EV_REALIZATION_FULL_BEHIND * (winnable + paid)));
    const bucket = omahaBetSizeBucket(potFrac);
    const line = lead ? OMAHA_FLOP_EV_LEAD : stab ? OMAHA_FLOP_EV_STAB : 1;
    return {
      street: 'flop',
      bettorSeat: faced.bettorSeat,
      potFrac,
      bucket,
      isRaise,
      lead,
      stab,
      callers,
      allIns,
      behind,
      behindCall: behind > 0 ? behindCalls / behind : 0,
      paid,
      winnable,
      allIn,
      final,
      later,
      // plo6FacingBetIsPriced: the six-card region at the same hand strength (HorsePlo6ValueShare).
      valueShare: plo6Priced
        ? plo6ValueShareAtSameStrength(
            hole,
            board,
            player.knownDeadCards ?? [],
            OMAHA_FLOP_EV_VALUE_SHARE[isRaise ? 'raise' : bucket] * line
          )
        : OMAHA_FLOP_EV_VALUE_SHARE[isRaise ? 'raise' : bucket] * line,
      priorBluff: OMAHA_FLOP_EV_PRIOR_OTHER[isRaise ? 'raise' : bucket] * line,
    };
  } catch {
    return null;
  }
}

// ───────────────────────────── the verdict ─────────────────────────────

export interface OmahaFlopFacingBetEvVerdict {
  call: boolean;
  /** EV of the call in chips, and the margin it had to exceed. */
  ev: number;
  margin: number;
  /** the realized shares the EV used (over the ways the players behind can act) */
  pWin: number;
  pTie: number;
  /** the non-value share used and the value share sampled */
  bluffShare: number;
  valueShare: number;
  /** the Horse's win share against the value region / the other holdings, the bettor alone */
  vsValue: number;
  vsOther: number;
  /** the hand's share of the pot against everybody together, before the realization factor */
  potShare: number;
  /** that share over its share against the bettor alone (1 heads-up) */
  field: number;
  /** how often a player still to act was priced to continue (0 with none) */
  continueShare: number;
  /** the hand's class, the factor of the runout model, the measured multiplier and the factor applied */
  klass: OmahaFlopHandClass;
  modelRealization: number;
  fitMultiplier: number;
  realization: number;
  robustShare: number | null;
  /** pot odds of the call, for the record */
  price: number;
  /** work done, and the seed it was drawn with */
  runouts: number;
  samples: number;
  seed: number;
  /** omahaFlopVerdictReadsTheBettor only (absent otherwise): the factors of this bettor's read the verdict applied */
  bettorRangeFactor?: number;
  bettorLaterBetFactor?: number;
  /**
   * omahaFlopDefenceIsPriced: the two-street tree that priced this call in
   * place of equity x realization (HorseOmahaFlopDefenceTree.ts), or null when
   * it did not (option off, or outside its heads-up first-bet spot).
   */
  tree?: OmahaFlopDefenceTreeResult | null;
}

/** omahaFlopDefenceIsPriced: what the rule hands the verdict (absent with the option off). */
export interface OmahaFlopDefenceTreeContext {
  inputs: OmahaFlopDefenceTreeInputs;
  /** the Horse's chips behind after the call */
  left: number;
}

/** omahaFlopVerdictReadsTheBettor: what one bettor's street record moves (HorseOmahaFlopBettorRead). */
export interface OmahaFlopBettorAdjustment {
  /** the factor on the value share and on the non-value share of his bet (1: the population's range) */
  rangeFactor: number;
  /** the factor on the share of later streets a non-value holding of his bets (1: the population's) */
  laterBetFactor: number;
}
/** Bounds of a value share moved by a bettor's read. */
export const OMAHA_FLOP_EV_BETTOR_VALUE_SHARE_MIN = 0.02;
export const OMAHA_FLOP_EV_BETTOR_VALUE_SHARE_MAX = 0.95;

export interface OmahaFlopFacingBetEvContext {
  /** the marginal rake on the pot, as a fraction (0 when capped or none) */
  rake?: number;
  /** the Horse acts last on the later streets */
  inPosition?: boolean;
  /** measurement only: moves the sample's seed (the decision never passes one) */
  salt?: number;
  /** measurement only: realization cells in place of the fitted ones (the decision never passes them) */
  fit?: OmahaFlopRealizationFit;
  /** omahaFlopDefenceIsPriced: price the heads-up first-bet call as a two-street tree */
  tree?: OmahaFlopDefenceTreeContext | null;
  /** plo6FacingBetIsPriced only: sample a six-card hand (omahaFlopEvCounts sixCards). Absent: four or five cards. */
  sixCards?: boolean;
  /** omahaFlopVerdictReadsTheBettor only: this bettor's read. Absent: every number is the verdict's own. */
  bettor?: OmahaFlopBettorAdjustment;
  /** omahaCbetRaiseIsPriced only: the spot's value share IS his measured raising range; no bluff share is added */
  measuredRaiseRange?: boolean;
}

function binomial(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

/**
 * The decision: call when EV(call) exceeds the one margin. Null when the hand
 * cannot be sampled.
 *
 * THE FIELD is priced on the same runouts as the bettor: the hand must beat
 * the bettor's holding and a holding of every player already in TOGETHER (a
 * joint count, not a product of separate shares), and each player still to
 * act either folds (the pot stays as it is) or continues (his call is in the
 * pot and his holding must be beaten too), at the rate players continue
 * against a bet of this share of the pot. EV is the sum over the number who
 * continue. There is no cap on the realization for a player behind: what he
 * costs is in that sum.
 */
export function omahaFlopFacingBetEvVerdict(
  spot: OmahaFlopFacingBetEvSpot,
  hole: Card[],
  board: Card[],
  dead: Card[],
  read: OmahaFacingBetEvRead | null,
  ctx: OmahaFlopFacingBetEvContext = {}
): OmahaFlopFacingBetEvVerdict | null {
  const callerShare =
    spot.potFrac < 0.25
      ? 1 - (1 - OMAHA_FLOP_EV_CALLER_SHARE) * (spot.potFrac / 0.25)
      : OMAHA_FLOP_EV_CALLER_SHARE;
  const always: number[] = [];
  for (let i = 0; i < spot.callers; i++) always.push(callerShare);
  for (let i = 0; i < spot.allIns; i++) always.push(OMAHA_EV_ALL_IN_SHARE);
  // omahaFlopVerdictReadsTheBettor: one factor on both shares of this bettor's range (a factor of exactly 1
  // leaves every number as it is).
  const rangeFactor =
    ctx.bettor && Number.isFinite(ctx.bettor.rangeFactor) && ctx.bettor.rangeFactor > 0
      ? ctx.bettor.rangeFactor
      : 1;
  const valueShare =
    rangeFactor === 1
      ? spot.valueShare
      : Math.max(
          OMAHA_FLOP_EV_BETTOR_VALUE_SHARE_MIN,
          Math.min(OMAHA_FLOP_EV_BETTOR_VALUE_SHARE_MAX, spot.valueShare * rangeFactor)
        );
  const priorBluff = rangeFactor === 1 ? spot.priorBluff : spot.priorBluff * rangeFactor;
  const laterBetFactor =
    ctx.bettor && Number.isFinite(ctx.bettor.laterBetFactor) && ctx.bettor.laterBetFactor >= 0
      ? ctx.bettor.laterBetFactor
      : 1;
  let counted: OmahaFlopEvCounts | null;
  let klass: OmahaFlopHandClass;
  try {
    counted = omahaFlopEvCounts(
      hole,
      board,
      dead,
      valueShare,
      { always, behind: spot.behind, behindShare: callerShare },
      ctx.salt ?? 0,
      undefined,
      ctx.sixCards === true
    );
    klass = omahaFlopHandClass(hole, board, dead);
  } catch {
    return null;
  }
  if (!counted) return null;
  const hand = counted;
  const q = ctx.measuredRaiseRange === true ? 0 : omahaEvBluffShare(priorBluff, read);
  const inPosition = ctx.inPosition === true;
  let modelRealization = 1;
  let fitMultiplier = 1;
  let realization = 1;
  let robustShare: number | null = null;
  if (!spot.final) {
    const r =
      laterBetFactor === 1
        ? omahaFlopRunoutRealization(hand.rows, hand.turnOf, q, inPosition)
        : omahaFlopRunoutRealization(hand.rows, hand.turnOf, q, inPosition, laterBetFactor);
    if (!r) return null;
    modelRealization = r.realization;
    robustShare = r.robustShare;
    const fitted = omahaFlopFittedRealization(
      r.realization,
      klass,
      inPosition,
      spot.later,
      ctx.fit
    );
    fitMultiplier = fitted.multiplier;
    realization = fitted.realization;
  }
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? ctx.rake! : 0));
  const B = spot.behind;
  const c = B > 0 ? clamp01(omahaFlopEvBehindContinue(spot.potFrac)) : 0;
  let ev = 0;
  let pWin = 0;
  let pTie = 0;
  let together = 0;
  for (let j = 0; j <= B; j++) {
    const weight = B > 0 ? binomial(B, j) * c ** j * (1 - c) ** (B - j) : 1;
    if (!(weight > 0)) continue;
    const jv = hand.jointValue[j];
    const jo = hand.jointOther[j];
    // Realized: the rest of the equity is priced as losing the call (a later fold costs it).
    const win = Math.min(1, realization * (q * jo.win + (1 - q) * jv.win));
    const tie = Math.min(1 - win, realization * (q * jo.tie + (1 - q) * jv.tie));
    const tieShare = Math.min(tie, realization * (q * jo.tieShare + (1 - q) * jv.tieShare));
    const pot = (spot.winnable + j * spot.behindCall) * (1 - rake);
    ev +=
      weight *
      (win * pot + tieShare * (pot + spot.paid) - tie * spot.paid - (1 - win - tie) * spot.paid);
    pWin += weight * win;
    pTie += weight * tie;
    together += weight * (q * (jo.win + jo.tieShare) + (1 - q) * (jv.win + jv.tieShare));
  }
  const alone =
    q * (hand.other.win + hand.other.tie / 2) + (1 - q) * (hand.value.win + hand.value.tie / 2);
  const baseMargin =
    omahaStrategyConstant('facingBetEvMargin', { gameVariant: `plo${hole.length}` }) *
    (spot.winnable + spot.paid);
  const margin = spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
  // omahaFlopDefenceIsPriced: heads-up facing his first flop bet with chips
  // behind, the call is the value of the two-street tree on these same
  // runouts (his turn barrel, the Horse's priced turn and river answers).
  let tree: OmahaFlopDefenceTreeResult | null = null;
  if (
    ctx.tree &&
    !spot.final &&
    !spot.isRaise &&
    spot.callers === 0 &&
    spot.allIns === 0 &&
    spot.behind === 0
  ) {
    tree = omahaFlopDefenceTreeEv(
      hand.rows,
      hand.turnOf,
      { paid: spot.paid, winnable: spot.winnable, left: ctx.tree.left, rake, bluffShare: q },
      ctx.tree.inputs
    );
    if (tree) ev = tree.ev;
  }
  return {
    call: ev > margin,
    ev,
    margin,
    pWin,
    pTie,
    bluffShare: q,
    valueShare: hand.valueShare,
    vsValue: hand.value.win,
    vsOther: hand.other.win,
    potShare: together,
    field: alone > 0 ? together / alone : 1,
    continueShare: c,
    klass,
    modelRealization,
    fitMultiplier,
    realization,
    robustShare,
    price: spot.paid / (spot.winnable + spot.paid),
    runouts: hand.runouts,
    samples: hand.samples,
    seed: hand.seed,
    ...(ctx.tree ? { tree } : {}),
    ...(ctx.bettor ? { bettorRangeFactor: rangeFactor, bettorLaterBetFactor: laterBetFactor } : {}),
  };
}

/**
 * Receipt validation (no options and no opponent memory in the request): a
 * fold or a raise that became a call on the flop is admitted only in the spot
 * the rule covers and only for the exact chips the call puts in (the
 * whole-stack call is an all-in, a wager action).
 */
export function omahaFlopFacingBetEvAdmitsCall(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  const spot = omahaFlopFacingBetEvSpot(hero, gs);
  return (
    spot !== null &&
    !spot.allIn &&
    typeof amount === 'number' &&
    Math.abs(spot.paid - amount) <= 0.005
  );
}
