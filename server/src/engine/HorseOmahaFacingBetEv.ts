/**
 * OMAHA FACING A BET: ONE EXPECTED-VALUE DECISION (2026-11-15, PLO Strategy
 * lane; option omahaFacingBetEv, default OFF, read `=== true`).
 *
 * Owner, 2026-11-15 11:39 Chicago: the fold-or-call decision facing a turn or
 * river bet "needs to be hand and player dependant and pot size to value
 * dependant", based on the real decision, not "always fold to a big bet".
 *
 * Today that decision is an equity estimate with caps on it and a stack of
 * rules that veto its answer (archive plo-handoff-review-01a1cbbd/
 * facingbet-rewrite-20261115/DESIGN.md lists every one with its line): the
 * range read marks any wager of 20 big blinds a big bet whatever share of the
 * pot it is, the aggressor tier then samples the bettor as 81 to 88 percent
 * trips or better, the committed-call bar stacks margins on that number, and
 * the paired-board fold and the big-bet cells fold whatever the price. None
 * counts the holdings that beat the Horse's actual hand.
 *
 * This module is the replacement, for PLO4 / PLO5 cash, one board, high only,
 * on the turn and the river, when the Horse faces a bet or a raise:
 *
 *  HAND    Every two-card pair of the unseen cards (the Horse's own cards,
 *          the board and known dead cards removed) is scored on the board
 *          with the engine's evaluator; an opponent holding is worth its best
 *          pair. The number of holdings that contain no pair from a given set
 *          is counted exactly (countHoldingsWithout), so "holdings that beat
 *          / tie / lose to this hand", inside any strength region, are exact
 *          counts. Nothing is sampled and no random number is drawn. On the
 *          turn the same counts are taken for every river card.
 *  PLAYER  The bettor's range is a VALUE region (the strongest share V of
 *          all holdings on this board) and a BLUFF share q of other holdings.
 *          V comes from the bet's share of the pot and his line this hand
 *          (never absolute chips); q from the share of the pot, moved by his
 *          measured tendencies and, when the memory carries it, by how often
 *          his bets of this size were shown down as the best hand.
 *          The bluff-share prior is the measured population figure, not the
 *          balanced one (OMAHA_EV_PRIOR_BLUFF).
 *  PRICE   EV(call) = P(win) x what the call can win + P(tie) x the split
 *          - P(lose) x the call, on the actual pot and call. The call is made
 *          when the EV exceeds ONE margin (2 percent of the final pot). A
 *          river call, a whole-stack call and a call that leaves a trivial
 *          amount behind are final; a turn call with chips behind takes the
 *          engine's realization factor, the only other term.
 *  FIELD   Every other player in the hand must be beaten too: one who already
 *          called this bet (a strong range), one all in from an earlier
 *          street, and one still to act behind the Horse.
 *
 * Pure: no state, no random draws, no telemetry, no opponent memory. The
 * caller (HorseLogic) supplies the measured read.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import { omahaCashOnlyExcludes } from './HorseOmahaTournamentScope.js';

export const OMAHA_FACING_BET_EV_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/** The one safety margin: EV(call) must exceed this share of the final pot (pot + call). */
export const OMAHA_FACING_BET_EV_MARGIN = 0.02;
/** A call that leaves at most this share of the final pot behind is the stack decision. */
export const OMAHA_FACING_BET_EV_TRIVIAL_BEHIND = 0.1;

/** Size buckets, as a share of the pot before the bet (lane brief 2026-11-15). */
export type OmahaBetSizeBucket = 'under40' | 'mid' | 'big' | 'over';
export function omahaBetSizeBucket(potFrac: number): OmahaBetSizeBucket {
  return potFrac < 0.4 ? 'under40' : potFrac < 0.7 ? 'mid' : potFrac <= 1.1 ? 'big' : 'over';
}

/**
 * VALUE REGION: the share of all holdings (strongest first) the bettor bets
 * for value at this size. Smaller bets are thinner value; a raise is the
 * narrowest. Turn bets are wider than river bets.
 */
export const OMAHA_EV_VALUE_SHARE: Readonly<
  Record<'turn' | 'river', Readonly<Record<OmahaBetSizeBucket | 'raise', number>>>
