/**
 * ═══ THE BASELINE RIVER BLUFF RANGE (Dan 2026-11-06) ═══
 *
 * Dan, 2026-11-06 20:52 Chicago: "MAKE SURE THAT YOU FULLY UPGRADE ENHANCE,
 * OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION FOR BOTH
 * HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING THAT IS
 * EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR QUALIFIED
 * CANDITATES OR SITUATIONS."
 *
 * Measured before this layer (production, 12 hours to 2026-11-07 02:00 UTC,
 * heads-up rivers checked to a horse or first to act): Hold'em air bet
 * 12.8% of the time and air was 24% of river bets; PLO4 air was 7.8% of
 * river bets, PLO5 1.5%, PLO6 1.4%. At showdown only 0.8% of PLO4 river bets
 * were a high card or one pair. Players noticed: "rarely any bluffs on here".
 *
 * Why: every river bluff path was conditional on something an ordinary spot
 * does not have. V53 needs a credible river-fold read (no read, no bluff);
 * V54 and the bluff check-raise are default-off candidates; V17's probe is
 * opt-in; V7 continues only a recorded barrel plan and otherwise "gives up"
 * 80% of the time; the V38 EV engine (the whole of Omaha below the value
 * bars) excludes the river; and in Hold'em the V30 solver cell is a CLASS
 * MEAN over every board, so it checks the missed draw of a class whose
 * average holding has showdown value. What was left was a generic ladder
 * that ignored the line and the blockers.
 *
 * This module owns ONE spot and answers it from poker, not from a read:
 * heads-up, river, no bet to face, hero holding no showdown value (air or a
 * missed draw: equity under RIVER_BLUFF_AIR_EQUITY against the read range).
 * Hero bets a size s of the pot and bluffs at the balanced rate for that
 * size: a bet of s risks s to win 1 + s, so the caller is indifferent when
 * s/(1+2s) of the betting range is bluffs - one bluff per two value bets at
 * a pot-sized bet. The per-combo probability is that ratio over hero's
 * value and air shares on this board (v54BluffProbability), then weighted
 * so the right combos carry the bluffs:
 *
 *  - blockers (riverNutBlocker): Hold'em, the top unseen card of a three-flush
 *    board's suit, or a rank of a holding that makes the best straight;
 *    Omaha, the nut-flush blocker class (omahaFlushBlocker) or the best
 *    straight's rank. A missed front-door flush hero does not block
 *    (none of a two-suited board's suit) is the Hold'em unblocker bonus.
 *  - missed draws over pure junk: a flush or straight draw on the turn that
 *    bricked is in every betting range that barrelled, and has no showdown
 *    value at all.
 *  - line coherence: hero barrelled the turn and was called, hero bet the
 *    flop and the turn checked through (a delayed bet), the turn
 *    checked through (both ranges capped), the opponent gave up after
 *    betting (hero in position), or the river card is a scare card hero
 *    blocks or whose range it improves. Leading out of position into the
 *    player who bet the turn, on a river that changed nothing, is not a
 *    story: that spot stays with the layers below.
 *
 * Reads RESHAPE the baseline; they never switch it off. A credible station
 * (foldToBet engaged low, riverCall engaged high, or a measured
 * fold-to-river-bet under 35%) keeps a fifth of the bluffs; a measured river
 * folder gets up to 1.6x; and the V53 over-folder frequency, when a credible
 * read exists, is a floor. No read means the baseline - never zero.
 *
 * Tournaments keep their survival arithmetic, not a switch: the icmRisk
 * premium scales the frequency down (never below a quarter), a locked
 * satellite seat never bluffs (V37, it does not play big pots at all), and a
 * shove bluff under survival pressure is sized down to a non-shove bet.
 *
 * Hi-lo bluffs only for the high when no low is possible; fixed limit, short
 * deck, multi-board and bomb-pot spots keep their own layers.
 */
import type { ActionRecord, Card } from '../types.js';
import { RANK_VALUES } from './PokerEngine.js';

