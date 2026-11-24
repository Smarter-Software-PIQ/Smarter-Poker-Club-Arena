/**
 * omahaFacingBetEvShownField (WooWoo audit F-04 / F-11 redesign C3, default OFF).
 *
 * A Horse facing a bet on the TURN or RIVER with at least one other player in
 * the hand (a caller of the wager, a player all in earlier, or a player still to
 * act). PLO4/PLO5 only (the caller passes nothing for six cards). It replaces,
 * inside omahaFacingBetEvVerdict, three parts of the field pricing that the two
 * failed candidates kept or got wrong (A/dispositions/REDESIGN-PLAN.md section 1):
 *
 * 1. THE FIELD IN THE FLOP FORM (HorseOmahaFlopFacingBetEv: OmahaFlopEvField,
 *    jointValue / jointOther by j, exact tie shares). Every other player gets a
 *    holding on the SAME runout and the same disjoint cards as the bettor; a
 *    player still to act is in with probability c (binomial over the players
 *    behind), and when he continues his call goes into the pot. No separate
 *    multiplicative "need" factor per player, so nobody is charged twice.
 * 2. REALIZATION FROM THE MEASURED TURN CELLS (realfit-013U37
 *    realization-fit.json sha256 0cd708ff5f5e..., table "HORSE callers, all
 *    bettors", turn x class x position, hierarchically shrunk). No 0.85 cap for
 *    a player behind: he is priced in the binomial.
 * 3. CLOSE CALLS ARE MIXED, NOT THRESHOLDED. The EV carries an uncertainty
 *    (sampling of the joint count + the continue rate + the realization cell's
 *    SE, delta method). With |EV - margin| > 2 SE the sign decides; inside the
 *    band the call is made with probability Phi((EV - margin) / SE) on a draw
 *    keyed by PUBLIC state only (the caller supplies `mixUnit`).
 *
 * Declared fallbacks (UNMEASURED, listed in the authority file; to be replaced
 * by the showdown-range table before any activation):
 * - the range share of a caller / of a continuing player behind is the stated
 *   OMAHA_EV_CALLER_SHARE (turn 0.45, river 0.35, with main's size taper);
 *   an earlier all-in OMAHA_EV_ALL_IN_SHARE 0.5;
 * - the continue rate of a player behind is the FLOP curve
 *   omahaFlopEvBehindContinue (n 8,875); no turn curve is measured yet.
 * The bet's size enters only as the price and through those measured curves:
 * no threshold is keyed to size, hand class or position.
 */
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { omahaFieldDrawStreams, omahaFieldDrawTraceOf } from './HorseOmahaFieldDrawStreams.js';

export type OmahaShownTurnClass = 'two_pair_plus' | 'one_pair' | 'nut_combo_draw';

/** realfit turn cells (Horse callers, all bettors): shrunk realization, its SE, calls. */
export interface OmahaShownRealizationCell {
  r: number;
  se: number;
  n: number;
}
export const OMAHA_SHOWN_TURN_REALIZATION: Readonly<
  Record<OmahaShownTurnClass, Readonly<Record<'ip' | 'oop', OmahaShownRealizationCell>>>
> = {
  two_pair_plus: { ip: { r: 0.9141, se: 0.047, n: 820 }, oop: { r: 0.8067, se: 0.0466, n: 857 } },
  one_pair: { ip: { r: 0.8794, se: 0.058, n: 387 }, oop: { r: 0.8665, se: 0.0566, n: 446 } },
  nut_combo_draw: { ip: { r: 0.8575, se: 0.0583, n: 226 }, oop: { r: 0.9112, se: 0.0579, n: 296 } },
};
/** The flop curve's bucket sizes (omahaFlopEvBehindContinue), smallest: the rate's binomial SE uses it. */
export const OMAHA_SHOWN_CONTINUE_N = 576;
/** Showdown sets per river on the turn, and on the river (no runout). */
export const OMAHA_SHOWN_SETS_PER_RIVER = 8;
export const OMAHA_SHOWN_SETS_RIVER = 320;
/** Holdings drawn to rank the ranges. */
export const OMAHA_SHOWN_POOL = 640;
/** Most other players the joint count draws for. */
export const OMAHA_SHOWN_FIELD_MAX = 5;
/** The band, in standard errors, inside which the call is mixed. */
export const OMAHA_SHOWN_BAND_SE = 2;

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
const WALK = 0.6180339887498949;

