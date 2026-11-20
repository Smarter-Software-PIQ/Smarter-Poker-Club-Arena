/**
 * omahaMathCore component: DRAWS (lane DRAWS 2026-11-19; owner 8:17 PM Chicago:
 * "they RAISE and actually take charge of hands with combo draws. Hands with
 * pairs, open-ended with flushes and an entire variety of combo draws").
 * Scope PLO4 and PLO5 cash only (owner 8:27 PM: "DON'T TOUCH PLO6"): every
 * export returns null / a zero term for any other hole-card count.
 *
 * 1. omahaDrawFeatures: the exact draw profile of a flop or turn hand under the
 *    Omaha rule (exactly two hole cards and three board cards). Every unseen
 *    card (52 - hole - board; opponents' cards are not known) is dealt and
 *    scored: an OUT lifts the hand to a straight or better from a lower
 *    category; a NUT out leaves it tied with or above every two-card holding
 *    the remaining cards allow (straight flushes and quads, which need two
 *    specific cards, are not counted as "the nuts" unless the hero holds them);
 *    a CLEAN nut out does not pair the board (a paired board puts full houses
 *    in a set's or two pair's hand).
 *
 * 2. omahaDrawFutureTerm: the later-street value the core's showdown equity
 *    leaves out. The core prices a call or a called wager as
 *    equity x (pot now + chips this street): it assumes the money behind never
 *    goes in. A nut draw that arrives is paid on later streets (implied odds);
 *    a non-nut or board-pairing completion pays off a better hand (reverse
 *    implied odds). Measured, public information only: the Horse's own cards,
 *    the board and the chips every seat put in on later streets (AUDIT-48
 *    dataset, PLO4+PLO5 cash, 48 h to Nov 19 6:49 PM Chicago), in units of the
 *    next street's starting pot:
 *      laterNet = opponents' later chips when the Horse won the hand,
 *                 minus the Horse's later chips when it lost.
 *    term = sum over next-card outcomes (nut out / other out / miss) of
 *           P(outcome) x laterNet(outcome) x potNext, bounded by the stack behind.
 *    On the flop a wager line may also carry the turn barrel when the draw
 *    misses: P(miss) x max(measured miss value, barrel EV at the measured fold
 *    rate the core supplies). An all-in has no later street: term 0.
 *
 * Pure; no randomness; cards are the core's integers (rank * 4 + suit, deuce 0).
 */
import {
  CAT_PAIR,
  CAT_STRAIGHT,
  CAT_TRIPS,
  CAT_TWO_PAIR,
  categoryOf,
  eval5,
  omahaBest,
} from './OmahaMathCoreEval.js';

export const OMAHA_DRAWS_VERSION = 'omaha-draws-v1';

/** The later-street term on/off (replay arms and the integrator's switch); features are always available. */
let DRAWS_TERM_ENABLED = true;
export function setOmahaDrawsEnabled(on: boolean): void {
  DRAWS_TERM_ENABLED = on;
}
/** PLO4 and PLO5 only (owner 2026-11-19 8:27 PM Chicago: PLO6 is a separate thing). */
export const OMAHA_DRAWS_HOLE_COUNTS: ReadonlySet<number> = new Set([4, 5]);

export type OmahaDrawMade =
  | 'high'
  | 'toppair'
  | 'overpair'
  | 'lowpair'
  | 'underpair'
  | 'twopair'
  | 'set'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'full'
  | 'quads'
  | 'sflush';

export interface OmahaDrawFeatures {
  version: string;
  /** unseen cards (52 - hole - board) */
  unseen: number;
  /** next cards that lift the hand to a straight or better from a lower category */
  outs: number;
  /** outs after which the hand is the nuts */
  nutOuts: number;
  /** nut outs that do not pair the board */
  cleanNutOuts: number;
  /** outs that pair the board (full houses become possible) */
  pairingOuts: number;
  flushOuts: number;
  nutFlushOuts: number;
  straightOuts: number;
  nutStraightOuts: number;
  /** outs to a full house or better (a set's or two pair's redraw) */
  boatOuts: number;
  /** next cards that complete a straight under the two-card rule, flush or not */
  wrapSize: number;
  fd: 'none' | 'fd' | 'nfd';
  backdoorFlush: boolean;
  made: OmahaDrawMade;
  /** the hand is the nuts now */
  madeNuts: boolean;
  pairPlusDraw: boolean;
  /** a flush draw with eight or more straight cards, a pair with a flush draw and a straight draw, or two pair+ with a draw */
  comboDraw: boolean;
  /** one label per hand (reporting and receipts) */
  cls: string;
}

const NO_NUT_CAT = 7; // quads / straight flushes are blockers' noise, not the nuts