/** Equity against the read range below which a hand has no showdown value. */
export const RIVER_BLUFF_AIR_EQUITY = 0.25;
/** The most often any one combo bluffs, whatever the composition says. */
export const RIVER_BLUFF_MAX_PROBABILITY = 0.45;
/** Value-to-air ratio assumed when the public ranges cannot be sampled. */
export const RIVER_BLUFF_PRIOR_VALUE_SHARE = 0.6;
export const RIVER_BLUFF_PRIOR_AIR_SHARE = 1;
/** The most value per air combo the public ranges are believed to show. The
 *  bands are preflop-strength slices: they cannot see the missed draws a
 *  betting range really carries, so a band read of "nearly all value" is
 *  taken as no more than 0.6 value combos per air combo. The composition can
 *  lower the ratio (a board where hero's range is mostly air), never raise
 *  it past this. */
export const RIVER_BLUFF_MAX_VALUE_PER_AIR = 0.6;

/** Combo selection weights: the average air combo bluffs at about the
 *  balanced rate, blockers and missed draws more, pure junk less. */
export const RIVER_BLUFF_WEIGHTS = {
  junk: 0.5,
  missedDraw: 0.9,
  blocker: 1.15,
  blockerAndDraw: 1.3,
  unblockerBonus: 0.1,
} as const;

/** Line coherence factor: how well hero's line represents a river bet. */
export const RIVER_BLUFF_LINE = {
  barrel: 1.1,
  initiative: 0.95,
  checkedThrough: 0.8,
  opponentGaveUp: 0.85,
  scare: 0.85,
} as const;

/** Read reshaping: a station keeps a fifth of the bluffs, a folder gets more. */
export const RIVER_BLUFF_STATION_FACTOR = 0.2;
export const RIVER_BLUFF_FOLDER_MAX = 1.6;

export type RiverBluffLine = keyof typeof RIVER_BLUFF_LINE | 'none';
export type RiverBluffSelection = 'junk' | 'missedDraw' | 'blocker' | 'blockerAndDraw';

export interface RiverBluffSpot {
  omaha: boolean;
  potLimit: boolean;
  hiLo: boolean;
  /** hi-lo only: three or more distinct low ranks on the board */
  lowPossible: boolean;
  fixedLimit: boolean;
  shortDeck: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  holeCount: number;
  hole: Card[];
  board: Card[];
  history: readonly ActionRecord[];
  heroId: string;
  opponentId: string;
  /** opponents still live in the hand (not folded) */
  opponentsLive: number;
  /** the one opponent can still put chips in (not all in, has a stack) */
  opponentCanRespond: boolean;
  /** hero's equity against the read range */
  equity: number;
  /** hero acts last on the river */
  inPosition: boolean;
  /** the last aggressor of the earlier streets */
  initiative: 'hero' | 'opp' | 'none';
  /** the river card completed a flush, a straight or paired the board */
  scareCard: boolean;
  /** hero holds the nut blocker for this game (riverNutBlocker) */
  nutBlocker: boolean;
  /** the public ranges: hero's range improved on, or got the nuts on, this river */
  riverHelpsHero: boolean;
  /** the public ranges: the runout or the ranges favour the opponent */
  rangesFavorOpponent: boolean;
  /** hero's recorded barrel plan for this hand */
  barrelPlan: boolean;
  /** Omaha: how many earlier-street hero bets this opponent called */
  calledBarrels: number;
}

export interface RiverBluffEligibility {
  eligible: boolean;
  reason: 'eligible' | 'domain' | 'multiway' | 'cannot_respond' | 'showdown_value' | 'no_story';
  line: RiverBluffLine;
  selection: RiverBluffSelection;
  missedDraw: boolean;
  unblocker: boolean;
}

const rank = (c: Card): number => RANK_VALUES[c.rank] ?? 0;

/** Distinct ranks, with the ace also counted low. */
function rankSet(cards: readonly Card[]): Set<number> {
  const s = new Set<number>();
  for (const c of cards) {
    const r = rank(c);
    s.add(r);
    if (r === 14) s.add(1);
  }
  return s;
}

