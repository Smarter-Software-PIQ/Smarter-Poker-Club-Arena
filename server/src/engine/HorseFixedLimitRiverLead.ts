/**
 * FIXED LIMIT: A STRONG RIVER HAND LEADS (Fixed-Limit lane W8, 2026-11-15).
 *
 * Why: on an unbet fixed-limit river a Horse that is FIRST TO ACT with a full
 * house or better checks 31 to 58 percent of the time, and after the check it
 * seldom raises (0 to 21 percent); heads-up in flo8 the river then checks
 * through 42 to 50 percent of the time, so the hand that should collect at
 * least one big bet collects none (lane census, Horse-only flh/flo8 cash,
 * 2026-11-13T08:13Z to 2026-11-14T21:27Z; agent evidence
 * extreme-archive/fixed-limit-01Gw7aDr/AD-STRONG-RIVER-CHECKS.md). Checking
 * back last to act with the same hands is rare (0 to 6 percent heads-up), so
 * the leak is the first-to-act check.
 *
 * The rule (option `fixedLimitRiverStrongHandLeads`, OPT-IN, read as
 * `=== true`, default off; HorseLogic owns the gate): fixed-limit betting
 * structure, river, nothing to call, the Horse is the first voluntary actor of
 * the river, at least one opponent can still act, the reference would CHECK,
 * and the hand is strong by the cut below -> bet one big bet instead.
 *
 * STRENGTH CUT (engine scorers only; no opponent card is read):
 *  - the hand is a full house or better (category >= 7 of the engine's
 *    2^20 encoding: 7 full house, 8 quads, 9 straight flush);
 *  - the chance that a random holding of one opponent beats it is computed
 *    card-exactly: every two unseen cards (the deck minus the Horse's own
 *    cards and the board) is scored with the engine's own evaluator against
 *    the board (Omaha: exactly those two cards and three board cards,
 *    scoreOmahaHiPartial; hold'em: scoreHoldem of the seven), and the share
 *    `s` of two-card holdings that score strictly higher is counted. An
 *    opponent holding `h` cards has h(h-1)/2 two-card subsets, so his chance
 *    of a beating holding is 1 - (1 - s)^(h(h-1)/2); across `n` opponents who
 *    can still act it is 1 - (1 - that)^n;
 *  - the hand is strong when that chance is at most
 *    FIXED_LIMIT_RIVER_LEAD_MAX_BEATEN (0.12);
 *  - Omaha also refuses a BOTTOM-HALF BOAT, by the engine's own boat position
 *    (HorseEval.omahaBoatPosition, the V15 BOATS walk of two-rank holdings):
 *    a full house is refused when the holdings that make a bigger boat or
 *    quads outnumber the holdings that make a smaller boat. A random-holding
 *    chance alone does not see this: on 2-T-3-6-6 the Horse's 22266 is
 *    beaten by any six with a ten, three or deuce, by TT, 33 and 66
 *    (s = 17/903, chance 0.108 heads-up, under the bar), yet every other boat
 *    on that board beats it (5 bigger boats and quads, 0 smaller) -> refused.
 *    QQQ66 on 6-7-T-Q-Q is beaten only by the last queen with a seven or a
 *    ten (s = 6/903, chance 0.039; 2 bigger boats, 3 smaller) -> strong;
 *  - hold'em also excludes a hand that only plays the board (it can at best
 *    tie) and the engine's under-full boat (`nlhNutStatus.underfull`: a board
 *    pair above the Horse's trips, so any one card of that rank beats it),
 *    because a random-holding chance understates how often a player who
 *    called to the river holds that one card.
 *
 * HI-LO (flo8): when a low is possible on the board and the Horse holds no
 * low, the bet can at most win half; it leads only when two or more
 * opponents can still act (the others pay into the half it wins). Heads-up in
 * that case the reference stands. When no low is possible, or the Horse also
 * holds a low, it leads heads-up and multiway.
 *
 * EXCEPTION: the first opponent to act after the Horse carries an engaged
 * aggressive read (betCheckedTo engaged high, `isAggressor`, or the postflop
 * maniac class `isPostflopManiac` the fixed-limit F1 repair made reachable):
 * the reference check stands, because he bets into it.
 *
 * Not touched: no-limit and pot-limit, any decision facing a wager, a Horse
 * checked to, bomb pots and multi-board hands, a bet that would put the Horse
 * all in, and a tournament stack under 20 big blinds (the tournament utility
 * path stays the owner there). Pure: no random draw, no read machinery.
 */
