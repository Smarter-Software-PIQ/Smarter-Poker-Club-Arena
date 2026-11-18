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
 *          seed taken from the cards: every unseen card is the turn card
 *          once, with OMAHA_FLOP_EV_RIVERS river cards each, and on each
 *          runout the hand meets OMAHA_FLOP_EV_VALUE_PER_RUNOUT holdings of
 *          the bettor's value region and OMAHA_FLOP_EV_OTHER_PER_RUNOUT of
 *          his other holdings. The same cards always give the same numbers;
 *          the brain's random stream is not touched.
 *  PLAYER  The bettor's range is a VALUE region (the strongest share V of
 *          holdings on the flop as it stands) and a share q of every other
 *          holding (draws, weaker made hands, air). V comes from the bet's
 *          share of the pot, whether it is a raise and whether he bets into
 *          the preflop aggressor (never absolute chips); q from the same,
 *          moved by his measured tendencies (omahaEvBluffShare, the turn and
 *          river function). The size sets the RANGE; it never decides.
 *  PRICE   EV(call) on the actual pot and call, against the one margin of
 *          the turn and river rule.
 *  LATER   A flop call with chips behind does not get its showdown equity:
 *          there are two streets of betting first. The realization factor is
 *          read from the hand's OWN runouts (omahaFlopRunoutRealization):
 *          equity that sits on runouts where the hand can call again is
 *          realized, equity that sits on runouts where it is a bluff-catcher
 *          is realized only when the street is checked. No flat factor and
 *          no term in the size of the bet.
 *  FIELD   Every other player in the hand must be beaten too, as on the
 *          later streets.
 *
 * The constants are STATED, not measured (the flop value shares and non-value
 * shares extend the turn rows; the realization shares are those of the turn
 * runout work): the option stays OFF until its declared league evaluation
 * passes (docs/horse-option-authority.d/omahaFlopFacingBetEv.md).
 *
 * Pure: no telemetry, no opponent memory, no draw from the brain's random
 * stream; the only state is a memo of the last few sampled hands (the same
 * cards give the same sample). The rule that applies the verdict is
 * HorseOmahaFlopFacingBetEvRule.ts.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import {
  OMAHA_EV_ALL_IN_SHARE,
  OMAHA_EV_BEHIND_SHARE,
  OMAHA_FACING_BET_EV_TRIVIAL_BEHIND,
  omahaBetSizeBucket,
  omahaEvBluffShare,
  type OmahaBetSizeBucket,
  type OmahaFacingBetEvRead,
} from './HorseOmahaFacingBetEv.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';

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
 * A bet into the preflop aggressor by a player who only called before the
 * flop (a lead) is a narrower range than a continuation bet: the value share
 * and the non-value share both take this factor (the later streets' own
 * aggressor-line factor, OMAHA_EV_LINE_AGGRESSOR). The same audit: the player
 * bet 45 percent of flops as the preflop raiser and 22 percent when not.
 */
export const OMAHA_FLOP_EV_LEAD = 0.8;
/** The field on the flop: a caller of this bet continues with this share of holdings (turn 0.45, river 0.35). */
export const OMAHA_FLOP_EV_CALLER_SHARE = 0.55;

/** The sample: holdings drawn to place the value region, river cards per turn card, holdings per runout. */
export const OMAHA_FLOP_EV_POOL = 320;
export const OMAHA_FLOP_EV_RIVERS = 3;
export const OMAHA_FLOP_EV_VALUE_PER_RUNOUT = 5;
export const OMAHA_FLOP_EV_OTHER_PER_RUNOUT = 3;

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
/** Bounds of the factor, and its cap with a player still to act behind (the later streets' own 0.85). */
export const OMAHA_FLOP_RUNOUT_REALIZATION_MIN = 0.3;
export const OMAHA_FLOP_RUNOUT_REALIZATION_MAX = 1;
export const OMAHA_FLOP_EV_BEHIND_REALIZATION_CAP = 0.85;

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

// ───────────────────────────── the sample ─────────────────────────────

export interface OmahaFlopEvShares {
  win: number;
  tie: number;
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
  /** against the value region and against every other holding, over the runouts */
  value: OmahaFlopEvShares;
  other: OmahaFlopEvShares;
  /** the value region's share of the drawn holdings */
  valueShare: number;
  /** against the strongest share of holdings on the flop, by share: the field */
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
  counts: Map<number, OmahaFlopEvCounts>;
}
const FLOP_SAMPLES: FlopSample[] = [];
const FLOP_SAMPLES_MAX = 4;

