/**
 * Hold'em cards, a 7-card evaluator, exact equity tables and weighted ranges for the Horse hand audit
 * (scripts/ops/horse-hand-audit-holdem.mjs). Pure functions, no I/O except the optional preflop matrix cache.
 *
 * Card index = rank * 4 + suit, rank 0..12 = 2..A, suit 0..3 = clubs, diamonds, hearts, spades.
 * Hand value: category << 20 | kickers (4 bits each), larger is better, equal is a tie.
 * Categories: 0 high card, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house, 7 quads, 8 straight flush.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'cdhs';

/** Parse {rank, suit}, "Ah", "10hearts", "Tclubs" or a card index. Returns 0..51 or -1. */
export function parseCard(x) {
  if (typeof x === 'number') return x >= 0 && x < 52 ? x : -1;
  if (!x) return -1;
  let r;
  let s;
  if (typeof x === 'object') {
    r = String(x.rank ?? '');
    s = String(x.suit ?? '');
  } else {
    const m = /^(10|[2-9TJQKA])([a-zA-Z]+)$/.exec(String(x).trim());
    if (!m) return -1;
    r = m[1];
    s = m[2];
  }
  if (r === '10') r = 'T';
  const ri = RANK_CHARS.indexOf(r.toUpperCase());
  const si = SUIT_CHARS.indexOf(s.charAt(0).toLowerCase());
  if (ri < 0 || si < 0) return -1;
  return ri * 4 + si;
}

export function cardStr(c) {
  return RANK_CHARS[c >> 2] + SUIT_CHARS[c & 3];
}

// ---- evaluator -------------------------------------------------------------------------------
const STRAIGHT_HI = new Int8Array(8192).fill(-1);
for (let m = 0; m < 8192; m++) {
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0x1f << (hi - 4);
    if ((m & need) === need) {
      STRAIGHT_HI[m] = hi;
      break;
    }
  }
  if (STRAIGHT_HI[m] < 0 && (m & 0x100f) === 0x100f) STRAIGHT_HI[m] = 3; // wheel A2345
}
function topBits(mask, n) {
  let v = 0;
  let k = 0;
  for (let r = 12; r >= 0 && k < n; r--) {
    if (mask & (1 << r)) {
      v = (v << 4) | r;
      k++;
    }
  }
  while (k < n) {
    v <<= 4;
    k++;
  }
  return v;
}
const CNT = new Uint8Array(13);
const SM = new Int32Array(4);
const SC = new Uint8Array(4);

/** Value of the best 5 of `len` cards in `arr` (5 to 7). */
export function evalCards(arr, len = arr.length) {
  CNT.fill(0);
  SM[0] = SM[1] = SM[2] = SM[3] = 0;
  SC[0] = SC[1] = SC[2] = SC[3] = 0;
  let rm = 0;
  for (let i = 0; i < len; i++) {
    const c = arr[i];
    const r = c >> 2;
    const s = c & 3;
    CNT[r]++;
    SM[s] |= 1 << r;
    SC[s]++;
    rm |= 1 << r;
  }
  let fs = -1;
  for (let s = 0; s < 4; s++)
    if (SC[s] >= 5) {
      fs = s;
      break;
    }
  if (fs >= 0) {
    const st = STRAIGHT_HI[SM[fs]];
    if (st >= 0) return (8 << 20) | st;
  }
  let q = -1;
  let t1 = -1;
  let t2 = -1;
  let p1 = -1;
  let p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = CNT[r];
    if (k === 4) q = r;
    else if (k === 3) {
      if (t1 < 0) t1 = r;
      else if (t2 < 0) t2 = r;
    } else if (k === 2) {
      if (p1 < 0) p1 = r;
      else if (p2 < 0) p2 = r;
    }
  }
  if (q >= 0) return (7 << 20) | (q << 4) | topBits(rm & ~(1 << q), 1);
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return (6 << 20) | (t1 << 4) | Math.max(t2, p1);
  if (fs >= 0) return (5 << 20) | topBits(SM[fs], 5);
  const st = STRAIGHT_HI[rm];
  if (st >= 0) return (4 << 20) | st;
  if (t1 >= 0) return (3 << 20) | (t1 << 8) | topBits(rm & ~(1 << t1), 2);
  if (p1 >= 0 && p2 >= 0)
    return (2 << 20) | (p1 << 8) | (p2 << 4) | topBits(rm & ~(1 << p1) & ~(1 << p2), 1);
  if (p1 >= 0) return (1 << 20) | (p1 << 12) | topBits(rm & ~(1 << p1), 3);
  return topBits(rm, 5);
}
export const category = (v) => v >> 20;