/**
 * Class of the Horse's hand on the turn board, in realfit's classes: two pair
 * or better under the two-card rule; else a flush draw with two of a suit on
 * the board and two in hand, or a one-card-to-come improvement to a straight on
 * eight or more river cards; else one pair or less (realfit's weak-draw and air
 * cells hold 33 and 7 calls: they are pooled into one_pair).
 */
export function omahaShownTurnClass(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = []
): OmahaShownTurnClass {
  const h = [...hole];
  const b = [...board];
  const now = scoreOmahaHiPartial(h, b);
  if (Math.floor(now / 0x100000) >= 3) return 'two_pair_plus';
  const bySuit = new Map<string, number>();
  for (const c of b) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
  for (const [s, k] of bySuit)
    if (k === 2 && h.filter((c) => c.suit === s).length >= 2) return 'nut_combo_draw';
  if (b.length === 4) {
    const seen = new Set([...h, ...b, ...dead].map(key));
    let straights = 0;
    for (const s of SUITS)
      for (const r of RANKS) {
        const card = { rank: r, suit: s } as Card;
        if (seen.has(key(card))) continue;
        const cat = Math.floor(scoreOmahaHiPartial(h, [...b, card]) / 0x100000);
        if (cat === 5) straights++;
      }
    if (straights >= 8) return 'nut_combo_draw';
  }
  return 'one_pair';
}