/** The best hand any two of the live cards make with three of `board` (quads and straight flushes excluded). */
export function omahaBoardNuts(board: readonly number[], dead: readonly number[]): number {
  const used = new Uint8Array(52);
  for (const c of board) used[c] = 1;
  for (const c of dead) used[c] = 1;
  const live: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) live.push(c);
  const b = board.length;
  let best = -1;
  for (let x = 0; x < b - 2; x++)
    for (let y = x + 1; y < b - 1; y++)
      for (let z = y + 1; z < b; z++) {
        const b1 = board[x],
          b2 = board[y],
          b3 = board[z];
        for (let i = 0; i < live.length - 1; i++)
          for (let j = i + 1; j < live.length; j++) {
            const s = eval5(live[i], live[j], b1, b2, b3);
            if (s > best && categoryOf(s) < NO_NUT_CAT) best = s;
          }
      }
  return best;
}

function rankOf(c: number): number {
  return c >> 2;
}
function suitOf(c: number): number {
  return c & 3;
}

/** A straight (any suits) with exactly two hole cards and three board cards. */
function makesStraight(hole: readonly number[], board: readonly number[]): boolean {
  const h = hole.length,
    b = board.length;
  for (let i = 0; i < h - 1; i++)
    for (let j = i + 1; j < h; j++)
      for (let x = 0; x < b - 2; x++)
        for (let y = x + 1; y < b - 1; y++)
          for (let z = y + 1; z < b; z++) {
            const rs = [hole[i], hole[j], board[x], board[y], board[z]].map(rankOf);
            let mask = 0;
            for (const r of rs) mask |= 1 << r;
            if (new Set(rs).size !== 5) continue;
            for (let hi = 12; hi >= 4; hi--) {
              const m = 0x1f << (hi - 4);
              if ((mask & m) === m) return true;
            }
            if ((mask & 0x100f) === 0x100f) return true;
          }
  return false;
}

/** The rank of the pair / trips the best two-plus-three hand is built on. */
function madeRank(hole: readonly number[], board: readonly number[], best: number): number {
  const h = hole.length,
    b = board.length;
  for (let i = 0; i < h - 1; i++)
    for (let j = i + 1; j < h; j++)
      for (let x = 0; x < b - 2; x++)
        for (let y = x + 1; y < b - 1; y++)
          for (let z = y + 1; z < b; z++) {
            const cs = [hole[i], hole[j], board[x], board[y], board[z]];
            if (eval5(cs[0], cs[1], cs[2], cs[3], cs[4]) !== best) continue;
            const n = new Array(13).fill(0);
            for (const c of cs) n[rankOf(c)]++;
            let r = -1;
            for (let k = 12; k >= 0; k--) if (n[k] >= 2 && (r < 0 || n[k] > n[r])) r = k;
            return r;
          }
  return -1;
}