// ---- combos ----------------------------------------------------------------------------------
export const NC = 1326;
export const COMBO_A = new Int8Array(NC);
export const COMBO_B = new Int8Array(NC);
const COMBO_IX = new Int16Array(52 * 52).fill(-1);
{
  let k = 0;
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++) {
      COMBO_A[k] = a;
      COMBO_B[k] = b;
      COMBO_IX[a * 52 + b] = k;
      COMBO_IX[b * 52 + a] = k;
      k++;
    }
}
export function comboIndex(a, b) {
  return COMBO_IX[a * 52 + b];
}
/** 169-class index: pairs 0..12 (22..AA), then suited / offsuit by (hi, lo). */
export function classOf(a, b) {
  const ra = a >> 2;
  const rb = b >> 2;
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  if (hi === lo) return hi;
  const suited = (a & 3) === (b & 3);
  const k = 13 + ((hi * (hi - 1)) / 2 + lo) * 2 + (suited ? 0 : 1);
  return k;
}
export const COMBO_CLASS = new Int16Array(NC);
for (let k = 0; k < NC; k++) COMBO_CLASS[k] = classOf(COMBO_A[k], COMBO_B[k]);
export function className(k) {
  if (k < 13) return RANK_CHARS[k] + RANK_CHARS[k];
  const j = k - 13;
  const idx = j >> 1;
  let hi = 1;
  while (((hi + 1) * hi) / 2 <= idx) hi++;
  const lo = idx - (hi * (hi - 1)) / 2;
  return RANK_CHARS[hi] + RANK_CHARS[lo] + (j & 1 ? 'o' : 's');
}

// ---- deterministic RNG -------------------------------------------------------------------------
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- street tables: every combo's value on every runout -----------------------------------------
/**
 * For a 3-, 4- or 5-card board: every runout to the river (exact enumeration) and the value of every combo on it
 * (-1 when the combo shares a card with the board or runout). Returns { runouts: Int8Array pairs, n, vals }.
 */
export function streetTable(board) {
  const used = new Uint8Array(52);
  for (const c of board) used[c] = 1;
  const rest = [];
  for (let c = 0; c < 52; c++) if (!used[c]) rest.push(c);
  const need = 5 - board.length;
  const runs = [];
  if (need === 0) runs.push([]);
  else if (need === 1) for (const c of rest) runs.push([c]);
  else if (need === 2)
    for (let i = 0; i < rest.length; i++)
      for (let j = i + 1; j < rest.length; j++) runs.push([rest[i], rest[j]]);
  else throw new Error('streetTable needs a flop, turn or river board');
  const n = runs.length;
  const vals = new Int32Array(n * NC).fill(-1);
  const cards = new Int8Array(7);
  for (let i = 0; i < board.length; i++) cards[i] = board[i];
  const runMask = [];
  for (let r = 0; r < n; r++) {
    const run = runs[r];
    for (let i = 0; i < run.length; i++) cards[board.length + i] = run[i];
    const rmk = new Uint8Array(52);
    for (const c of run) rmk[c] = 1;
    runMask.push(rmk);
    const base = r * NC;
    for (let k = 0; k < NC; k++) {
      const a = COMBO_A[k];
      const b = COMBO_B[k];
      if (used[a] || used[b] || rmk[a] || rmk[b]) continue;
      cards[5] = a;
      cards[6] = b;
      vals[base + k] = evalCards(cards, 7);
    }
  }
  return { board: [...board], runs, n, vals };
}

/** Strength of every combo: its mean percentile against all other live combos over the runouts (0..1). */
export function strengthVector(table) {
  const { n, vals } = table;
  const sum = new Float64Array(NC);
  const cnt = new Float64Array(NC);
  const idx = new Int32Array(NC);
  for (let r = 0; r < n; r++) {
    const base = r * NC;
    let m = 0;
    for (let k = 0; k < NC; k++) if (vals[base + k] >= 0) idx[m++] = k;
    const sub = Array.from(idx.subarray(0, m));
    sub.sort((x, y) => vals[base + x] - vals[base + y]);
    let i = 0;
    while (i < m) {
      let j = i;
      const v = vals[base + sub[i]];
      while (j + 1 < m && vals[base + sub[j + 1]] === v) j++;
      const pct = m > 1 ? (i + j) / 2 / (m - 1) : 0.5;
      for (let t = i; t <= j; t++) {
        sum[sub[t]] += pct;
        cnt[sub[t]] += 1;
      }
      i = j + 1;
    }
  }
  const s = new Float64Array(NC);
  for (let k = 0; k < NC; k++) s[k] = cnt[k] ? sum[k] / cnt[k] : 0;
  return s;
}