> = {
  river: { under40: 0.45, mid: 0.3, big: 0.2, over: 0.12, raise: 0.1 },
  turn: { under40: 0.5, mid: 0.38, big: 0.28, over: 0.18, raise: 0.14 },
};
/** His arriving range is stronger for each earlier postflop street he bet or raised / only called. */
export const OMAHA_EV_LINE_AGGRESSOR = 0.8;
export const OMAHA_EV_LINE_CALLER = 0.9;
/**
 * The value region has a soft edge on the river: the next half-share of
 * holdings below it (thin value) is in the range at half weight, so the
 * verdict does not turn on which side of a hard line one hand class falls.
 */
export const OMAHA_EV_THIN_VALUE_BAND = 0.5;
export const OMAHA_EV_THIN_VALUE_WEIGHT = 0.5;
/**
 * POPULATION PRIOR for the share of a bet that is not value (river: a bluff
 * or a worse hand; turn: a draw, a worse hand or air), by the bet's share of
 * the pot. Measured, not assumed: full sweep 2026-11-15 (archive
 * plo-handoff-review-01a1cbbd/full-sweep-20261115; 4,573 PLO4/PLO5 cash hands
 * with a person seated, Nov 10 to 15), heads-up, a Horse holding a hand that 3
 * to 45 percent of two-card holdings beat, facing a person's bet: the Horse
 * was ahead of the bettor's actual cards on the river 13.4% (n 41) under 40
 * percent of the pot, 14.8% (n 61) at 40 to 70, 19.5% (n 118) at 70 to 110;
 * on the turn 34.4% (n 61), 42.6% (n 54), 18.7% (n 179). The balanced share
 * (bet / (pot + 2 bet): 0.25 at half the pot) is NOT what this population
 * does: it under-bluffs the river at every size. A raise has no measured row
 * here; it keeps a stated low share.
 */
export const OMAHA_EV_PRIOR_BLUFF: Readonly<
  Record<'turn' | 'river', Readonly<Record<OmahaBetSizeBucket | 'raise', number>>>
> = {
  river: { under40: 0.13, mid: 0.15, big: 0.19, over: 0.19, raise: 0.08 },
  turn: { under40: 0.34, mid: 0.4, big: 0.22, over: 0.22, raise: 0.15 },
};
/** River bluffs come from the weakest share of the holdings. */
export const OMAHA_EV_BLUFF_POOL = 0.5;
/** Pseudo-observations behind the prior when the size-bucketed shown-down read moves it. */
export const OMAHA_EV_SIZE_READ_PRIOR = 8;
export const OMAHA_EV_SIZE_READ_MIN_SHOWN = 4;
/** The field: a caller of this bet, an earlier all-in, a player still to act (who continues with this share). */
export const OMAHA_EV_CALLER_SHARE: Readonly<Record<'turn' | 'river', number>> = {
  river: 0.35,
  turn: 0.45,
};
export const OMAHA_EV_ALL_IN_SHARE = 0.5;
/** A caller's learned showdown results move his share: prior "not the best hand" 0.5, bounds on the move. */
export const OMAHA_EV_CALLER_NOT_BEST_PRIOR = 0.5;
export const OMAHA_EV_CALLER_SHARE_BOUNDS: readonly [number, number] = [0.7, 1.5];
/** The share of holdings a caller is modelled on, moved by what his calls of this size were at showdown. */
export function omahaEvCallerShare(
  base: number,
  shown: { shown: number; best: number; second?: number } | null | undefined
): number {
  if (
    !shown ||
    !Number.isFinite(shown.shown) ||
    !Number.isFinite(shown.best) ||
    shown.shown < OMAHA_EV_SIZE_READ_MIN_SHOWN ||
    shown.best < 0 ||
    shown.best > shown.shown
  )
    return base;
  const second = Math.max(0, Math.min(shown.shown - shown.best, Number(shown.second) || 0));
  const notBest =
    (OMAHA_EV_CALLER_NOT_BEST_PRIOR * OMAHA_EV_SIZE_READ_PRIOR +
      (shown.shown - shown.best - 0.5 * second)) /
    (OMAHA_EV_SIZE_READ_PRIOR + shown.shown);
  const k = Math.max(
    OMAHA_EV_CALLER_SHARE_BOUNDS[0],
    Math.min(OMAHA_EV_CALLER_SHARE_BOUNDS[1], notBest / OMAHA_EV_CALLER_NOT_BEST_PRIOR)
  );
  return Math.min(0.95, base * k);
}
export const OMAHA_EV_BEHIND_SHARE = 0.25;