export interface OmahaShownJoint {
  /** equity share (win + exact tie share) against the bettor's value region / other holdings and the field, by j behind continuing */
  value: number[];
  other: number[];
  /** showdown sets counted per region */
  nValue: number;
  nOther: number;
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

/**
 * The joint count: the Horse's share of the pot at showdown against one
 * holding of the bettor (from his value region, the strongest `valueShare` of
 * holdings ranked by strength on the current board, or from the rest) and one
 * holding for every other player (`always[i]` = range share of a player
 * already in; `behind` players still to act with range share `behindShare`),
 * all on disjoint cards, over every river card on the turn. Index j of the
 * result: the first j players behind continue. Deterministic (seed = cards).
 * `independentField` (omahaMultiwayFieldDrawsAreIndependent, default false): each other player draws his holding
 * from his own seeded stream (HorseOmahaFieldDrawStreams), not on a walk locked to the bettor's.
 */
export function omahaShownJoint(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number,
  always: readonly number[],
  behind: number,
  behindShare: number,
  independentField = false
): OmahaShownJoint | null {
  if (!Array.isArray(hole) || (hole.length !== 4 && hole.length !== 5)) return null;
  if (!Array.isArray(board) || (board.length !== 4 && board.length !== 5)) return null;
  const B = Math.max(0, Math.floor(behind));
  const A = always.length;
  if (A + B > OMAHA_SHOWN_FIELD_MAX) return null;
  const removed = new Set([...hole, ...board, ...(dead ?? [])].map(key));
  if (new Set([...hole, ...board].map(key)).size !== hole.length + board.length) return null;
  const unseen: Card[] = [];
  for (const s of SUITS)
    for (const r of RANKS) {
      const c = { rank: r, suit: s } as Card;
      if (!removed.has(key(c))) unseen.push(c);
    }
  const m = unseen.length;
  const n = hole.length;
  if (m < n * (2 + A + B) + 1 || m > 48) return null;
  const seed = seedOf(hole, board, dead ?? []);
  const rnd = stream(seed);
  // pool ranked by strength on the current board
  const P = OMAHA_SHOWN_POOL;
  const cards = new Int8Array(P * n);
  const strength = new Float64Array(P);
  const deck = new Int8Array(m);
  const tmp: Card[] = new Array<Card>(n);
  for (let p = 0; p < P; p++) {
    for (let i = 0; i < m; i++) deck[i] = i;
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(rnd() * (m - k));
      const t = deck[k];
      deck[k] = deck[j];
      deck[j] = t;
      cards[p * n + k] = deck[k];
      tmp[k] = unseen[deck[k]];
    }
    strength[p] = scoreOmahaHiPartial(tmp, board);
  }
  const order = Array.from({ length: P }, (_, p) => p).sort(
    (a, b) => strength[b] - strength[a] || a - b
  );
  const clampShare = (s: number): number => Math.max(0.02, Math.min(1, Number.isFinite(s) ? s : 1));
  const vc = Math.max(1, Math.min(P - 1, Math.round(clampShare(valueShare) * P)));
  const regionCount = (s: number): number =>
    Math.max(1, Math.min(P, Math.round(clampShare(s) * P)));
  const others = A + B;
  const fieldCount = Array.from({ length: others }, (_, f) =>
    regionCount(f < A ? always[f] : behindShare)
  );
  const walks = Array.from({ length: others + 2 }, () => rnd());
  // omahaMultiwayFieldDrawsAreIndependent: one stream per other player (absent: the walks above).
  const fieldStreams =
    independentField === true && others > 0 ? omahaFieldDrawStreams(seed, others, A) : null;
  const trace = omahaFieldDrawTraceOf();
  const traceField = trace ? new Array<number>(others) : null;
  const rankOf = trace ? new Int32Array(P) : null;
  if (rankOf) for (let k = 0; k < P; k++) rankOf[order[k]] = k;
  const used = new Uint8Array(m);
  const draw = (w: number, from: number, count: number): number => {
    if (fieldStreams && w >= 2) walks[w] = fieldStreams[w - 2]();
    const i = Math.floor(walks[w] * count);
    if (!(fieldStreams && w >= 2)) walks[w] = (walks[w] + WALK) % 1;
    for (let t = 0; t < Math.min(count, 256); t++) {
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
  const scoreOf = (p: number, full: Card[]): number => {
    for (let k = 0; k < n; k++) tmp[k] = unseen[cards[p * n + k]];
    return scoreOmahaHiPartial(tmp, full);
  };
  const accV = new Float64Array(B + 1);
  const accO = new Float64Array(B + 1);
  let nV = 0;
  let nO = 0;
  const rivers = board.length === 4 ? Array.from({ length: m }, (_, i) => i) : [-1];
  const sets = board.length === 4 ? OMAHA_SHOWN_SETS_PER_RIVER : OMAHA_SHOWN_SETS_RIVER;
  const fieldScore = new Float64Array(others);
  const picked = new Int32Array(others + 1);
  for (const rv of rivers) {
    const full = rv < 0 ? board : [...board, unseen[rv]];
    if (rv >= 0) used[rv] = 1;
    const hero = scoreOmahaHiPartial(hole, full);
    for (let s = 0; s < sets; s++) {
      const isValue = s % 2 === 0;
      const p = isValue ? draw(0, 0, vc) : draw(1, vc, P - vc);
      if (p < 0) continue;
      mark(p, 1);
      picked[0] = p;
      let whole = true;
      let k = 0;
      for (; k < others; k++) {
        const g = draw(2 + k, 0, fieldCount[k]);
        if (g < 0) {
          whole = false;
          break;
        }
        mark(g, 1);
        picked[k + 1] = g;
        fieldScore[k] = scoreOf(g, full);
        if (traceField && rankOf) traceField[k] = (rankOf[g] + 0.5) / fieldCount[k];
      }
      for (let u = 1; u <= k; u++) mark(picked[u], 0);
      mark(p, 0);
      if (!whole) continue;
      if (trace && traceField && rankOf) trace('shown', (rankOf[p] + 0.5) / P, isValue, traceField);
      const bettor = scoreOf(p, full);
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
    if (rv >= 0) used[rv] = 0;
  }
  if (!(nV > 0) || !(nO > 0)) return null;
  return {
    value: Array.from(accV, (x) => x / nV),
    other: Array.from(accO, (x) => x / nO),
    nValue: nV,
    nOther: nO,
  };
}

function binom(nn: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (nn - k + i)) / i;
  return r;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
export function omahaShownPhi(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface OmahaShownFieldInput {
  street: 'turn' | 'river';
  /** chips the call puts in; chips it can win (before rake); rake fraction */
  paid: number;
  winnable: number;
  rake: number;
  /** no later decision (river, all in, or trivial chips behind) */
  final: boolean;
  /** the bettor's bluff share (q) */
  bluff: number;
  /** callers / all-ins range shares, players behind, their range share and continue rate */
  always: readonly number[];
  behind: number;
  behindShare: number;
  continueRate: number;
  inPosition: boolean;
  /** the verdict's margin in chips */
  margin: number;
  /** a number in [0, 1) drawn from PUBLIC state only */
  mixUnit: number;
  /** omahaMultiwayFieldDrawsAreIndependent: each other player's holding from his own seeded stream */
  independentField?: boolean;
}

export interface OmahaShownFieldVerdict {
  call: boolean;
  ev: number;
  se: number;
  /** probability the call is made (0 or 1 outside the band) */
  pCall: number;
  mixed: boolean;
  realization: number;
  realizationClass: OmahaShownTurnClass | null;
  equity: number;
}

export function omahaShownFieldVerdict(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number,
  x: OmahaShownFieldInput
): OmahaShownFieldVerdict | null {
  const joint = omahaShownJoint(
    hole,
    board,
    dead,
    valueShare,
    x.always,
    x.behind,
    x.behindShare,
    x.independentField === true
  );
  if (!joint) return null;
  const q = Math.max(0, Math.min(1, x.bluff));
  const c = Math.max(0, Math.min(1, x.continueRate));
  const B = Math.max(0, Math.floor(x.behind));
  let klass: OmahaShownTurnClass | null = null;
  let R = 1;
  let seR = 0;
  if (!x.final && x.street === 'turn') {
    klass = omahaShownTurnClass(hole, board, dead);
    const cell = OMAHA_SHOWN_TURN_REALIZATION[klass][x.inPosition ? 'ip' : 'oop'];
    R = cell.r;
    seR = cell.se;
  }
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(x.rake) ? x.rake : 0));
  let ev = 0;
  let dR = 0;
  let dC = 0;
  let varS = 0;
  let equity = 0;
  for (let j = 0; j <= B; j++) {
    const w = binom(B, j) * c ** j * (1 - c) ** (B - j);
    const e = q * joint.other[j] + (1 - q) * joint.value[j];
    const T = (x.winnable + j * x.paid) * (1 - rake) + x.paid;
    const evj = R * e * T - x.paid;
    ev += w * evj;
    equity += w * e;
    dR += w * e * T;
    // d w / d c
    const dw =
      binom(B, j) *
      ((j > 0 ? j * c ** (j - 1) * (1 - c) ** (B - j) : 0) -
        (B - j > 0 ? (B - j) * c ** j * (1 - c) ** (B - j - 1) : 0));
    dC += dw * evj;
    const vV = (joint.value[j] * (1 - joint.value[j])) / joint.nValue;
    const vO = (joint.other[j] * (1 - joint.other[j])) / joint.nOther;
    varS += (w * R * T) ** 2 * ((1 - q) ** 2 * vV + q ** 2 * vO);
  }
  const varC = B > 0 ? (c * (1 - c)) / OMAHA_SHOWN_CONTINUE_N : 0;
  const se = Math.sqrt(varS + (dR * seR) ** 2 + dC * dC * varC);
  const edge = ev - x.margin;
  let pCall: number;
  let mixed = false;
  if (!(se > 0) || Math.abs(edge) > OMAHA_SHOWN_BAND_SE * se) pCall = edge > 0 ? 1 : 0;
  else {
    pCall = omahaShownPhi(edge / se);
    mixed = true;
  }
  const u = Number.isFinite(x.mixUnit) ? Math.max(0, Math.min(0.999999, x.mixUnit)) : 0.5;
  return { call: u < pCall, ev, se, pCall, mixed, realization: R, realizationClass: klass, equity };
}

/** Salt of the mixing draw (distinct from OMAHA_PRICED_MIX_SALT). */
export const OMAHA_SHOWN_MIX_SALT = 0x5b0f1e;
/**
 * The mixing draw: a number in [0, 1) from the decision's PUBLIC spot key
 * (HorseOmahaPricedRules.omahaPricedPublicSpotKey: street, board, pot, wager,
 * seat, action count). The Horse's cards are not read, so the draw says
 * nothing about its hand, and a replay of the node draws the same number.
 */
export function omahaShownFieldMixUnit(publicKey: string): number {
  let h = (0x811c9dc5 ^ OMAHA_SHOWN_MIX_SALT) >>> 0;
  const k = String(publicKey ?? '');
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