/** Hero combo h against every combo: share of the runouts (valid for both) h wins, ties half. NaN when impossible. */
export function equityVector(table, h) {
  const { n, vals } = table;
  const a = COMBO_A[h];
  const b = COMBO_B[h];
  const w = new Float64Array(NC);
  const c = new Float64Array(NC);
  for (let r = 0; r < n; r++) {
    const base = r * NC;
    const vh = vals[base + h];
    if (vh < 0) continue;
    for (let k = 0; k < NC; k++) {
      const v = vals[base + k];
      if (v < 0) continue;
      c[k] += 1;
      if (vh > v) w[k] += 1;
      else if (vh === v) w[k] += 0.5;
    }
  }
  const e = new Float64Array(NC).fill(NaN);
  for (let k = 0; k < NC; k++) {
    const ck = COMBO_A[k];
    const dk = COMBO_B[k];
    if (ck === a || ck === b || dk === a || dk === b) continue;
    if (c[k] > 0) e[k] = w[k] / c[k];
  }
  return e;
}

/** Exact equities of fully known hands on a partial board (0, 3, 4 or 5 cards); ties split. */
export function exactEquity(hands, board) {
  const used = new Uint8Array(52);
  for (const c of board) used[c] = 1;
  for (const h of hands)
    for (const c of h) {
      if (used[c]) throw new Error('duplicate card');
      used[c] = 1;
    }
  const rest = [];
  for (let c = 0; c < 52; c++) if (!used[c]) rest.push(c);
  const need = 5 - board.length;
  const eq = new Float64Array(hands.length);
  const cards = new Int8Array(7);
  const vals = new Int32Array(hands.length);
  let total = 0;
  const run = new Int8Array(5);
  const score = () => {
    let best = -1;
    let nb = 0;
    for (let i = 0; i < hands.length; i++) {
      for (let j = 0; j < board.length; j++) cards[j] = board[j];
      for (let j = 0; j < need; j++) cards[board.length + j] = run[j];
      cards[5] = hands[i][0];
      cards[6] = hands[i][1];
      const v = evalCards(cards, 7);
      vals[i] = v;
      if (v > best) {
        best = v;
        nb = 1;
      } else if (v === best) nb++;
    }
    for (let i = 0; i < hands.length; i++) if (vals[i] === best) eq[i] += 1 / nb;
    total++;
  };
  const rec = (start, depth) => {
    if (depth === need) {
      score();
      return;
    }
    for (let i = start; i < rest.length; i++) {
      run[depth] = rest[i];
      rec(i + 1, depth + 1);
    }
  };
  rec(0, 0);
  for (let i = 0; i < eq.length; i++) eq[i] /= total;
  return Array.from(eq);
}

// ---- preflop class matrix (Monte Carlo, cached) ---------------------------------------------------
const CLASS_COMBOS = Array.from({ length: 169 }, () => []);
for (let k = 0; k < NC; k++) CLASS_COMBOS[COMBO_CLASS[k]].push(k);
export const CLASS_WEIGHT = CLASS_COMBOS.map((l) => l.length);

/**
 * matrix[i*169+j] = equity of class i against class j preflop, by Monte Carlo with `samples` boards per pair
 * (random disjoint concrete combos, fixed seed). Cached as JSON under `cacheDir` when given.
 */