/** Four distinct ranks inside some five-rank window (an open-ender or a gutshot). */
function hasFourInWindow(ranks: Set<number>, mustUse: Set<number>): boolean {
  for (let lo = 1; lo <= 10; lo++) {
    let n = 0;
    let used = false;
    for (let r = lo; r < lo + 5; r++) {
      if (ranks.has(r)) {
        n++;
        if (mustUse.has(r)) used = true;
      }
    }
    if (n >= 4 && used) return true;
  }
  return false;
}

/** Five distinct ranks in a row. */
function hasStraight(ranks: Set<number>): boolean {
  for (let lo = 1; lo <= 10; lo++) {
    let ok = true;
    for (let r = lo; r < lo + 5 && ok; r++) ok = ranks.has(r);
    if (ok) return true;
  }
  return false;
}

/**
 * A flush or straight draw on the turn that the river did not complete.
 * Public cards and hero's own only. Hold'em: any combination of hole and
 * board; Omaha: exactly two hole cards with the board.
 */
export function riverMissedDraw(
  hole: readonly Card[],
  board: readonly Card[],
  omaha: boolean
): boolean {
  if (board.length !== 5 || hole.length < 2) return false;
  const turn = board.slice(0, 4);
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  if (!omaha) {
    for (const s of suits) {
      const h = hole.filter((c) => c.suit === s).length;
      const t = turn.filter((c) => c.suit === s).length;
      const r = board.filter((c) => c.suit === s).length;
      if (h >= 1 && h + t === 4 && h + r < 5) return true;
    }
    const holeRanks = rankSet(hole);
    if (
      hasFourInWindow(rankSet([...hole, ...turn]), holeRanks) &&
      !hasStraight(rankSet([...hole, ...board]))
    )
      return true;
    return false;
  }
  // Omaha: two suited hole cards with two of the suit on the turn, and the
  // river is not the third (a third would have completed it).
  for (const s of suits) {
    const h = hole.filter((c) => c.suit === s).length;
    const t = turn.filter((c) => c.suit === s).length;
    const r = board.filter((c) => c.suit === s).length;
    if (h >= 2 && t === 2 && r === 2) return true;
  }
  // A straight draw: two hole cards with turn cards making four in a window,
  // and no two hole cards with three river-board cards making the straight.
  for (let i = 0; i < hole.length; i++) {
    for (let j = i + 1; j < hole.length; j++) {
      const pair = [hole[i], hole[j]];
      const pr = rankSet(pair);
      if (pr.size < 2 || !hasFourInWindow(rankSet([...pair, ...turn]), pr)) continue;
      // the draw used both hole cards and two turn cards
      let completed = false;
      for (let a = 0; a < 5 && !completed; a++)
        for (let b = a + 1; b < 5 && !completed; b++)
          for (let c = b + 1; c < 5 && !completed; c++)
            completed = hasStraight(rankSet([...pair, board[a], board[b], board[c]]));
      if (!completed) return true;
    }
  }
  return false;
}

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/** The best straight top (5..14) these ranks make, or 0. */
function straightTop(ranks: Set<number>): number {
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let r = hi - 4; r <= hi && ok; r++) ok = ranks.has(r === 1 ? 1 : r);
    if (ok) return hi;
  }
  return 0;
}

/**
 * Does hero hold a card that removes the nut hands from the opponent's range?
 *
 * - A flush is possible (three or more of a suit on the board): Hold'em, hero
 *   holds the highest unseen card of that suit; Omaha, the caller's
 *   omahaFlushBlocker fact (`omahaNutFlush`) decides, because one card does
 *   not block an Omaha flush - the whole top suited pair class must go.
 * - Otherwise a straight is possible: hero holds a rank that appears in a
 *   two-card holding making the BEST straight this board allows (Hold'em may
 *   also use one card with four on board; Omaha uses exactly two).
 * - A board with neither has no blocker (its nuts are sets and boats, and a
 *   card of the paired rank is itself showdown value).
 *
 * Deliberately sharper than HorseMind.hasBlocker, whose straight test (any
 * card within four ranks of three board cards) calls a queen a blocker on
 * 9-8-5-K-2, where the only straight is seven-six.
 */