/** Test seam: forget the remembered hands. */
export function omahaFlopEvCountsResetCache(): void {
  FLOP_SAMPLES.length = 0;
}

/**
 * The sampled counts for one flop hand: the Horse's win and tie shares at
 * showdown against the bettor's value region (the strongest `valueShare` of
 * holdings on the flop) and against his other holdings, over two-card
 * runouts. Null when the cards do not form a four or five card Omaha flop
 * hand. Deterministic: the seed is the cards (omahaFlopEvSeed). The pool and
 * the runouts are drawn from one stream and the holdings met on each runout
 * from a second, so the same hand walks the same runouts whatever the value
 * share asked.
 */
export function omahaFlopEvCounts(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number
): OmahaFlopEvCounts | null {
  if (!Array.isArray(hole) || !Array.isArray(board)) return null;
  if ((hole.length !== 4 && hole.length !== 5) || board.length !== 3) return null;
  const deadCards = Array.isArray(dead) ? dead : [];
  const unseen = unseenCards(hole, board, deadCards);
  if (!unseen) return null;
  const m = unseen.length;
  const n = hole.length;
  if (m < n + 10 || m > 48) return null;
  if (!(scoreOmahaHiPartial(hole, board) > 0)) return null;
  const share = Math.max(0.02, Math.min(0.95, Number.isFinite(valueShare) ? valueShare : 0.5));
  const id = `${hole.map(key).sort().join(',')}|${board.map(key).sort().join(',')}|${deadCards
    .map(key)
    .sort()
    .join(',')}`;
  const shareKey = Math.round(share * 10000);
  let entry = FLOP_SAMPLES.find((s) => s.id === id);
  if (entry) {
    const hit = entry.counts.get(shareKey);
    if (hit) return hit;
    if (entry.counts.size > 12) entry.counts.clear();
  } else {
    entry = { id, counts: new Map() };
    FLOP_SAMPLES.unshift(entry);
    if (FLOP_SAMPLES.length > FLOP_SAMPLES_MAX) FLOP_SAMPLES.length = FLOP_SAMPLES_MAX;
  }
  const seed = omahaFlopEvSeed(hole, board, deadCards);
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
  const deck = new Int8Array(m);
  for (let i = 0; i < m; i++) deck[i] = i;
  for (let p = 0; p < P; p++) {
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

  // The runouts: every unseen card the turn card once, RIVERS river cards each.
  const R = OMAHA_FLOP_EV_RIVERS;
  const riverOf = new Int16Array(m * R).fill(-1);
  for (let t = 0; t < m; t++)
    for (let k = 0; k < R; k++) {
      let r = Math.floor(rnd() * m);
      const taken = (x: number): boolean => {
        if (x === t) return true;
        for (let e = 0; e < k; e++) if (riverOf[t * R + e] === x) return true;
        return false;
      };
      for (let tries = 0; taken(r) && tries < 64; tries++) r = Math.floor(rnd() * m);
      if (!taken(r)) riverOf[t * R + k] = r;
    }
  const rows = new Float64Array(m * R * OMAHA_FLOP_RUNOUT_ROW);
  const turnOf = new Int16Array(m * R);
  const five: Card[] = [board[0], board[1], board[2], board[0], board[0]];
  const opp: Card[] = new Array<Card>(n);
  // per showdown: the holding's percentile and the Horse's result (1 win, 0.5 tie, 0 loss)
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
  const meet = (p: number, t: number, r: number, hero: number): number => {
    for (let k = 0; k < n; k++) {
      const c = cards[p * n + k];
      if (c === t || c === r) return -1;
      opp[k] = unseen[c];
    }
    const s = scoreOmahaHiPartial(opp, five);
    return hero > s ? 1 : hero === s ? 0.5 : 0;
  };
  let at = 0;
  for (let t = 0; t < m; t++) {
    five[3] = unseen[t];
    for (let k = 0; k < R; k++) {
      const r = riverOf[t * R + k];
      if (r < 0) continue;
      five[4] = unseen[r];
      const hero = scoreOmahaHiPartial(hole, five);
      let vw = 0;
      let vn = 0;
      let ow = 0;
      let on = 0;
      for (let v = 0; v < OMAHA_FLOP_EV_VALUE_PER_RUNOUT; v++) {
        let res = -1;
        let p = -1;
        for (let tries = 0; res < 0 && tries < 8; tries++) {
          p = order[Math.floor(pick() * vc)];
          res = meet(p, t, r, hero);
        }
        if (res < 0) continue;
        vn++;
        vw += res;
        valN++;
        if (res === 1) valWin++;
        else if (res === 0.5) valTie++;
        valPct.push(pct[p]);
        valRes.push(res);
      }
      for (let o = 0; o < OMAHA_FLOP_EV_OTHER_PER_RUNOUT; o++) {
        let res = -1;
        let p = -1;
        for (let tries = 0; res < 0 && tries < 8; tries++) {
          p = order[vc + Math.floor(pick() * (P - vc))];
          res = meet(p, t, r, hero);
        }
        if (res < 0) continue;
        on++;
        ow += res;
        othN++;
        if (res === 1) othWin++;
        else if (res === 0.5) othTie++;
        othPct.push(pct[p]);
        othRes.push(res);
      }
      const o4 = at * OMAHA_FLOP_RUNOUT_ROW;
      rows[o4] = vw;
      rows[o4 + 1] = vn;
      rows[o4 + 2] = ow;
      rows[o4 + 3] = on;
      turnOf[at] = t;
      at++;
    }
  }
  if (!(valN > 0) || !(othN > 0)) return null;
  const vShare = vc / P;
  const value = { win: valWin / valN, tie: valTie / valN };
  const other = { win: othWin / othN, tie: othTie / othN };
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
    samples: valN + othN,
    value,
    other,
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
  entry.counts.set(shareKey, out);
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
 */
export function omahaFlopRunoutRealization(
  rows: ArrayLike<number> | null | undefined,
  turnOf: ArrayLike<number> | null | undefined,
  bluffShare: number,
  inPosition: boolean
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
  const base = OMAHA_FLOP_RUNOUT_CHECKDOWN[inPosition ? 'ip' : 'oop'];
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
  /** The bettor did not make the last preflop raise and bets into the live player who did. */
  lead: boolean;
  /** Other players in the hand: called this wager, all in before the flop, still to act. */
  callers: number;
  allIns: number;
  behind: number;
  /** Chips the call puts in, and the chips it can win. */
  paid: number;
  winnable: number;
  /** The call is for the whole stack. */
  allIn: boolean;
  /** No later decision: the whole stack, a trivial amount left, or nobody left who can bet. */
  final: boolean;
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
  gs: HorseGameStateV2
): OmahaFlopFacingBetEvSpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!OMAHA_FLOP_FACING_BET_EV_VARIANTS.has(variant)) return null;
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

    // The flop line: how many times the level was raised (a second wager is a raise).
    let level = 0;
    let wagers = 0;
    const totals = new Map<number, number>();
    for (const a of gs.actionHistory ?? []) {
      if (String(a.stage) !== 'flop') continue;
      const prev = totals.get(a.seat) ?? 0;
      const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
      if (a.action === 'call') totals.set(a.seat, prev + amt);
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
    // The last preflop raiser (the level raised over the forced posts), when there was one.
    let preLevel = 0;
    let preAggressor: number | null = null;
    const preTotals = new Map<number, number>();
    for (const a of gs.actionHistory ?? []) {
      if (String(a.stage) !== 'preflop') continue;
      const prev = preTotals.get(a.seat) ?? 0;
      const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
      if (a.action === 'call') preTotals.set(a.seat, prev + amt);
      else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
        const now = Math.max(prev, amt);
        preTotals.set(a.seat, now);
        if (now > preLevel + 0.005) {
          preLevel = now;
          preAggressor = a.seat;
        }
      } else if (amt > preLevel) preLevel = amt; // a forced post sets the level; it is not a raise
    }
    const aggressorLive =
      preAggressor !== null &&
      gs.players.some((p) => p.seat === preAggressor && !p.is_folded && !p.is_sitting_out);
    const lead = !isRaise && aggressorLive && preAggressor !== faced.bettorSeat;

    // The field.
    let callers = 0;
    let allIns = 0;
    let behind = 0;
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
      else behind++;
    }
    const winnable = gs.pot - uncovered;
    if (!(winnable > 0)) return null;
    const leftBehind = player.stack - paid;
    const final =
      allIn ||
      leftBehind <= OMAHA_FACING_BET_EV_TRIVIAL_BEHIND * (winnable + paid) ||
      canStillBet === 0;
    const bucket = omahaBetSizeBucket(potFrac);
    const line = lead ? OMAHA_FLOP_EV_LEAD : 1;
    return {
      street: 'flop',
      bettorSeat: faced.bettorSeat,
      potFrac,
      bucket,
      isRaise,
      lead,
      callers,
      allIns,
      behind,
      paid,
      winnable,
      allIn,
      final,
      valueShare: OMAHA_FLOP_EV_VALUE_SHARE[isRaise ? 'raise' : bucket] * line,
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
  pWin: number;
  pTie: number;
  /** the non-value share used and the value share sampled */
  bluffShare: number;
  valueShare: number;
  /** the Horse's win share against the value region / the other holdings, before the field */
  vsValue: number;
  vsOther: number;
  /** the product of the field factors (1 heads-up) */
  field: number;
  /** the realization factor applied (1 when final), and the share of equity on runouts the hand calls down */
  realization: number;
  robustShare: number | null;
  /** pot odds of the call, for the record */
  price: number;
  /** work done, and the seed it was drawn with */
  runouts: number;
  samples: number;
  seed: number;
}