export function preflopMatrix({ samples = 1500, seed = 20261124, cacheDir = null } = {}) {
  const file = cacheDir ? join(cacheDir, `holdem-preflop-matrix-${samples}-${seed}.json`) : null;
  if (file && existsSync(file)) {
    try {
      const arr = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(arr) && arr.length === 169 * 169) return Float64Array.from(arr);
    } catch {
      /* rebuild */
    }
  }
  const R = rng(seed);
  const M = new Float64Array(169 * 169);
  const cards = new Int8Array(7);
  const used = new Uint8Array(52);
  for (let i = 0; i < 169; i++) {
    M[i * 169 + i] = 0.5;
    for (let j = i + 1; j < 169; j++) {
      let w = 0;
      let done = 0;
      const ci = CLASS_COMBOS[i];
      const cj = CLASS_COMBOS[j];
      for (let t = 0; t < samples * 3 && done < samples; t++) {
        const hi = ci[(R() * ci.length) | 0];
        const hj = cj[(R() * cj.length) | 0];
        const a = COMBO_A[hi];
        const b = COMBO_B[hi];
        const c = COMBO_A[hj];
        const d = COMBO_B[hj];
        if (a === c || a === d || b === c || b === d) continue;
        used.fill(0);
        used[a] = used[b] = used[c] = used[d] = 1;
        let m = 0;
        while (m < 5) {
          const x = (R() * 52) | 0;
          if (used[x]) continue;
          used[x] = 1;
          cards[m++] = x;
        }
        cards[5] = a;
        cards[6] = b;
        const v1 = evalCards(cards, 7);
        cards[5] = c;
        cards[6] = d;
        const v2 = evalCards(cards, 7);
        w += v1 > v2 ? 1 : v1 === v2 ? 0.5 : 0;
        done++;
      }
      const e = done ? w / done : 0.5;
      M[i * 169 + j] = e;
      M[j * 169 + i] = 1 - e;
    }
  }
  if (file) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify(Array.from(M, (x) => Math.round(x * 1e5) / 1e5)));
    } catch {
      /* cache is optional */
    }
  }
  return M;
}

/** Preflop strength of every combo: its class's equity against a random hand (combo-weighted). */
export function preflopStrength(M) {
  const cls = new Float64Array(169);
  const tot = CLASS_WEIGHT.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 169; i++) {
    let s = 0;
    for (let j = 0; j < 169; j++) s += M[i * 169 + j] * CLASS_WEIGHT[j];
    cls[i] = s / tot;
  }
  const s = new Float64Array(NC);
  for (let k = 0; k < NC; k++) s[k] = cls[COMBO_CLASS[k]];
  return s;
}

/** Hero combo against every combo preflop, from the class matrix (card removal: impossible combos NaN). */
export function preflopEquityVector(M, h) {
  const a = COMBO_A[h];
  const b = COMBO_B[h];
  const ch = COMBO_CLASS[h];
  const e = new Float64Array(NC).fill(NaN);
  for (let k = 0; k < NC; k++) {
    const c = COMBO_A[k];
    const d = COMBO_B[k];
    if (c === a || c === b || d === a || d === b) continue;
    e[k] = M[ch * 169 + COMBO_CLASS[k]];
  }
  return e;
}

// ---- weighted ranges --------------------------------------------------------------------------------
export function fullRange() {
  return new Float64Array(NC).fill(1);
}
/** Zero every combo that uses a dead card. */
export function removeDead(range, dead) {
  const r = Float64Array.from(range);
  const d = new Uint8Array(52);
  for (const c of dead) if (c >= 0) d[c] = 1;
  for (let k = 0; k < NC; k++) if (d[COMBO_A[k]] || d[COMBO_B[k]]) r[k] = 0;
  return r;
}
function orderByStrength(range, strength) {
  const ix = [];
  for (let k = 0; k < NC; k++) if (range[k] > 0) ix.push(k);
  ix.sort((x, y) => strength[y] - strength[x] || x - y);
  return ix;
}
/**
 * Keep the parts of the range whose weighted position from the top (0 = strongest) lies in any of `bands`
 * ([lo, hi] fractions of the range's weight). Boundary combos keep the overlapping share of their weight.
 */
export function keepBands(range, strength, bands, floor = 0) {
  const ix = orderByStrength(range, strength);
  let tot = 0;
  for (const k of ix) tot += range[k];
  const out = new Float64Array(NC);
  if (tot <= 0) return out;
  let acc = 0;
  for (const k of ix) {
    const w = range[k];
    const lo = acc / tot;
    const hi = (acc + w) / tot;
    acc += w;
    let keep = 0;
    for (const [bl, bh] of bands) {
      const ov = Math.min(hi, bh) - Math.max(lo, bl);
      if (ov > 0) keep += ov / (hi - lo || 1);
    }
    const kk = Math.min(1, keep);
    const x = kk + floor * (1 - kk);
    if (x > 0) out[k] = w * x;
  }
  return out;
}
export const keepTop = (range, strength, q) => keepBands(range, strength, [[0, clamp01(q)]]);
/**
 * Multiway equity from heads-up equities e_i against each opponent: hero's share = prod(e) / (prod(e) +
 * sum_j (1 - e_j) x 0.5^(k-1)) (opponents split evenly among themselves). k = 1 gives e; two coin flips give 1/3.
 */
