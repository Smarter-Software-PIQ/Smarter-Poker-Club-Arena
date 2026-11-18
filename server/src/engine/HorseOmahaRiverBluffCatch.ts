/**
 * omahaRiverBluffCatchIsPriced (WooWoo audit RIVER-FACING, 2026-11-18, default OFF).
 *
 * A Horse facing a FIRST river bet (not a raise) heads-up, PLO4/PLO5 cash, one
 * board, high only. The call is a bluff-catch: there is no card to come, so
 * there is no realization term; the call is worth
 *
 *   EV = P(beats his holding | he bet, the Horse's cards) x (pot after the call, rake off) - call
 *
 * and P comes from the bettor's RANGE, not from a stated value share and bluff
 * share:
 *
 * 1. RANGE COMPOSITION, MEASURED. For every heads-up river bet a Horse faced in
 *    the 48 h audit window (n 269 first bets, A/repairs/RIVER-FACING/raw/
 *    u-rows.jsonl sha256 5ef47bd3...), the bettor's actual holding was placed
 *    on the strength scale u = the share of all holdings on that board that
 *    beat it (0 = the nuts). OMAHA_RIVER_BETTOR_ROWS keeps those (bin of u,
 *    pot share) pairs; nothing else (no cards, no ids, no account). The bet's
 *    pot share enters ONLY as the point at which that measured distribution is
 *    read (Gaussian kernel in log pot share, bandwidth by Silverman's rule on
 *    the same rows); no threshold is keyed to size.
 * 2. BLOCKERS. The measured mass of each u-bin is a mass over ALL holdings. Given
 *    the Horse's cards, the holdings he can hold in bin b are the share p_b of
 *    the holdings left (sampled without the Horse's and the board's cards)
 *    against the share r_b of bin b among all holdings: bin b's weight is
 *    pi_b x p_b / r_b. A Horse holding the nut blockers removes value holdings
 *    and the weight moves to the bluffs, and the other way round.
 * 3. THE PLAYER. His measured tendency (omahaEvBluffShare over the population
 *    prior, the existing read: his bet rate beside his kind's, his shown-down
 *    bets) multiplies the weight of the holdings that lose to the median
 *    holding (u >= 0.5: not a value bet by any definition), by k = q_read / q_prior.
 * 4. CLOSE CALLS ARE MIXED. SE = Dirichlet (effective n of the kernel) on the
 *    bin masses + sampling of the within-bin win rates, delta method. Outside
 *    2 SE of the margin the sign decides; inside, the call is made with
 *    probability Phi((EV - margin) / SE) on a draw from PUBLIC state only.
 */
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { omahaShownPhi } from './HorseOmahaFacingBetEvShownField.js';

/** u-bin edges (share of holdings that beat the bettor's holding). */
export const OMAHA_RIVER_U_EDGES: readonly number[] = [
  0, 0.01, 0.03, 0.06, 0.1, 0.2, 0.35, 0.5, 0.7, 1,
];
/** First bin whose holdings lose to the median holding (u >= 0.5). */
export const OMAHA_RIVER_NON_VALUE_BIN = 7;
/**
 * Measured rows "bin:potShare%" (A/repairs/RIVER-FACING/raw/u-rows.jsonl,
 * sha256 5ef47bd379f0ef52fe0622659d5cc863d9adb58daa2a049fd55155e7e3b142cf,
 * raises excluded; reference pool 3,000 holdings per row).
 */