export function omahaDrawFeatures(
  hole: readonly number[],
  board: readonly number[]
): OmahaDrawFeatures | null {
  if (!OMAHA_DRAWS_HOLE_COUNTS.has(hole.length)) return null;
  if (board.length !== 3 && board.length !== 4) return null;
  const seen = new Uint8Array(52);
  for (const c of [...hole, ...board]) {
    if (!(c >= 0 && c < 52) || seen[c]) return null;
    seen[c] = 1;
  }
  const unseen: number[] = [];
  for (let c = 0; c < 52; c++) if (!seen[c]) unseen.push(c);
  const cur = omahaBest(hole, hole.length, board, board.length);
  const curCat = categoryOf(cur);
  const boardRanks = board.map(rankOf);
  const topBoard = Math.max(...boardRanks);
  const nb = new Array<number>(board.length + 1);
  for (let i = 0; i < board.length; i++) nb[i] = board[i];
  let outs = 0,
    nutOuts = 0,
    cleanNutOuts = 0,
    pairingOuts = 0,
    flushOuts = 0,
    nutFlushOuts = 0,
    straightOuts = 0,
    nutStraightOuts = 0,
    boatOuts = 0,
    wrapSize = 0;
  for (const c of unseen) {
    nb[board.length] = c;
    if (curCat < CAT_STRAIGHT && makesStraight(hole, nb)) wrapSize++;
    const s = omahaBest(hole, hole.length, nb, nb.length);
    const cat = categoryOf(s);
    if (!(cat >= CAT_STRAIGHT && cat > curCat)) continue;
    outs++;
    const pairs = boardRanks.includes(rankOf(c));
    if (pairs) pairingOuts++;
    const nut = s >= omahaBoardNuts(nb, hole);
    if (nut) {
      nutOuts++;
      if (!pairs) cleanNutOuts++;
    }
    if (cat === CAT_STRAIGHT) {
      straightOuts++;
      if (nut) nutStraightOuts++;
    } else if (cat === CAT_STRAIGHT + 1) {
      flushOuts++;
      if (nut) nutFlushOuts++;
    } else boatOuts++;
  }
  let fd: OmahaDrawFeatures['fd'] = 'none';
  let backdoorFlush = false;
  for (let s = 0; s < 4; s++) {
    const onBoard = board.filter((c) => suitOf(c) === s).length;
    const inHand = hole.filter((c) => suitOf(c) === s).map(rankOf);
    if (onBoard === 2 && inHand.length >= 2 && curCat < CAT_STRAIGHT + 1) {
      let top = 12;
      while (board.some((c) => suitOf(c) === s && rankOf(c) === top)) top--;
      if (inHand.includes(top)) fd = 'nfd';
      else if (fd === 'none') fd = 'fd';
    }
    if (board.length === 3 && onBoard === 1 && inHand.length >= 2) backdoorFlush = true;
  }
  let made: OmahaDrawMade;
  if (curCat === CAT_PAIR) {
    const r = madeRank(hole, board, cur);
    const pocket = !boardRanks.includes(r);
    made = pocket
      ? r > topBoard
        ? 'overpair'
        : 'underpair'
      : r === topBoard
        ? 'toppair'
        : 'lowpair';
  } else if (curCat === CAT_TRIPS) {
    const r = madeRank(hole, board, cur);
    made = boardRanks.filter((x) => x === r).length === 1 ? 'set' : 'trips';
  } else
    made = (
      ['high', 'pair', 'twopair', 'trips', 'straight', 'flush', 'full', 'quads', 'sflush'] as const
    )[curCat] as OmahaDrawMade;
  const madeNuts = cur >= omahaBoardNuts(board, hole);
  const pairish =
    made === 'toppair' || made === 'overpair' || made === 'lowpair' || made === 'underpair';
  const draw = fd !== 'none' || wrapSize >= 4;
  const pairPlusDraw = pairish && draw;
  const comboDraw =
    (fd !== 'none' && wrapSize >= 8) ||
    (pairish && fd !== 'none' && wrapSize >= 4) ||
    (curCat === CAT_TWO_PAIR && draw) ||
    (pairish && wrapSize >= 9);
  const f: OmahaDrawFeatures = {
    version: OMAHA_DRAWS_VERSION,
    unseen: unseen.length,
    outs,
    nutOuts,
    cleanNutOuts,
    pairingOuts,
    flushOuts,
    nutFlushOuts,
    straightOuts,
    nutStraightOuts,
    boatOuts,
    wrapSize,
    fd,
    backdoorFlush,
    made,
    madeNuts,
    pairPlusDraw,
    comboDraw,
    cls: '',
  };
  f.cls = omahaDrawClass(f);
  return f;
}

/** One label per hand (the audit's classes). */
export function omahaDrawClass(p: Omit<OmahaDrawFeatures, 'cls'>): string {
  const sd =
    p.wrapSize === 0
      ? 'none'
      : p.wrapSize <= 4
        ? 'gut'
        : p.wrapSize <= 8
          ? 'oesd'
          : p.wrapSize <= 12
            ? 'wrap9-12'
            : p.wrapSize <= 16
              ? 'wrap13-16'
              : 'wrap17+';
  const fd = p.fd !== 'none';
  const hasSd = sd !== 'none';
  const wrap = sd.startsWith('wrap');
  if (['straight', 'flush', 'full', 'quads', 'sflush'].includes(p.made))
    return p.outs > 0 ? `made_${p.made}+redraw` : `made_${p.made}`;
  if (p.made === 'set') return p.outs > 0 || fd || hasSd ? 'set+redraw' : 'set';
  if (p.made === 'trips') return fd || hasSd ? 'trips+draw' : 'trips';
  if (p.made === 'twopair') return fd || hasSd ? 'twopair+draw' : 'twopair';
  if (p.made !== 'high') {
    if (p.made === 'toppair' && p.fd === 'nfd') return hasSd ? 'toppair+NFD+SD' : 'toppair+NFD';
    if (fd && hasSd) return 'pair+FD+SD';
    if (fd) return p.fd === 'nfd' ? 'pair+NFD' : 'pair+FD';
    if (wrap) return 'pair+wrap';
    if (sd === 'oesd') return 'pair+OESD';
    if (sd === 'gut') return 'pair+gut';
    return p.made === 'toppair' || p.made === 'overpair' ? 'toppair/overpair' : 'weakpair';
  }
  if (fd && wrap) return `${p.fd.toUpperCase()}+wrap`;
  if (fd && hasSd) return `${p.fd.toUpperCase()}+${sd === 'oesd' ? 'OESD' : 'gut'}`;
  if (fd) return p.fd === 'nfd' ? 'NFD' : 'FD_nonnut';
  if (wrap) return sd;
  if (sd === 'oesd') return 'OESD';
  if (sd === 'gut') return 'gutshot';
  return p.backdoorFlush ? 'backdoor_only' : 'air';
}