import type { Card } from '../types.js';
import { nlhNutStatus, omahaBoatPosition, scoreHoldem, scoreOmahaHiPartial } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';

/** Full house in the engine's score encoding (score >> 20). */
export const FIXED_LIMIT_RIVER_LEAD_MIN_CATEGORY = 7;
/** Most chance that an opponent who can act holds a better hand. */
export const FIXED_LIMIT_RIVER_LEAD_MAX_BEATEN = 0.12;
/** A tournament stack below this many big blinds keeps the reference. */
export const FIXED_LIMIT_RIVER_LEAD_MIN_TOURNAMENT_BB = 20;

const CATEGORY = 0x100000;
const sameCard = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

export interface FixedLimitRiverLeadStrength {
  /** engine category of the Horse's best high hand (7 full house, 8 quads, 9 straight flush) */
  category: number;
  /** share of two-card holdings (of the unseen cards) that beat the Horse */
  beatenShare: number;
  /** chance one opponent's random holding beats the Horse */
  beatenOne: number;
  /** chance at least one of the opponents who can act holds a better hand */
  beatenAny: number;
  /** hold'em: the Horse's best five is the board's own (tie at best) */
  boardPlays: boolean;
  /** hold'em: engine under-full boat (nlhNutStatus.underfull) */
  underfull: boolean;
  /** Omaha full house: two-rank holdings making a bigger boat or quads */
  boatsAbove: number;
  /** Omaha full house: two-rank holdings making a smaller boat */
  boatsBelow: number;
  /** Omaha full house: more holdings beat the boat than it beats */
  bottomHalfBoat: boolean;
  strong: boolean;
}

/** Score a high hand with the engine's evaluators (Omaha: exactly two hole cards). */
function scoreHigh(hole: readonly Card[], board: readonly Card[], omaha: boolean): number {
  return omaha
    ? scoreOmahaHiPartial([...hole], [...board])
    : scoreHoldem([...hole, ...board], hole.length + board.length, false);
}

/**
 * The strength cut above. `opponentHoleCards` is how many cards each opponent
 * holds (the Horse's own count in every fixed-limit game here).
 */