export function riverNutBlocker(
  hole: readonly Card[],
  board: readonly Card[],
  omaha: boolean,
  omahaNutFlush: boolean
): boolean {
  if (board.length !== 5 || hole.length < 2) return false;
  const suitN = new Map<string, number>();
  for (const c of board) suitN.set(c.suit, (suitN.get(c.suit) ?? 0) + 1);
  for (const [suit, n] of suitN) {
    if (n < 3) continue;
    if (omaha) return omahaNutFlush;
    const onBoard = new Set<string>(board.filter((c) => c.suit === suit).map((c) => c.rank));
    let top: string | null = null;
    for (let i = RANK_ORDER.length - 1; i >= 0; i--) {
      if (!onBoard.has(RANK_ORDER[i])) {
        top = RANK_ORDER[i];
        break;
      }
    }
    return top !== null && hole.some((c) => c.suit === suit && c.rank === top);
  }
  const boardRanks = board.map(rank);
  // Every unseen two-rank holding (rank level; suits do not matter here).
  let best = 0;
  const makers: Array<[number, number]> = [];
  const tops = (a: number, b: number): number => {
    let t = 0;
    if (!omaha) {
      const rs = new Set<number>();
      for (const r of [a, b, ...boardRanks]) {
        rs.add(r);
        if (r === 14) rs.add(1);
      }
      return straightTop(rs);
    }
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++)
        for (let k = j + 1; k < 5; k++) {
          const rs = new Set<number>();
          for (const r of [a, b, boardRanks[i], boardRanks[j], boardRanks[k]]) {
            rs.add(r);
            if (r === 14) rs.add(1);
          }
          if (rs.size >= 5) t = Math.max(t, straightTop(rs));
        }
    return t;
  };
  for (let a = 2; a <= 14; a++) {
    for (let b = a; b <= 14; b++) {
      if (omaha && a === b) continue;
      const t = tops(a, b);
      if (t === 0) continue;
      if (t > best) {
        best = t;
        makers.length = 0;
      }
      if (t === best) makers.push([a, b]);
    }
  }
  if (best === 0) return false;
  // Hold'em with four to a straight on board: every one-card maker counts.
  const heroRanks = new Set(hole.map(rank));
  return makers.some(([a, b]) => heroRanks.has(a) || heroRanks.has(b));
}

/** Hold'em: the board shows exactly two of a suit and hero holds none of it -
 *  the missed front-door flush draws that make up the folding range are all
 *  still in the opponent's range. */
export function riverFlushUnblocker(hole: readonly Card[], board: readonly Card[]): boolean {
  const n = new Map<string, number>();
  for (const c of board) n.set(c.suit, (n.get(c.suit) ?? 0) + 1);
  for (const [s, k] of n) if (k === 2 && !hole.some((c) => c.suit === s)) return true;
  return false;
}

function streetCheckedThrough(history: readonly ActionRecord[], stage: string): boolean {
  let saw = false;
  for (const a of history) {
    if (a.stage !== stage) continue;
    saw = true;
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') return false;
  }
  return saw;
}

const aggressive = (a: ActionRecord): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);