/** The population prior for this bet (OMAHA_EV_PRIOR_BLUFF). */
export function omahaEvPriorBluffShare(
  street: 'turn' | 'river',
  potFrac: number,
  isRaise: boolean
): number {
  return OMAHA_EV_PRIOR_BLUFF[street][isRaise ? 'raise' : omahaBetSizeBucket(potFrac)];
}

/** What the caller knows about the bettor, from public play only. Null fields = not measured. */
export interface OmahaFacingBetEvRead {
  /** HorseMind.omahaReadConditionalOf(...).measured */
  measured: boolean;
  /** his bet-when-checked-to posterior mean over the Horse mean of this game and table size */
  betCheckedToRatio: number | null;
  /** isPostflopManiac on his measured read */
  postflopManiac: boolean;
  /** his river bets of this size that reached showdown, those that were the best hand and, when known, those
   *  that showed a strong hand and did not win (thin value: half a bluff). Null: the memory has no such read
   *  (today always: see HorseMind.omahaFacingBetEvReadOf) */
  sizeShown: { shown: number; best: number; second?: number } | null;
}
export const OMAHA_EV_UNKNOWN_READ: OmahaFacingBetEvRead = Object.freeze({
  measured: false,
  betCheckedToRatio: null,
  postflopManiac: false,
  sizeShown: null,
});

/** The bluff share used: the prior, moved by the measured read. */
export function omahaEvBluffShare(prior: number, read: OmahaFacingBetEvRead | null): number {
  let q = prior;
  if (read?.measured) {
    let k = 1;
    if (read.betCheckedToRatio !== null && Number.isFinite(read.betCheckedToRatio))
      k = Math.max(0.7, Math.min(1.5, read.betCheckedToRatio));
    if (read.postflopManiac) k = Math.max(k, 1.3);
    q *= k;
  }
  const s = read?.sizeShown;
  if (
    s &&
    Number.isFinite(s.shown) &&
    Number.isFinite(s.best) &&
    s.shown >= OMAHA_EV_SIZE_READ_MIN_SHOWN &&
    s.best >= 0 &&
    s.best <= s.shown
  ) {
    const second = Math.max(0, Math.min(s.shown - s.best, Number(s.second) || 0));
    q =
      (q * OMAHA_EV_SIZE_READ_PRIOR + (s.shown - s.best - 0.5 * second)) /
      (OMAHA_EV_SIZE_READ_PRIOR + s.shown);
  }
  return Math.max(0.02, Math.min(0.65, q));
}

// ───────────────────────── exact holdings counter ─────────────────────────

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;

function popcount(v: number): number {
  let x = v >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
  return Math.round(out);
}

/** A set of two-card pairs over m cards (m <= 48), as per-card bit masks in two 32-bit halves. */
export class PairSet {
  readonly lo: Int32Array;
  readonly hi: Int32Array;
  constructor(readonly m: number) {
    this.lo = new Int32Array(m);
    this.hi = new Int32Array(m);
  }
  add(i: number, j: number): void {
    if (j < 32) this.lo[i] |= 1 << j;
    else this.hi[i] |= 1 << (j - 32);
    if (i < 32) this.lo[j] |= 1 << i;
    else this.hi[j] |= 1 << (i - 32);
  }
  union(o: PairSet): PairSet {
    const u = new PairSet(this.m);
    for (let i = 0; i < this.m; i++) {
      u.lo[i] = this.lo[i] | o.lo[i];
      u.hi[i] = this.hi[i] | o.hi[i];
    }
    return u;
  }
}

/**
 * The number of n-card holdings drawn from m cards that contain NO pair of
 * `bar` (and not the card `skip`, when given). Cards are taken in rising
 * order with the cards barred by those already taken carried as a mask; the
 * last card is counted, not walked. Exact.
 */