export const OMAHA_RIVER_BETTOR_ROWS =
  '4:3 5:4 2:4 7:20 6:28 4:33 5:33 5:33 6:33 3:33 6:33 5:33 4:33 4:33 5:33 5:33 5:33 5:33 5:33 4:33 5:33 5:33 4:34 5:34 6:34 0:35 5:36 4:36 6:41 4:41 5:42 5:44 5:45 2:45 1:49 4:50 6:50 3:50 4:50 5:50 2:50 2:50 5:50 8:50 2:50 0:50 4:50 8:50 6:50 5:50 8:50 4:50 0:50 8:50 0:50 3:50 5:50 4:50 5:50 1:50 2:50 8:50 2:50 6:50 4:50 6:50 8:50 4:50 5:50 8:50 4:50 2:50 1:50 5:50 4:50 5:50 2:50 5:51 5:51 3:51 7:51 3:52 4:52 5:53 2:54 2:57 3:57 4:59 6:59 2:62 3:63 8:63 4:65 8:66 3:66 2:66 4:66 4:66 1:66 3:66 5:67 4:67 3:67 1:68 2:68 4:69 1:70 4:71 6:73 8:74 8:74 7:75 4:75 8:75 3:75 4:75 2:75 4:75 8:75 8:75 8:75 2:75 2:75 5:75 4:75 2:75 8:75 4:75 2:75 2:75 4:75 7:75 2:75 8:75 7:75 2:75 8:75 8:75 0:75 3:75 6:75 2:75 6:75 5:75 0:75 0:75 8:75 4:76 2:76 6:76 0:76 7:76 0:78 3:78 4:79 4:79 3:79 4:80 2:81 2:81 6:81 2:81 8:81 3:81 3:82 3:82 3:83 4:83 4:83 1:83 2:84 4:84 4:85 4:86 6:87 3:98 1:99 2:100 3:100 5:100 3:100 3:100 0:100 2:100 8:100 0:100 1:100 2:100 2:100 4:100 4:100 0:100 4:100 0:100 4:100 0:100 2:100 4:100 8:100 0:100 0:100 4:100 3:100 4:100 1:100 5:100 4:100 2:100 4:100 2:100 0:100 2:100 5:100 5:100 6:100 0:100 2:100 6:100 5:100 2:100 1:100 5:100 3:100 8:100 0:100 2:100 4:100 4:100 4:100 5:100 2:100 2:100 4:100 3:100 6:100 4:100 2:100 3:100 8:100 8:100 8:100 2:100 4:100 0:100 3:100 6:100 4:100 1:100 1:100 2:100 7:100 4:100 1:100 3:100 0:100 1:100 3:100 8:100 2:100 0:100 5:100 1:100 4:100 4:100 3:100 0:100 2:100 5:100 0:100';
export const OMAHA_RIVER_BETTOR_ROWS_SHA256 =
  '5ef47bd379f0ef52fe0622659d5cc863d9adb58daa2a049fd55155e7e3b142cf';
/** Dirichlet prior per bin (Jeffreys). */
export const OMAHA_RIVER_DIRICHLET_PRIOR = 0.5;
/** Holdings drawn for the reference scale and for the Horse-conditioned pool. */
export const OMAHA_RIVER_REF_POOL = 800;
export const OMAHA_RIVER_POOL = 1200;
/** The band, in standard errors, inside which the call is mixed (same as the C3 field rule). */
export const OMAHA_RIVER_BAND_SE = 2;

export interface OmahaRiverRow {
  bin: number;
  potFrac: number;
}
export function omahaRiverParseRows(enc: string): OmahaRiverRow[] {
  return enc
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const [b, p] = t.split(':');
      return { bin: Number(b), potFrac: Number(p) / 100 };
    })
    .filter(
      (r) =>
        Number.isInteger(r.bin) &&
        r.bin >= 0 &&
        r.bin < OMAHA_RIVER_U_EDGES.length - 1 &&
        r.potFrac > 0
    );
}
let defaultRows: OmahaRiverRow[] | null = null;
const rowsOrDefault = (rows?: readonly OmahaRiverRow[]): readonly OmahaRiverRow[] =>
  rows ?? (defaultRows ??= omahaRiverParseRows(OMAHA_RIVER_BETTOR_ROWS));