export function multiwayEquity(eqs) {
  if (!eqs.length) return 1;
  if (eqs.length === 1) return eqs[0];
  let p = 1;
  for (const e of eqs) p *= e;
  let o = 0;
  const h = Math.pow(0.5, eqs.length - 1);
  for (const e of eqs) o += (1 - e) * h;
  return p + o > 0 ? p / (p + o) : 0;
}
export function clamp01(x) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}
export function rangeWeight(range) {
  let t = 0;
  for (let k = 0; k < NC; k++) t += range[k];
  return t;
}
/** Weighted equity of an equity vector against a range (NaN combos skipped). */
export function equityVsRange(eqVec, range) {
  let w = 0;
  let s = 0;
  for (let k = 0; k < NC; k++) {
    const x = range[k];
    if (x <= 0) continue;
    const e = eqVec[k];
    if (Number.isNaN(e)) continue;
    w += x;
    s += x * e;
  }
  return w > 0 ? s / w : NaN;
}

// ---- made-hand class and draws (for mistake typing only) -----------------------------------------------
/** Made-hand class of two hole cards on a 3-5 card board, judged by what the hole cards add. */
export function handClass(hole, board) {
  const all = [...board, ...hole];
  const me = evalCards(all, all.length >= 5 ? all.length : all.length);
  const cat = all.length >= 5 ? me >> 20 : 0;
  const bv = board.length === 5 ? evalCards(board, 5) : -1;
  if (board.length === 5 && me === bv) return 'board';
  const b = board.map((c) => c >> 2);
  const h = hole.map((c) => c >> 2);
  if (cat >= 4) return 'straight+';
  const bc = {};
  for (const r of b) bc[r] = (bc[r] || 0) + 1;
  const sb = [...new Set(b)].sort((x, y) => y - x);
  if (h[0] === h[1]) {
    if (bc[h[0]]) return 'set/trips';
    if (h[0] > sb[0]) return 'overpair';
    return sb.length > 1 && h[0] > sb[1] ? 'second pair' : 'weak pair';
  }
  const hits = h.filter((x) => bc[x]);
  if (hits.some((x) => bc[x] >= 2)) return 'set/trips';
  if (new Set(hits).size === 2) return 'two pair';
  if (hits.length) {
    const x = hits[0];
    if (x === sb[0]) {
      const k = h.find((y) => y !== x);
      return k >= 9 ? 'top pair good kicker' : 'top pair weak kicker';
    }
    if (sb.length > 1 && x === sb[1]) return 'second pair';
    return 'weak pair';
  }
  return h.includes(12) ? 'ace high' : 'no pair';
}
export const ONE_PAIR = new Set([
  'overpair',
  'top pair good kicker',
  'top pair weak kicker',
  'second pair',
  'weak pair',
]);
export const NO_SHOWDOWN = new Set(['no pair', 'ace high', 'board']);

/** Flush draw / open-ended straight draw using at least one hole card (flop or turn). */
export function drawInfo(hole, board) {
  if (board.length >= 5) return { flushDraw: false, oesd: false, outs: 0 };
  const all = [...board, ...hole];
  const sc = [0, 0, 0, 0];
  for (const c of all) sc[c & 3]++;
  const flushDraw = hole.some((c) => sc[c & 3] === 4);
  let mask = 0;
  for (const c of all) mask |= 1 << (c >> 2);
  let hmask = 0;
  for (const c of hole) hmask |= 1 << (c >> 2);
  let oesd = false;
  for (let lo = 0; lo <= 8; lo++) {
    const four = 0xf << lo;
    if ((mask & four) === four && hmask & four && lo >= 1 && lo + 4 <= 12) oesd = true;
  }
  const outs = (flushDraw ? 9 : 0) + (oesd ? (flushDraw ? 6 : 8) : 0);
  return { flushDraw, oesd, outs };
}