export function countHoldingsWithout(m: number, n: number, bar: PairSet, skip = -1): number {
  let allLo = m >= 32 ? -1 : (1 << m) - 1;
  let allHi = m > 32 ? (1 << (m - 32)) - 1 : 0;
  if (skip >= 0 && skip < 32) allLo &= ~(1 << skip);
  else if (skip >= 32) allHi &= ~(1 << (skip - 32));
  const lo = bar.lo;
  const hi = bar.hi;
  const count = (start: number, left: number, barLo: number, barHi: number): number => {
    const fromLo = start >= 32 ? 0 : start === 0 ? -1 : ~((1 << start) - 1);
    const fromHi = start <= 32 ? -1 : ~((1 << (start - 32)) - 1);
    const freeLo = ~barLo & allLo & fromLo;
    const freeHi = ~barHi & allHi & fromHi;
    if (left === 1) return popcount(freeLo) + popcount(freeHi);
    let total = 0;
    for (let i = start; i <= m - left; i++) {
      const free = i < 32 ? (freeLo >>> i) & 1 : (freeHi >>> (i - 32)) & 1;
      if (!free) continue;
      total += count(i + 1, left - 1, barLo | lo[i], barHi | hi[i]);
    }
    return total;
  };
  return count(0, n, 0, 0);
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

/** Every unseen pair's score on the board, flat [i * m + j] for i < j. */
function pairScores(unseen: Card[], board: Card[]): Float64Array {
  const m = unseen.length;
  const out = new Float64Array(m * m);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < m; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < m; j++) {
      two[1] = unseen[j];
      out[i * m + j] = scoreOmahaHiPartial(two, board);
    }
  }
  return out;
}

/** Pairs with score above `t` (strict) or at least `t`. */
function pairsAbove(scores: Float64Array, m: number, t: number, orEqual: boolean): PairSet {
  const set = new PairSet(m);
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++) {
      const s = scores[i * m + j];
      if (orEqual ? s >= t : s > t) set.add(i, j);
    }
  return set;
}

/**
 * The score threshold t such that the holdings whose best pair scores ABOVE t
 * are, as nearly as the pair scores allow, the strongest `share` of all
 * holdings. Bisection on the distinct pair scores; each step is one exact
 * count. Returns the threshold and the exact number of holdings above it.
 */
function topShareThreshold(
  scores: Float64Array,
  sorted: Float64Array,
  m: number,
  n: number,
  total: number,
  share: number,
  memo: Map<number, number>
): { t: number; above: number } {
  const aboveOf = (idx: number): number => {
    let v = memo.get(idx);
    if (v === undefined) {
      v = total - countHoldingsWithout(m, n, pairsAbove(scores, m, sorted[idx], false));
      memo.set(idx, v);
    }
    return v;
  };
  const want = share * total;
  // sorted ascending; above(idx) falls as idx rises. Find the lowest idx with above <= want.
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (aboveOf(mid) <= want) hi = mid;
    else lo = mid + 1;
  }
  // The nearer of the two neighbours to the wanted share.
  let pick = lo;
  if (lo > 0 && Math.abs(aboveOf(lo - 1) - want) < Math.abs(aboveOf(lo) - want)) pick = lo - 1;
  return { t: sorted[pick], above: aboveOf(pick) };
}

export interface OmahaEvShares {
  win: number;
  tie: number;
}

export interface OmahaEvHandCounts {
  street: 'turn' | 'river';
  /** unseen cards, hole count, all opponent holdings */
  unseen: number;
  holeCount: number;
  holdings: number;
  /** two-card pairs scored and exact counts taken (the work done) */
  pairsScored: number;
  counts: number;
  /** against every holding (uniform): the Horse wins / ties */
  all: OmahaEvShares;
  /** against the value region and the other (bluff) region */
  value: OmahaEvShares;
  other: OmahaEvShares;
  /** the value region's exact share of all holdings */
  valueShare: number;
  /** against the strongest share of holdings, by share: used for the field */
  top: (share: number) => OmahaEvShares & { share: number };
}

/**
 * The exact counts for one hand: the Horse's win and tie shares against the
 * bettor's value region (the strongest `valueShare` of holdings on the
 * CURRENT board) and against his other holdings. River: other = the weakest
 * OMAHA_EV_BLUFF_POOL of holdings. Turn: other = every non-value holding, and
 * each share is the average over every river card of the showdown result.
 * Null when the cards do not form an Omaha turn or river hand.
 */