export interface OmahaFlopFacingBetEvContext {
  /** the marginal rake on the pot, as a fraction (0 when capped or none) */
  rake?: number;
  /** the Horse acts last on the later streets */
  inPosition?: boolean;
}

/** The decision: call when EV(call) exceeds the one margin. Null when the hand cannot be sampled. */
export function omahaFlopFacingBetEvVerdict(
  spot: OmahaFlopFacingBetEvSpot,
  hole: Card[],
  board: Card[],
  dead: Card[],
  read: OmahaFacingBetEvRead | null,
  ctx: OmahaFlopFacingBetEvContext = {}
): OmahaFlopFacingBetEvVerdict | null {
  let counted: OmahaFlopEvCounts | null;
  try {
    counted = omahaFlopEvCounts(hole, board, dead, spot.valueShare);
  } catch {
    counted = null;
  }
  if (!counted) return null;
  const hand = counted;
  const q = omahaEvBluffShare(spot.priorBluff, read);
  let pWin = q * hand.other.win + (1 - q) * hand.value.win;
  let pTie = q * hand.other.tie + (1 - q) * hand.value.tie;
  // The field: each must be beaten too. A player already in is always there;
  // a player still to act is there only with the share he continues with.
  let field = 1;
  const need = (share: number, alwaysIn: boolean): number => {
    const s = hand.top(share);
    const holds = s.win + s.tie * 0.5;
    return alwaysIn ? holds : 1 - share * (1 - holds);
  };
  const callerShare =
    spot.potFrac < 0.25
      ? 1 - (1 - OMAHA_FLOP_EV_CALLER_SHARE) * (spot.potFrac / 0.25)
      : OMAHA_FLOP_EV_CALLER_SHARE;
  if (spot.callers > 0) field *= need(callerShare, true) ** spot.callers;
  if (spot.allIns > 0) field *= need(OMAHA_EV_ALL_IN_SHARE, true) ** spot.allIns;
  if (spot.behind > 0) field *= need(OMAHA_EV_BEHIND_SHARE, false) ** spot.behind;
  pWin *= field;
  pTie *= field;
  let realization = 1;
  let robustShare: number | null = null;
  if (!spot.final) {
    const r = omahaFlopRunoutRealization(hand.rows, hand.turnOf, q, ctx.inPosition === true);
    if (!r) return null;
    realization = r.realization;
    robustShare = r.robustShare;
    if (spot.behind > 0) realization = Math.min(realization, OMAHA_FLOP_EV_BEHIND_REALIZATION_CAP);
  }
  pWin *= realization;
  pTie *= realization;
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? ctx.rake! : 0));
  const win = spot.winnable * (1 - rake);
  const pLose = Math.max(0, 1 - pWin - pTie);
  const ev = pWin * win + pTie * ((win - spot.paid) / 2) - pLose * spot.paid;
  const baseMargin =
    omahaStrategyConstant('facingBetEvMargin', { gameVariant: `plo${hole.length}` }) *
    (spot.winnable + spot.paid);
  const margin = spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
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
    field,
    realization,
    robustShare,
    price: spot.paid / (spot.winnable + spot.paid),
    runouts: hand.runouts,
    samples: hand.samples,
    seed: hand.seed,
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