/** Which story hero's line tells on this river, or 'none'. */
export function riverBluffLine(spot: RiverBluffSpot): RiverBluffLine {
  const h = spot.history;
  const heroTurnBet = h.some(
    (a) => a.stage === 'turn' && a.userId === spot.heroId && aggressive(a)
  );
  const oppTurnCall = h.some(
    (a) => a.stage === 'turn' && a.userId === spot.opponentId && a.action === 'call'
  );
  const oppRaisedLate = h.some(
    (a) =>
      (a.stage === 'turn' || a.stage === 'river') &&
      a.userId === spot.opponentId &&
      (a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true))
  );
  // A turn raise by the opponent uncaps their range; the bet is not a story.
  if (oppRaisedLate) return 'none';
  const scareStory = spot.scareCard && (spot.nutBlocker || spot.riverHelpsHero);
  if (spot.initiative === 'hero') {
    if (heroTurnBet && oppTurnCall) return 'barrel';
    // Hero bet the flop and the turn checked through: a delayed river bet.
    const heroFlopBet = h.some(
      (a) => a.stage === 'flop' && a.userId === spot.heroId && aggressive(a)
    );
    if (heroFlopBet) return 'initiative';
  }
  // Hero checked behind (or nobody bet) the turn: both ranges are capped.
  if (streetCheckedThrough(h, 'turn')) return 'checkedThrough';
  // The opponent bet the turn, hero called, and the opponent checked the
  // river to hero: they gave up. In position that is the classic stab.
  if (spot.initiative === 'opp' && spot.inPosition) {
    const oppCheckedRiver = h.some(
      (a) => a.stage === 'river' && a.userId === spot.opponentId && a.action === 'check'
    );
    if (oppCheckedRiver) return 'opponentGaveUp';
  }
  if (scareStory) return 'scare';
  return 'none';
}

/** Is this a qualified river-bluff candidate, and which kind. */
export function riverBluffEligibility(spot: RiverBluffSpot): RiverBluffEligibility {
  const missedDraw = riverMissedDraw(spot.hole, spot.board, spot.omaha);
  const unblocker = !spot.omaha && riverFlushUnblocker(spot.hole, spot.board);
  const selection: RiverBluffSelection =
    spot.nutBlocker && missedDraw
      ? 'blockerAndDraw'
      : spot.nutBlocker
        ? 'blocker'
        : missedDraw
          ? 'missedDraw'
          : 'junk';
  const out = (reason: RiverBluffEligibility['reason'], line: RiverBluffLine = 'none') => ({
    eligible: reason === 'eligible',
    reason,
    line,
    selection,
    missedDraw,
    unblocker,
  });
  const holeOk = spot.omaha ? [4, 5, 6].includes(spot.holeCount) : spot.holeCount === 2;
  if (
    spot.board.length !== 5 ||
    !holeOk ||
    spot.hole.length !== spot.holeCount ||
    spot.fixedLimit ||
    spot.shortDeck ||
    spot.multiBoard ||
    spot.bombPot ||
    (spot.hiLo && spot.lowPossible)
  )
    return out('domain');
  if (spot.opponentsLive !== 1) return out('multiway');
  if (!spot.opponentCanRespond) return out('cannot_respond');
  if (!(spot.equity < RIVER_BLUFF_AIR_EQUITY)) return out('showdown_value');
  const line = riverBluffLine(spot);
  if (line === 'none') return out('no_story', line);
  return out('eligible', line);
}

export interface RiverBluffReads {
  /** credible station (isStation) or a measured fold-to-river-bet under 35% */
  station: boolean;
  /** HorseMind.riverFoldRate, or null without a sample */
  riverFoldRate: number | null;
  /** the V53 frequency against a credible over-folder (0 without a read) */
  overFolderFrequency: number;
  /** HorseMind.exploit(...).bluffMod (1 = neutral) */
  bluffMod: number;
  /** the shown light-river-caller read: 0.70-0.85 when credible, else 1 */
  lightCallerFactor?: number;
}

/** The reshaping a read applies to the baseline. 1 without a read. */
export function riverBluffReadFactor(reads: RiverBluffReads): number {
  if (reads.station) return RIVER_BLUFF_STATION_FACTOR;
  let f = 1;
  if (reads.riverFoldRate !== null && Number.isFinite(reads.riverFoldRate)) {
    f *= 1 + Math.max(-0.6, Math.min(0.6, (reads.riverFoldRate - 0.45) * 1.5));
  }
  if (Number.isFinite(reads.bluffMod) && reads.bluffMod > 0) {
    f *= Math.max(0.5, Math.min(1.35, reads.bluffMod));
  }
  if (reads.lightCallerFactor !== undefined && Number.isFinite(reads.lightCallerFactor)) {
    f *= Math.max(0.5, Math.min(1, reads.lightCallerFactor));
  }
  return Math.max(RIVER_BLUFF_STATION_FACTOR, Math.min(RIVER_BLUFF_FOLDER_MAX, f));
}