export function omahaEvHandCounts(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number
): OmahaEvHandCounts | null {
  if (!Array.isArray(hole) || !Array.isArray(board)) return null;
  if (hole.length !== 4 && hole.length !== 5) return null;
  if (board.length !== 4 && board.length !== 5) return null;
  const unseen = unseenCards(hole, board, Array.isArray(dead) ? dead : []);
  if (!unseen) return null;
  const m = unseen.length;
  const n = hole.length;
  if (m < n + 1 || m > 48) return null;
  const total = choose(m, n);
  const scores = pairScores(unseen, board);
  const distinct = new Set<number>();
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) distinct.add(scores[i * m + j]);
  const sorted = Float64Array.from([...distinct].sort((a, b) => a - b));
  const memo = new Map<number, number>();
  let counts = 0;
  let pairsScored = (m * (m - 1)) / 2;
  const cnt = (bar: PairSet, skip = -1): number => {
    counts++;
    return countHoldingsWithout(m, n, bar, skip);
  };
  const share = Math.max(0.01, Math.min(0.95, valueShare));
  const v = topShareThreshold(scores, sorted, m, n, total, share, memo);

  if (board.length === 5) {
    const hero = scoreOmahaHiPartial(hole, board);
    if (!(hero > 0)) return null;
    const B = pairsAbove(scores, m, hero, false);
    const BT = pairsAbove(scores, m, hero, true);
    const noB = cnt(B);
    const noBT = cnt(BT);
    /** Win / tie shares against the holdings whose best pair is ABOVE t (count `above`). */
    const againstAbove = (t: number, above: number): OmahaEvShares => {
      if (!(above > 0)) return { win: 0, tie: 0 };
      if (hero <= t) return { win: 0, tie: 0 }; // every holding above t beats the hand
      const S = pairsAbove(scores, m, t, false);
      const winIn = noBT - cnt(BT.union(S));
      const notBeatenIn = noB - cnt(B.union(S));
      return { win: winIn / above, tie: (notBeatenIn - winIn) / above };
    };
    /** Win / tie shares against the holdings whose best pair is AT OR BELOW t. */
    const againstBelow = (t: number, above: number): OmahaEvShares => {
      const below = total - above;
      if (!(below > 0)) return { win: 0, tie: 0 };
      const S = pairsAbove(scores, m, t, false);
      const winIn = cnt(BT.union(S));
      const notBeatenIn = cnt(B.union(S));
      return { win: winIn / below, tie: (notBeatenIn - winIn) / below };
    };
    const pool = topShareThreshold(scores, sorted, m, n, total, 1 - OMAHA_EV_BLUFF_POOL, memo);
    const topMemo = new Map<number, OmahaEvShares & { share: number }>();
    return {
      street: 'river',
      unseen: m,
      holeCount: n,
      holdings: total,
      pairsScored,
      get counts() {
        return counts + memo.size;
      },
      all: { win: noBT / total, tie: (noB - noBT) / total },
      value: (() => {
        // top V at full weight, the thin-value band under it at half weight
        const core = againstAbove(v.t, v.above);
        const wide = topShareThreshold(
          scores,
          sorted,
          m,
          n,
          total,
          Math.min(0.97, share * (1 + OMAHA_EV_THIN_VALUE_BAND)),
          memo
        );
        const band = wide.above - v.above;
        if (!(band > 0)) return core;
        const all = againstAbove(wide.t, wide.above);
        const w = OMAHA_EV_THIN_VALUE_WEIGHT;
        const weight = v.above + w * band;
        const part = (c: number, a: number): number =>
          (c * v.above + w * (a * wide.above - c * v.above)) / weight;
        return { win: part(core.win, all.win), tie: part(core.tie, all.tie) };
      })(),
      other: againstBelow(pool.t, pool.above),
      valueShare: v.above / total,
      top: (s: number) => {
        const k = Math.round(s * 1000);
        let r = topMemo.get(k);
        if (!r) {
          const th = topShareThreshold(scores, sorted, m, n, total, s, memo);
          r = { ...againstAbove(th.t, th.above), share: th.above / total };
          topMemo.set(k, r);
        }
        return r;
      },
    } as OmahaEvHandCounts;
  }

  // TURN: every river card. A pair's river score is the better of its turn
  // score and its best five with the river card (the six board triples that
  // use it), so only those are scored.
  const V = pairsAbove(scores, m, v.t, false);
  let allWin = 0;
  let allTie = 0;
  let valWin = 0;
  let valTie = 0;
  let othWin = 0;
  let othTie = 0;
  let allN = 0;
  let valN = 0;
  let othN = 0;
  const perRiver = choose(m - 1, n);
  const two: Card[] = [unseen[0], unseen[0]];
  const tri: Card[][] = [];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) tri.push([board[a], board[b]]);
  const five: Card[] = [board[0], board[1], board[2], board[3], board[0]];
  const three: Card[] = [board[0], board[1], board[0]];
  for (let k = 0; k < m; k++) {
    const rc = unseen[k];
    five[4] = rc;
    const hero = scoreOmahaHiPartial(hole, five);
    const B = new PairSet(m);
    const BT = new PairSet(m);
    for (let i = 0; i < m; i++) {
      if (i === k) continue;
      two[0] = unseen[i];
      for (let j = i + 1; j < m; j++) {
        if (j === k) continue;
        two[1] = unseen[j];
        let s = scores[i * m + j];
        for (const [x, y] of tri) {
          three[0] = x;
          three[1] = y;
          three[2] = rc;
          const s2 = scoreOmahaHiPartial(two, three);
          if (s2 > s) s = s2;
        }
        if (s >= hero) {
          BT.add(i, j);
          if (s > hero) B.add(i, j);
        }
      }
    }
    pairsScored += ((m - 1) * (m - 2)) / 2;
    const noB = cnt(B, k);
    const noBT = cnt(BT, k);
    const noV = cnt(V, k);
    const noBV = cnt(B.union(V), k);
    const noBTV = cnt(BT.union(V), k);
    allN += perRiver;
    allWin += noBT;
    allTie += noB - noBT;
    othN += noV;
    othWin += noBTV;
    othTie += noBV - noBTV;
    valN += perRiver - noV;
    valWin += noBT - noBTV;
    valTie += noB - noBT - (noBV - noBTV);
  }
  // The field on the turn is read on the turn board as it stands (not per river card).
  const heroNow = scoreOmahaHiPartial(hole, board);
  const BTnow = pairsAbove(scores, m, heroNow, true);
  const Bnow = pairsAbove(scores, m, heroNow, false);
  const noBnow = cnt(Bnow);
  const noBTnow = cnt(BTnow);
  const topMemo = new Map<number, OmahaEvShares & { share: number }>();
  return {
    street: 'turn',
    unseen: m,
    holeCount: n,
    holdings: total,
    pairsScored,
    get counts() {
      return counts + memo.size;
    },
    all: { win: allWin / allN, tie: allTie / allN },
    value: valN > 0 ? { win: valWin / valN, tie: valTie / valN } : { win: 0, tie: 0 },
    other: othN > 0 ? { win: othWin / othN, tie: othTie / othN } : { win: 0, tie: 0 },
    valueShare: v.above / total,
    top: (s: number) => {
      const kk = Math.round(s * 1000);
      let r = topMemo.get(kk);
      if (!r) {
        const th = topShareThreshold(scores, sorted, m, n, total, s, memo);
        if (!(th.above > 0) || heroNow <= th.t) r = { win: 0, tie: 0, share: th.above / total };
        else {
          const S = pairsAbove(scores, m, th.t, false);
          const winIn = noBTnow - cnt(BTnow.union(S));
          const nb = noBnow - cnt(Bnow.union(S));
          r = { win: winIn / th.above, tie: (nb - winIn) / th.above, share: th.above / total };
        }
        topMemo.set(kk, r);
      }
      return r;
    },
  } as OmahaEvHandCounts;
}