export interface OmahaRiverBins {
  /** posterior mean mass per u-bin at this pot share */
  pi: number[];
  /** kernel effective sample size */
  nEff: number;
}
/** The measured bin masses read at this pot share (Gaussian kernel in log pot share, Silverman bandwidth). */
export function omahaRiverBettorBins(
  potFrac: number,
  rows?: readonly OmahaRiverRow[]
): OmahaRiverBins {
  const R = rowsOrDefault(rows);
  const K = OMAHA_RIVER_U_EDGES.length - 1;
  const xs = R.map((r) => Math.log(r.potFrac));
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  const h = Math.max(1e-3, 1.06 * sd * Math.max(1, xs.length) ** -0.2);
  const x0 = Math.log(Math.max(0.01, Number.isFinite(potFrac) ? potFrac : 1));
  const c = new Array<number>(K).fill(0);
  let sw = 0;
  let sw2 = 0;
  R.forEach((r, i) => {
    const w = Math.exp(-0.5 * ((xs[i] - x0) / h) ** 2);
    c[r.bin] += w;
    sw += w;
    sw2 += w * w;
  });
  const nEff = sw2 > 0 ? (sw * sw) / sw2 : 0;
  // counts rescaled to the effective n, then the Jeffreys prior
  const scale = sw > 0 ? nEff / sw : 0;
  const a = c.map((x) => x * scale + OMAHA_RIVER_DIRICHLET_PRIOR);
  const A = a.reduce((s, x) => s + x, 0);
  return { pi: a.map((x) => x / A), nEff };
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
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
function seedOf(groups: Card[][]): number {
  let h = 0x811c9dc5;
  for (const g of groups) {
    for (const k of g.map(key).sort())
      for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 124, 0x01000193);
  }
  return h >>> 0 || 1;
}
function sampleScores(
  deck: Card[],
  n: number,
  count: number,
  board: Card[],
  rnd: () => number,
  each?: (h: Card[], s: number) => void
): Float64Array {
  const m = deck.length;
  const idx = new Int32Array(m);
  const out = new Float64Array(count);
  const h: Card[] = new Array<Card>(n);
  for (let p = 0; p < count; p++) {
    for (let i = 0; i < m; i++) idx[i] = i;
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(rnd() * (m - k));
      const t = idx[k];
      idx[k] = idx[j];
      idx[j] = t;
      h[k] = deck[idx[k]];
    }
    out[p] = scoreOmahaHiPartial(h, board);
    each?.(h, out[p]);
  }
  return out;
}
/** u of a score on the sorted (descending) reference scale: share above + half the ties. */
function uOf(refDesc: Float64Array, s: number): number {
  let lo = 0;
  let hi = refDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (refDesc[mid] > s) lo = mid + 1;
    else hi = mid;
  }
  let eq = lo;
  while (eq < refDesc.length && refDesc[eq] === s) eq++;
  return (lo + 0.5 * (eq - lo)) / refDesc.length;
}
function binOf(u: number): number {
  const E = OMAHA_RIVER_U_EDGES;
  for (let b = E.length - 2; b >= 0; b--) if (u >= E[b]) return b;
  return 0;
}

export interface OmahaRiverPool {
  /** p_b: share of the Horse-conditioned holdings in bin b; r_b: share of all holdings in bin b */
  p: number[];
  r: number[];
  /** win credit (1 win, 0.5 tie) of the Horse against the conditioned holdings in bin b, and their count */
  win: number[];
  count: number[];
}
let poolMemo: { k: string; v: OmahaRiverPool | null } | null = null;
/** The bin shares and the Horse's win credit per bin (deterministic: seeds are the cards). */
export function omahaRiverPool(
  hole: Card[],
  board: Card[],
  dead: Card[] = []
): OmahaRiverPool | null {
  if (!Array.isArray(hole) || (hole.length !== 4 && hole.length !== 5)) return null;
  if (!Array.isArray(board) || board.length !== 5) return null;
  const n = hole.length;
  const all = [...hole, ...board, ...(dead ?? [])];
  if (new Set([...hole, ...board].map(key)).size !== n + 5) return null;
  const mk = [hole, board, dead ?? []].map((g) => g.map(key).sort().join(',')).join('|');
  if (poolMemo && poolMemo.k === mk) return poolMemo.v;
  const boardSet = new Set(board.map(key));
  const refDeck: Card[] = [];
  const deck: Card[] = [];
  const gone = new Set(all.map(key));
  for (const s of SUITS)
    for (const r of RANKS) {
      const c = { rank: r, suit: s } as Card;
      if (!boardSet.has(key(c))) refDeck.push(c);
      if (!gone.has(key(c))) deck.push(c);
    }
  const ref = Array.from(
    sampleScores(refDeck, n, OMAHA_RIVER_REF_POOL, board, stream(seedOf([board])))
  ).sort((a, b) => b - a);
  const refDesc = Float64Array.from(ref);
  const K = OMAHA_RIVER_U_EDGES.length - 1;
  const r = new Array<number>(K).fill(0);
  for (const s of ref) r[binOf(uOf(refDesc, s))] += 1 / ref.length;
  const hero = scoreOmahaHiPartial(hole, board);
  const count = new Array<number>(K).fill(0);
  const credit = new Array<number>(K).fill(0);
  sampleScores(
    deck,
    n,
    OMAHA_RIVER_POOL,
    board,
    stream(seedOf([hole, board, dead ?? []])),
    (_h, s) => {
      const b = binOf(uOf(refDesc, s));
      count[b]++;
      credit[b] += hero > s ? 1 : hero === s ? 0.5 : 0;
    }
  );
  const v: OmahaRiverPool = {
    p: count.map((x) => x / OMAHA_RIVER_POOL),
    r,
    win: credit.map((x, b) => (count[b] > 0 ? x / count[b] : 0)),
    count,
  };
  poolMemo = { k: mk, v };
  return v;
}