/**
 * Measured later-street net per next-card outcome, in next-street starting
 * pots (PLO4+PLO5 cash; Horse's own cards + public chips; hands where the
 * Horse held a draw below trips with 4+ outs and reached a decision on the
 * next street). Source file: audit48 emerg/draws/work/out/implied45.json.
 */
export const OMAHA_DRAW_PAYOFF = {
  flop: {
    hitNut: 0.747,
    hitOther: -0.132,
    miss: -0.051,
    n: { hitNut: 94, hitOther: 132, miss: 1023 },
  },
  turn: {
    hitNut: 1.043,
    hitOther: 0.06,
    miss: -0.029,
    n: { hitNut: 35, hitOther: 127, miss: 586 },
  },
  source: 'audit48 PLO4+PLO5 cash 2026-11-18..19, own cards + public chips (implied45.json)',
} as const;

const DRAW_MADE: ReadonlySet<OmahaDrawMade> = new Set([
  'high',
  'toppair',
  'overpair',
  'lowpair',
  'underpair',
  'twopair',
]);

export interface OmahaDrawFutureContext {
  street: 'flop' | 'turn';
  /** the pot when the next street starts on this line (after this street's calls) */
  potNext: number;
  /** the effective stack still behind on this line when the next street starts */
  effBehind: number;
  /** the line puts the Horse or every opponent all-in (no later street) */
  allIn: boolean;
  /** flop wager lines only: measured fold rate of the continuing opponents to a turn barrel (null = none measured) */
  turnBarrelFold?: { p: number; source: string } | null;
  /** the turn barrel's share of the pot the core would size (default 2/3) */
  barrelFrac?: number;
}

export interface OmahaDrawFutureTerm {
  chips: number;
  implied: number;
  reverse: number;
  miss: number;
  barrel: number | null;
  pNut: number;
  pOther: number;
  pMiss: number;
  source: string;
}

export function omahaDrawFutureTerm(
  f: OmahaDrawFeatures | null,
  ctx: OmahaDrawFutureContext
): OmahaDrawFutureTerm {
  const zero: OmahaDrawFutureTerm = {
    chips: 0,
    implied: 0,
    reverse: 0,
    miss: 0,
    barrel: null,
    pNut: 0,
    pOther: 0,
    pMiss: 1,
    source: 'no later street',
  };
  if (!DRAWS_TERM_ENABLED || !f || ctx.allIn || !(ctx.effBehind > 0) || !(ctx.potNext > 0))
    return zero;
  // the measurement covers draws below trips with four or more outs; anything else gets no term
  if (f.outs < 4 || !DRAW_MADE.has(f.made))
    return { ...zero, source: 'not a draw below trips (no measured term)' };
  const pay = OMAHA_DRAW_PAYOFF[ctx.street];
  const pNut = f.nutOuts / f.unseen;
  const pOther = (f.outs - f.nutOuts) / f.unseen;
  const pMiss = Math.max(0, 1 - pNut - pOther);
  const P = ctx.potNext;
  const implied = pNut * pay.hitNut * P;
  const reverse = pOther * pay.hitOther * P;
  let missValue = pay.miss * P;
  let barrel: number | null = null;
  if (
    ctx.street === 'flop' &&
    ctx.turnBarrelFold &&
    ctx.turnBarrelFold.p >= 0 &&
    ctx.turnBarrelFold.p <= 1
  ) {
    // a turn barrel b after a missed turn card, gain over checking it down: fold -> the pot the
    // check-down would have shared (1 - e); called -> the river nut outs e against the barrel and its call
    const F = ctx.turnBarrelFold.p;
    const b = Math.min(ctx.effBehind, (ctx.barrelFrac ?? 2 / 3) * P);
    const e = f.unseen > 1 ? f.nutOuts / (f.unseen - 1) : 0;
    barrel = F * (1 - e) * P + (1 - F) * (2 * b * e - b);
    missValue = Math.max(missValue, barrel);
  }
  const miss = pMiss * missValue;
  const raw = implied + reverse + miss;
  const chips = Math.max(-ctx.effBehind, Math.min(ctx.effBehind, raw));
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    chips: r(chips),
    implied: r(implied),
    reverse: r(reverse),
    miss: r(miss),
    barrel: barrel === null ? null : r(barrel),
    pNut: Math.round(pNut * 1e4) / 1e4,
    pOther: Math.round(pOther * 1e4) / 1e4,
    pMiss: Math.round(pMiss * 1e4) / 1e4,
    source: `${OMAHA_DRAW_PAYOFF.source}${barrel === null ? '' : `; turn barrel fold ${ctx.turnBarrelFold!.source}`}`,
  };
}