// ───────────────────────────── the spot ─────────────────────────────

export interface OmahaFacingBetEvSpot {
  street: 'turn' | 'river';
  /** The seat whose bet or raise the Horse faces. */
  bettorSeat: number;
  /** The wager as a share of the pot before it (heads-up: the part of it the Horse can call). */
  potFrac: number;
  bucket: OmahaBetSizeBucket;
  /** The wager is a raise over an earlier wager on the street. */
  isRaise: boolean;
  /** Earlier postflop streets on which the bettor bet or raised / only called a bet. */
  aggressorStreets: number;
  callerStreets: number;
  /** Other players in the hand: called this wager, all in from an earlier street, still to act. */
  callers: number;
  allIns: number;
  behind: number;
  /** The seats of the players who called this wager (for their learned call read). */
  callerSeats: number[];
  /** Chips the call puts in, and the chips it can win. */
  paid: number;
  winnable: number;
  /** The call is for the whole stack. */
  allIn: boolean;
  /** No chips of consequence are left after the call (or it is the river): no later decision. */
  final: boolean;
  /** The value share used for this bet and line. */
  valueShare: number;
  /** The population-prior bluff share for this bet. */
  priorBluff: number;
}

/**
 * The spot the decision covers, with its public numbers, or null outside it.
 * It does not look at the Horse's hand or the legacy decision.
 */