export interface OmahaRiverBluffCatchInput {
  potFrac: number;
  paid: number;
  winnable: number;
  rake: number;
  margin: number;
  /** his measured bluff tendency over the population prior (omahaEvBluffShare / prior); 1 = the population */
  readFactor: number;
  /** a number in [0, 1) drawn from PUBLIC state only */
  mixUnit: number;
  /** the measured rows (tests and the cross-fitted evaluation); default the table above */
  rows?: readonly OmahaRiverRow[];
}
export interface OmahaRiverBluffCatchVerdict {
  call: boolean;
  ev: number;
  se: number;
  pCall: number;
  mixed: boolean;
  /** the Horse's share of the pot against the bettor's range (win + half ties) */
  equity: number;
  /** the weight on holdings that lose to the median holding, after blockers and the read */
  nonValueWeight: number;
  nEff: number;
}

export function omahaRiverBluffCatchVerdict(
  hole: Card[],
  board: Card[],
  dead: Card[],
  x: OmahaRiverBluffCatchInput
): OmahaRiverBluffCatchVerdict | null {
  if (!(x.paid > 0) || !(x.winnable > 0)) return null;
  const pool = omahaRiverPool(hole, board, dead);
  if (!pool) return null;
  const bins = omahaRiverBettorBins(x.potFrac, x.rows);
  const k = Math.max(0, Number.isFinite(x.readFactor) ? x.readFactor : 1);
  const K = bins.pi.length;
  const g = new Array<number>(K).fill(0); // weight per unit pi
  for (let b = 0; b < K; b++)
    g[b] =
      pool.count[b] > 0 && pool.r[b] > 0
        ? (pool.p[b] / pool.r[b]) * (b >= OMAHA_RIVER_NON_VALUE_BIN ? k : 1)
        : 0;
  let Z = 0;
  let num = 0;
  for (let b = 0; b < K; b++) {
    Z += bins.pi[b] * g[b];
    num += bins.pi[b] * g[b] * pool.win[b];
  }
  if (!(Z > 0)) return null;
  const eq = num / Z;
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(x.rake) ? x.rake : 0));
  const T = x.winnable * (1 - rake) + x.paid;
  const ev = eq * T - x.paid;
  // delta method: Dirichlet covariance of pi (concentration nEff + K * prior) and within-bin sampling
  const conc = bins.nEff + K * OMAHA_RIVER_DIRICHLET_PRIOR;
  const grad = g.map((gb, b) => (gb * (pool.win[b] - eq)) / Z);
  let varPi = 0;
  for (let i = 0; i < K; i++)
    for (let j = 0; j < K; j++) {
      const cov = ((i === j ? bins.pi[i] : 0) - bins.pi[i] * bins.pi[j]) / (conc + 1);
      varPi += grad[i] * grad[j] * cov;
    }
  let varW = 0;
  for (let b = 0; b < K; b++) {
    if (pool.count[b] <= 0) continue;
    const wgt = (bins.pi[b] * g[b]) / Z;
    varW += (wgt * wgt * pool.win[b] * (1 - pool.win[b])) / pool.count[b];
  }
  const se = T * Math.sqrt(Math.max(0, varPi) + varW);
  const edge = ev - x.margin;
  let pCall: number;
  let mixed = false;
  if (!(se > 0) || Math.abs(edge) > OMAHA_RIVER_BAND_SE * se) pCall = edge > 0 ? 1 : 0;
  else {
    pCall = omahaShownPhi(edge / se);
    mixed = true;
  }
  const u = Number.isFinite(x.mixUnit) ? Math.max(0, Math.min(0.999999, x.mixUnit)) : 0.5;
  let nonValue = 0;
  for (let b = OMAHA_RIVER_NON_VALUE_BIN; b < K; b++) nonValue += (bins.pi[b] * g[b]) / Z;
  return {
    call: u < pCall,
    ev,
    se,
    pCall,
    mixed,
    equity: eq,
    nonValueWeight: nonValue,
    nEff: bins.nEff,
  };
}

/** Salt of the mixing draw (distinct from the C3 field rule's and OMAHA_PRICED_MIX_SALT). */
export const OMAHA_RIVER_MIX_SALT = 0x2b1ca7;
/** The mixing draw from the decision's PUBLIC spot key only (never the Horse's cards). */
export function omahaRiverBluffCatchMixUnit(publicKey: string): number {
  let h = (0x811c9dc5 ^ OMAHA_RIVER_MIX_SALT) >>> 0;
  const k = String(publicKey ?? '');
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