export function fixedLimitRiverLeadStrength(
  hole: readonly Card[],
  board: readonly Card[],
  omaha: boolean,
  opponentsWhoCanAct: number,
  opponentHoleCards: number = hole.length,
  dead: readonly Card[] = []
): FixedLimitRiverLeadStrength {
  const none: FixedLimitRiverLeadStrength = {
    category: 0,
    beatenShare: 1,
    beatenOne: 1,
    beatenAny: 1,
    boardPlays: false,
    underfull: false,
    boatsAbove: 0,
    boatsBelow: 0,
    bottomHalfBoat: false,
    strong: false,
  };
  if (hole.length < 2 || board.length !== 5 || opponentsWhoCanAct < 1) return none;
  const hero = scoreHigh(hole, board, omaha);
  const category = Math.floor(hero / CATEGORY);
  if (category < FIXED_LIMIT_RIVER_LEAD_MIN_CATEGORY) return { ...none, category };
  const seen = [...hole, ...board, ...dead];
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const c = { rank, suit } as Card;
      if (!seen.some((s) => sameCard(s, c))) unseen.push(c);
    }
  let beaten = 0;
  let total = 0;
  const pair: Card[] = new Array(2);
  for (let i = 0; i < unseen.length; i++)
    for (let j = i + 1; j < unseen.length; j++) {
      pair[0] = unseen[i];
      pair[1] = unseen[j];
      total++;
      if (scoreHigh(pair, board, omaha) > hero) beaten++;
    }
  const beatenShare = total > 0 ? beaten / total : 1;
  const subsets = Math.max(1, (opponentHoleCards * (opponentHoleCards - 1)) / 2);
  const beatenOne = 1 - Math.pow(1 - beatenShare, omaha ? subsets : 1);
  const beatenAny = 1 - Math.pow(1 - beatenOne, opponentsWhoCanAct);
  let boardPlays = false;
  let underfull = false;
  let boatsAbove = 0;
  let boatsBelow = 0;
  let bottomHalfBoat = false;
  if (!omaha) {
    boardPlays = scoreHoldem([...board], board.length, false) >= hero;
    underfull = category === 7 && nlhNutStatus([...hole], [...board], false).underfull;
  } else if (category === 7) {
    const position = omahaBoatPosition([...hole], [...board]);
    if (position) {
      boatsAbove = position.boats + position.quads;
      boatsBelow = position.lowerBoats;
      bottomHalfBoat = boatsAbove > boatsBelow;
    }
  }
  const strong =
    beatenAny <= FIXED_LIMIT_RIVER_LEAD_MAX_BEATEN && !boardPlays && !underfull && !bottomHalfBoat;
  return {
    category,
    beatenShare,
    beatenOne,
    beatenAny,
    boardPlays,
    underfull,
    boatsAbove,
    boatsBelow,
    bottomHalfBoat,
    strong,
  };
}

export interface FixedLimitRiverLeadSpot {
  isFixedLimit: boolean;
  isRiver: boolean;
  toCall: number;
  /** no opponent has acted on this river yet (the Horse is first to act) */
  firstToActOnRiver: boolean;
  /** the reference decision's action */
  referenceAction: string;
  betLegal: boolean;
  bombPotOrMultiBoard: boolean;
  /** opponents not folded, not all in, with chips */
  opponentsWhoCanAct: number;
  /** the bet would not put the Horse all in */
  betLeavesChips: boolean;
  tournament: boolean;
  stackBigBlinds: number;
  isHiLo: boolean;
  lowPossible: boolean;
  horseHoldsLow: boolean;
  strong: boolean;
  /** the first opponent to act after the Horse has an engaged aggressive read */
  nextOpponentAggressive: boolean;
}

export type FixedLimitRiverLeadVerdict =
  | 'lead'
  | 'out_of_scope'
  | 'not_strong'
  | 'low_half_heads_up'
  | 'aggressive_next'
  | 'short_tournament_stack';

/** The gate, in order; only 'lead' changes the reference. */
export function fixedLimitRiverStrongHandLeads(
  spot: FixedLimitRiverLeadSpot
): FixedLimitRiverLeadVerdict {
  if (
    !spot.isFixedLimit ||
    !spot.isRiver ||
    spot.toCall > 0 ||
    !spot.firstToActOnRiver ||
    spot.referenceAction !== 'check' ||
    !spot.betLegal ||
    spot.bombPotOrMultiBoard ||
    spot.opponentsWhoCanAct < 1 ||
    !spot.betLeavesChips
  )
    return 'out_of_scope';
  if (spot.tournament && spot.stackBigBlinds < FIXED_LIMIT_RIVER_LEAD_MIN_TOURNAMENT_BB)
    return 'short_tournament_stack';
  if (!spot.strong) return 'not_strong';
  if (spot.isHiLo && spot.lowPossible && !spot.horseHoldsLow && spot.opponentsWhoCanAct < 2)
    return 'low_half_heads_up';
  if (spot.nextOpponentAggressive) return 'aggressive_next';
  return 'lead';
}