export function omahaFacingBetEvSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaFacingBetEvSpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!OMAHA_FACING_BET_EV_VARIANTS.has(variant)) return null;
    // Cash only, read as HorseLogic.isTournamentMode reads it;
    // omahaStrategyInTournaments (HorseOmahaTournamentScope) opens its public tournament scope.
    if (omahaCashOnlyExcludes(player, gs)) return null;
    const street = gs.stage === 'turn' ? 'turn' : gs.stage === 'river' ? 'river' : null;
    if (
      street === null ||
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
    if (board.length !== (street === 'turn' ? 4 : 5) || hole.length !== Number(variant.at(-1)))
      return null;
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
    const faced = v81StreetWager(gs.actionHistory, street, bets, gs.pot);
    if (!faced || faced.bettorSeat === player.seat) return null;
    const bettor = gs.players.find((p) => p.seat === faced.bettorSeat);
    if (!bettor || bettor.is_folded || bettor.is_sitting_out) return null;
    // Heads-up, a wager the Horse cannot cover is a bet of what the Horse can
    // call: the size the bettor chose is the effective one.
    // (Nobody else can call it or has called it: all in on an earlier street at most.)
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

    /** Per street: did `seat` raise the level (bet or raise), or only call. */
    const lineOn = (
      st: string,
      seat: number
    ): { wagers: number; aggr: boolean; called: boolean } => {
      let level = 0;
      let wagers = 0;
      let aggr = false;
      let called = false;
      const totals = new Map<number, number>();
      for (const a of gs.actionHistory ?? []) {
        if (String(a.stage) !== st) continue;
        const prev = totals.get(a.seat) ?? 0;
        const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
        if (a.action === 'call') {
          totals.set(a.seat, prev + amt);
          if (a.seat === seat && amt > 0) called = true;
        } else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
          const now = Math.max(prev, amt);
          totals.set(a.seat, now);
          if (now > level + 0.005) {
            level = now;
            wagers++;
            if (a.seat === seat) aggr = true;
          } else if (a.seat === seat && now > prev) called = true;
        }
      }
      return { wagers, aggr, called };
    };
    const isRaise = lineOn(street, faced.bettorSeat).wagers >= 2;
    let aggressorStreets = 0;
    let callerStreets = 0;
    for (const st of street === 'river' ? ['flop', 'turn'] : ['flop']) {
      const l = lineOn(st, faced.bettorSeat);
      if (l.aggr) aggressorStreets++;
      else if (l.called) callerStreets++;
    }

    // The field.
    let callers = 0;
    const callerSeats: number[] = [];
    let allIns = 0;
    let behind = 0;
    let uncovered = 0;
    const heroTotal = player.bet + paid;
    for (const p of gs.players) {
      if (p.seat === player.seat || p.is_folded || p.is_sitting_out) continue;
      const bet = Number.isFinite(p.bet) ? Math.max(0, p.bet) : 0;
      // What a short call cannot win from this player's street wager.
      uncovered += Math.max(0, Math.min(bet, gs.currentBet) - heroTotal);
      if (p.seat === faced.bettorSeat) continue;
      if (p.is_all_in && bet <= 0.005) allIns++;
      else if (p.is_all_in || bet + 0.011 >= gs.currentBet) {
        callers++;
        callerSeats.push(p.seat);
      } else behind++;
    }
    const winnable = gs.pot - uncovered;
    if (!(winnable > 0)) return null;
    const leftBehind = player.stack - paid;
    const final =
      street === 'river' ||
      allIn ||
      leftBehind <= OMAHA_FACING_BET_EV_TRIVIAL_BEHIND * (winnable + paid);
    const bucket = omahaBetSizeBucket(potFrac);
    const valueShare =
      OMAHA_EV_VALUE_SHARE[street][isRaise ? 'raise' : bucket] *
      OMAHA_EV_LINE_AGGRESSOR ** aggressorStreets *
      OMAHA_EV_LINE_CALLER ** callerStreets;
    return {
      street,
      bettorSeat: faced.bettorSeat,
      potFrac,
      bucket,
      isRaise,
      aggressorStreets,
      callerStreets,
      callers,
      allIns,
      behind,
      callerSeats,
      paid,
      winnable,
      allIn,
      final,
      valueShare,
      priorBluff: omahaEvPriorBluffShare(street, potFrac, isRaise),
    };
  } catch {
    return null;
  }
}