/** Per-combo balanced bluff probability at size s for this value/air mix. */
export function riverBluffBalancedProbability(
  s: number,
  valueShare: number,
  airShare: number
): number {
  if (!(s > 0) || !(valueShare > 0)) return 0;
  return (
    (s / (1 + s)) * Math.min(RIVER_BLUFF_MAX_VALUE_PER_AIR, valueShare / Math.max(0.02, airShare))
  );
}

export interface RiverBluffFrequencyInput {
  eligibility: RiverBluffEligibility;
  sizeFrac: number;
  valueShare: number;
  airShare: number;
  reads: RiverBluffReads;
  /** tournament survival premium (icmRisk); 0 in cash */
  icmRisk: number;
  /** Omaha: the opponent called two pot-limit barrels and the river did not
   *  move the ranges to hero */
  omahaThirdBarrel: boolean;
}

/** The probability this combo bluffs. Zero only outside the owned spot. */
export function riverBluffProbability(input: RiverBluffFrequencyInput): number {
  const e = input.eligibility;
  if (!e.eligible || e.line === 'none') return 0;
  const balanced = riverBluffBalancedProbability(input.sizeFrac, input.valueShare, input.airShare);
  const weight =
    RIVER_BLUFF_WEIGHTS[e.selection] + (e.unblocker ? RIVER_BLUFF_WEIGHTS.unblockerBonus : 0);
  let p = balanced * weight * RIVER_BLUFF_LINE[e.line] * riverBluffReadFactor(input.reads);
  // The range that called two pot-sized barrels is condensed, not closed.
  if (input.omahaThirdBarrel) p *= 0.5;
  if (input.icmRisk > 0) p *= Math.max(0.25, 1 - 3 * input.icmRisk);
  p = Math.min(RIVER_BLUFF_MAX_PROBABILITY, p);
  // A credible over-folder read is a floor, never a ceiling.
  if (!input.reads.station && input.reads.overFolderFrequency > p) {
    p = Math.min(0.9, input.reads.overFolderFrequency);
  }
  return Math.max(0, p);
}

/**
 * The bluff size as a fraction of the pot. Pot limit: 0.6-1.0 pot (the max).
 * No limit: 0.65-1.0 pot; a polar 1.0-1.5x overbet when hero holds the nut
 * blocker and the river helped hero's range; the shove when the effective
 * stack is at most 1.5 pots and the shove is not a survival risk. `u` is one
 * uniform draw in [0, 1).
 */
export function riverBluffSize(input: {
  potLimit: boolean;
  pot: number;
  effectiveStack: number;
  nutBlocker: boolean;
  riverHelpsHero: boolean;
  icmRisk: number;
  u: number;
}): { sizeFrac: number; shove: boolean } {
  const { pot, effectiveStack: eff } = input;
  if (!(pot > 0) || !(eff > 0)) return { sizeFrac: 0, shove: false };
  const cap = eff / pot;
  if (input.potLimit) {
    const s = Math.min(1, 0.6 + input.u * 0.4);
    return s >= cap ? { sizeFrac: cap, shove: true } : { sizeFrac: s, shove: false };
  }
  if (cap <= 1.5 && input.icmRisk < 0.03) return { sizeFrac: cap, shove: true };
  const polar = input.nutBlocker && input.riverHelpsHero;
  const s = polar ? 1 + input.u * 0.5 : 0.65 + input.u * 0.35;
  return s >= cap ? { sizeFrac: cap, shove: true } : { sizeFrac: s, shove: false };
}