// ───────────────────────────── the verdict ─────────────────────────────

export interface OmahaFacingBetEvVerdict {
  call: boolean;
  /** EV of the call in chips, and the margin it had to exceed. */
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  /** the bluff share used and the value share counted */
  bluffShare: number;
  valueShare: number;
  /** the Horse's win share against the value region / the other region, before the field */
  vsValue: number;
  vsOther: number;
  /** the product of the field factors (1 heads-up) */
  field: number;
  /** the realization factor applied (1 when final) */
  realization: number;
  /** pot odds of the call, for the record */
  price: number;
  /** work done */
  pairsScored: number;
  counts: number;
}

export interface OmahaFacingBetEvContext {
  /** the marginal rake on the pot, as a fraction (0 when capped or none) */
  rake?: number;
  /**
   * omahaStrategyInTournaments: the tournament survival premium on this call
   * (HorseOmahaTournamentScope.omahaTournamentIcmPremium), in equity. It is
   * added to the one margin: EV(call) must exceed (margin + premium) x the
   * final pot, which is the engine's tournament call bar (equity above the
   * price plus the premium). 0 or absent: the cash arithmetic exactly.
   */
  riskPremium?: number;
  /** the engine's realization factor for a turn call with chips behind */
  realization?: number;
  /** per caller (spot.callerSeats order): what his calls of a wager this size were at showdown, when learned */
  callerShown?: ReadonlyArray<{ shown: number; best: number; second?: number } | null>;
}

/** The decision: call when EV(call) exceeds the one margin. Null when the hand cannot be counted. */
export function omahaFacingBetEvVerdict(
  spot: OmahaFacingBetEvSpot,
  hole: Card[],
  board: Card[],
  dead: Card[],
  read: OmahaFacingBetEvRead | null,
  ctx: OmahaFacingBetEvContext = {}
): OmahaFacingBetEvVerdict | null {
  let hand: OmahaEvHandCounts | null;
  try {
    hand = omahaEvHandCounts(hole, board, dead, spot.valueShare);
  } catch {
    hand = null;
  }
  if (!hand) return null;
  const counted = hand;
  const q = omahaEvBluffShare(spot.priorBluff, read);
  let pWin = q * counted.other.win + (1 - q) * counted.value.win;
  let pTie = q * counted.other.tie + (1 - q) * counted.value.tie;
  // The field: each must be beaten too. A player already in is always there;
  // a player still to act is there only with the share he continues with.
  let field = 1;
  const need = (share: number, alwaysIn: boolean): number => {
    const s = counted.top(share);
    const holds = s.win + s.tie * 0.5;
    return alwaysIn ? holds : 1 - share * (1 - holds);
  };
  for (let c = 0; c < spot.callers; c++)
    field *= need(
      omahaEvCallerShare(OMAHA_EV_CALLER_SHARE[spot.street], ctx.callerShown?.[c]),
      true
    );
  if (spot.allIns > 0) field *= need(OMAHA_EV_ALL_IN_SHARE, true) ** spot.allIns;
  if (spot.behind > 0) field *= need(OMAHA_EV_BEHIND_SHARE, false) ** spot.behind;
  pWin *= field;
  pTie *= field;
  const realization = spot.final
    ? 1
    : Math.max(0.5, Math.min(1, Number.isFinite(ctx.realization) ? ctx.realization! : 0.85));
  pWin *= realization;
  pTie *= realization;
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? ctx.rake! : 0));
  const win = spot.winnable * (1 - rake);
  const pLose = Math.max(0, 1 - pWin - pTie);
  const ev = pWin * win + pTie * ((win - spot.paid) / 2) - pLose * spot.paid;
  const premium =
    Number.isFinite(ctx.riskPremium) && (ctx.riskPremium as number) > 0
      ? Math.min(0.5, ctx.riskPremium as number)
      : 0;
  const margin = (OMAHA_FACING_BET_EV_MARGIN + premium) * (spot.winnable + spot.paid);
  return {
    call: ev > margin,
    ev,
    margin,
    pWin,
    pTie,
    bluffShare: q,
    valueShare: counted.valueShare,
    vsValue: counted.value.win,
    vsOther: counted.other.win,
    field,
    realization,
    price: spot.paid / (spot.winnable + spot.paid),
    pairsScored: counted.pairsScored,
    counts: counted.counts,
  };
}
