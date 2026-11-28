/**
 * THE HEADS-UP RIVER OPENING BET IS PRICED ON HIS RANGE (PLO-OWNER lead-7 lane plo-postflop, 2026-11-26).
 * Two options, each default OFF (read `=== true`), switchable live, scopable per game (horse.omahaGameScope):
 *
 *  omahaRiverValueBetInPositionIsPriced   the opponent checked the river to the Horse heads-up: a final CHECK becomes
 *     the best-priced bet when that bet is a value bet (the Horse beats more than half of the hands that call it) and
 *     it is worth more than the check by more than the error of his fold rate.
 *  omahaRiverBluffIsPricedOnBlockers      the same spot, or the Horse first to act on the river heads-up: a final
 *     CHECK with a hand that has no value bet becomes the best-priced bet only when BOTH (math) the bet is worth more
 *     than the check by more than that error, with his fold rate read AFTER the Horse's own cards are removed from his
 *     range, AND (blockers) the Horse's cards take more of his continuing hands than of his folding hands (his fold
 *     share given the Horse's cards is above his fold share without them).
 *
 * HIS RANGE. The measured strength histogram of the cell (HorseOmahaRiverOpeningRangeTables.json, fit by
 * scripts/ops/omaha-river-opening-range-fit.mjs from shown hands only, showdown bias corrected): after he checked the
 * river heads-up (`checkfirst`), or, when the Horse acts first, the in-position player's river range (`ipstart`), each
 * split by whether the turn had a wager. Strength is the share of holdings that beat his hand (0 = the nuts).
 * PEOPLE ONLY (owner order 2026-11-26 12:21 PM Chicago): `cells` and `rates` are fit on people's shown hands and
 * people's own river actions only (no Horse hand, no unshown card), each game cell shrunk to a random holding; the
 * table's `heroCells` (the Horses' own hands) are never read here.
 * CARD REMOVAL is exact: the strength bins are cut on the board's own holdings (the cards he cannot see: the deck less
 * the board), and each bin's weight is moved by the share of its holdings the Horse's cards (and the known dead
 * cards) leave him: that is what a blocker is. The Horse's win and tie shares in every bin are exact counts.
 *
 * HIS FOLD RATE. Prior = equilibrium: against a bet B into P a defender continues with P / (P + B) of his range (the
 * minimum defence), so he folds B / (P + B). His own lifetime public river fold record (OPPONENT-HUD x.foldToBet,
 * small and big cells; HorseMind.omahaStrongHandCheckRecordsOf) moves it by m = (F + k g) / (E + k g): F his folds,
 * E the folds the equilibrium expects on the sizes he faced (1/3 at small, 1/2 at big), k = 75.9 river answers (the
 * measured between-player prior of HorseOmahaStrongHandCheck), g = 0.4. He folds the WEAKEST share of his range;
 * which hands those are is his strategy (it cannot see the Horse's cards); the share that actually folds given the
 * Horse's cards is read on the card-removed range.
 * THE BLUFF'S FOLD RATE (2026-11-26 lane plo-bluffs; owner order: the stats are used against people, not Horses): for
 * omahaRiverBluffIsPricedOnBlockers his fold is read size by size in the order his own record -> people's population
 * (answers by PEOPLE only to heads-up river first wagers, by game, the Horse's line and the size cell; Horse answers
 * never enter it; HorseOmahaPeopleFold.ts) -> equilibrium where both are thin, each shrunk to the next by k = 75.9.
 * The value bet keeps equilibrium moved by his record. The blocker leg is read on every size that clears its margin
 * (the best of those is bet), not only on the best size overall: with the equilibrium prior a pure bluff is worth
 * exactly the check, so only a large blocker gain on one size cleared, and the bluff fired once in 254 missed spots.
 *
 *   EV(check) = eq x P x (1 - rake)                       (in position the check ends the hand; first to act it is an
 *                                                           upper bound, so a bluff is never favoured by it)
 *   EV(bet B) = f' x P x (1 - rake) + (1 - f') x (e_c x (P + 2B) x (1 - rake) - B)
 *     f' his fold share given the Horse's cards, e_c the Horse's share against the hands that continue. A raise is
 *     scored as a call the Horse loses (it folds), which is what the Horse's fold to it costs.
 *   margin = his fold rate's binomial error on n + k answers times d EV / d fold.
 *
 * No hand class, no position rule, no fixed percentage, nothing keyed on an account, a name or a person/Horse flag;
 * public actions, the Horse's own cards and the known dead cards only. It changes only a check into a bet; never a
 * raise (owner rule: a hand that is not nut class never raises the turn or river). PLO4/PLO5 cash, high only, one
 * board, no bomb pot, heads-up river only; PLO6, hold'em and tournaments are untouched. Pure: no telemetry, no state,
 * no random draw.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaCardId, scoreOmahaHiPartial } from './HorseEval.js';
import { PairSet, countHoldingsWithout } from './HorseOmahaFacingBetEv.js';
import { omahaCardImpactAmounts, omahaCardImpactScope } from './HorseOmahaCardImpact.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import { OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS } from './HorseOmahaStrongHandCheck.js';
import {
  omahaFoldMultiplierOnPeople,
  omahaPeopleFoldLineOf,
  omahaPeopleFoldMultiplier,
} from './HorseOmahaPeopleFold.js';
import tables from './HorseOmahaRiverOpeningRangeTables.json' with { type: 'json' };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

interface RangeCell {
  hist: number[];
  shown: number;
  n: number;
}
const T = tables as unknown as {
  version: string;
  binEdges: number[];
  cells: Record<string, RangeCell>;
  rates?: Record<string, { n: number; rate: number }>;
};
export const OMAHA_RIVER_OPENING_RANGE_VERSION: string = T.version;
export const OMAHA_RIVER_OPENING_BIN_EDGES: readonly number[] = Object.freeze([...T.binEdges]);
const NB = OMAHA_RIVER_OPENING_BIN_EDGES.length - 1;

/** The measured between-player prior of a river heads-up unopened-wager rate (HorseOmahaStabDefence, river|hu). */
export const OMAHA_RIVER_OPENING_BET_RATE_PRIOR_OPPS = 33;

/**
 * HIS CHECKING RANGE, MOVED BY HIS OWN BET RATE. The measured checker range is the population's: players who bet
 * the river first about half the time, so their checks are capped. A player who rarely bets checks his strong hands
 * too. With the measured river range of the player out of position before he acts (pre), the measured checking range
 * (check) and the measured first-to-act wager rate b, the hands he bets are bet = (pre - (1 - b) check) / b; a player
 * who bets at rate b' (his own lifetime public unopened river wager rate over the population's, shrunk by k = 33
 * answers, times b) checks (pre - b' bet) / (1 - b'). No record: the measured checking range exactly (the same array).
 */
export function omahaRiverOpeningCheckerHist(
  variant: string,
  prev: 'bet' | 'check',
  record: { bets: number; opps: number } | null | undefined
): readonly number[] | null {
  const check = T.cells[`${variant}|checkfirst|${prev}`]?.hist;
  if (!check) return null;
  const pre = T.cells[`${variant}|oopstart|${prev}`]?.hist;
  const bF = T.rates?.[`fta|${variant}`]?.rate;
  const bU = T.rates?.[`unopened|${variant}`]?.rate;
  if (!record || !pre || !fin(bF) || !fin(bU) || !(bF > 0 && bF < 1) || !(bU > 0)) return check;
  if (!fin(record.bets) || !fin(record.opps) || !(record.opps > 0) || record.bets < 0) return check;
  const k = OMAHA_RIVER_OPENING_BET_RATE_PRIOR_OPPS;
  const him = (Math.min(record.bets, record.opps) + k * bU) / (record.opps + k);
  const b2 = clamp((him / bU) * bF, 0, 0.95);
  const bet = pre.map((x, i) => Math.max(0, (x - (1 - bF) * check[i]) / bF));
  const out = pre.map((x, i) => Math.max(0, (x - b2 * bet[i]) / (1 - b2)));
  const s = out.reduce((a, c) => a + c, 0);
  return s > 0 ? out.map((x) => x / s) : check;
}

/**
 * The measured people-only river range of a role cell (bins, strong to weak), or null: `checkfirst` a player after
 * his river check, `ipstart` a player before he acts, each by whether the turn had a wager. Read by the multiway
 * river bluff (HorseOmahaMultiwayRiverBluff.ts) for each opponent; the same frozen arrays the heads-up price reads.
 */
export function omahaRiverOpeningCellHist(
  variant: string,
  role: 'checkfirst' | 'ipstart',
  prev: 'bet' | 'check'
): readonly number[] | null {
  return T.cells[`${variant}|${role}|${prev}`]?.hist ?? null;
}

/** The equilibrium fold expectation the record is read against: small first wagers (<= 0.7 pot) and big ones. */
export const OMAHA_RIVER_OPENING_EQ_FOLD = Object.freeze({ small: 1 / 3, big: 1 / 2, mean: 0.4 });

export type OmahaRiverOpeningPosition = 'ip' | 'oop';
export interface OmahaRiverOpeningSpot {
  opponent: SeatPlayer;
  position: OmahaRiverOpeningPosition;
  cell: string;
}

const WAGERS = new Set(['bet', 'raise', 'all_in']);

/** The spot, or null: PLO4/PLO5 cash heads-up river, nothing to call, he checked to the Horse or nobody has acted. */
export function omahaRiverOpeningSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaRiverOpeningSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(hero, gs)) return null;
    const scope = omahaCardImpactScope(hero, gs);
    if (!scope || scope.street !== 'river') return null;
    const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
    const river = history.filter((a) => String(a.stage) === 'river');
    let position: OmahaRiverOpeningPosition;
    if (scope.heroCloses) {
      if (river.some((a) => WAGERS.has(String(a.action)))) return null;
      position = 'ip';
    } else {
      if (river.length > 0) return null;
      position = 'oop';
    }
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    const turnWager = history.some(
      (a) => String(a.stage) === 'turn' && WAGERS.has(String(a.action))
    );
    const cell = `${variant}|${position === 'ip' ? 'checkfirst' : 'ipstart'}|${turnWager ? 'bet' : 'check'}`;
    if (!T.cells[cell]) return null;
    return { opponent: scope.opponent, position, cell };
  } catch {
    return null;
  }
}

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const RANKS = '23456789TJQKA';
const DECK: Card[] = SUITS.flatMap((s) => [...RANKS].map((r) => ({ rank: r, suit: s }) as Card));
const ck = (c: Card) =>
  `${String(c.rank).toUpperCase().replace('10', 'T')}${String(c.suit).toLowerCase()[0]}`;
const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let o = 1;
  for (let i = 1; i <= k; i++) o = (o * (n - k + i)) / i;
  return Math.round(o);
};

/** Per strength bin: his holdings' share without the Horse's cards (mass0) and with them (mass), and the Horse's
 *  beaten / tied fractions of the bin's card-removed holdings (the beaten ones are its weakest). */
export interface OmahaRiverOpeningBins {
  mass0: number[];
  mass: number[];
  beat: number[];
  tie: number[];
}

/**
 * Exact bin shares on a river board. The bins are cut on the holdings of `n` cards drawn from the deck less the board
 * (his view); `mass` counts the holdings drawn from the deck less the board, the Horse's cards and `dead`.
 */
export function omahaRiverOpeningBins(
  hole: Card[],
  board: Card[],
  dead: Card[]
): OmahaRiverOpeningBins | null {
  if (!Array.isArray(board) || board.length !== 5) return null;
  return omahaOpeningBinsOnBoard(hole, board, dead);
}

/**
 * The same exact bin shares on a turn board (four cards) or a river board (five): strength is the hand NOW on the
 * cards that are out (PLO-OWNER lead-7 lane plo-bluffs 2026-11-26, HorseOmahaOpeningBluff.ts). On five cards it is
 * omahaRiverOpeningBins.
 */
/**
 * The strength bin of one holding of his on this board, from the same cut as omahaOpeningBinsOnBoard (review t3,
 * 2026-11-26): `ids` holds his `n` cards as omahaCardId values from `start`; the bin is the one whose score band holds
 * the holding's best two-card score now (0 the strongest). -1 when a card is not one of the unseen cards.
 */
export interface OmahaOpeningBinClassifier {
  binOfIds?: (ids: ArrayLike<number>, start: number, n: number) => number;
}

export function omahaOpeningBinsOnBoard(
  hole: Card[],
  board: Card[],
  dead: Card[],
  classify?: OmahaOpeningBinClassifier
): OmahaRiverOpeningBins | null {
  if (!Array.isArray(hole) || !Array.isArray(board)) return null;
  if (board.length !== 4 && board.length !== 5) return null;
  const n = hole.length;
  if (n !== 4 && n !== 5) return null;
  const boardKeys = new Set(board.map(ck));
  if (boardKeys.size !== board.length) return null;
  const U = DECK.filter((c) => !boardKeys.has(ck(c)));
  const removed = new Set([...hole, ...(Array.isArray(dead) ? dead : [])].map(ck));
  for (const c of hole) if (boardKeys.has(ck(c))) return null;
  const inV = U.map((c) => !removed.has(ck(c)));
  const m = U.length;
  const V: number[] = [];
  for (let i = 0; i < m; i++) if (inV[i]) V.push(i);
  const mv = V.length;
  if (mv < n + 1) return null;
  const sc = new Float64Array(m * m);
  const two: Card[] = [U[0], U[0]];
  const uniq = new Set<number>();
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++) {
      two[0] = U[i];
      two[1] = U[j];
      const s = scoreOmahaHiPartial(two, board);
      sc[i * m + j] = s;
      uniq.add(s);
    }
  const desc = [...uniq].sort((a, b) => b - a);
  const totU = choose(m, n);
  const totV = choose(mv, n);
  // holdings with every pair at or below t (cW): U side and V side
  const cWU = (t: number): number => {
    const bar = new PairSet(m);
    for (let i = 0; i < m; i++)
      for (let j = i + 1; j < m; j++) if (sc[i * m + j] > t) bar.add(i, j);
    return countHoldingsWithout(m, n, bar);
  };
  const cWV = (t: number, strict = false): number => {
    const bar = new PairSet(mv);
    for (let a = 0; a < mv; a++)
      for (let b = a + 1; b < mv; b++) {
        const s = sc[V[a] * m + V[b]];
        if (strict ? s >= t : s > t) bar.add(a, b);
      }
    return countHoldingsWithout(mv, n, bar);
  };
  // S_U(t) = share of holdings beating score t = 1 - cWU(t) / totU, non-increasing in t; tau_e = max{u : S_U(u) >= e}
  const memo = new Map<number, number>();
  const SU = (idx: number): number => {
    let v = memo.get(idx);
    if (v === undefined) {
      v = 1 - cWU(desc[idx]) / totU;
      memo.set(idx, v);
    }
    return v;
  };
  const edges = OMAHA_RIVER_OPENING_BIN_EDGES;
  // tauIdx[b] for b = 1..NB-1: the first index (strongest score) with S_U >= edge; -1 when none
  const tau: number[] = new Array(NB + 1).fill(NaN);
  tau[0] = Infinity;
  tau[NB] = -Infinity;
  let lo0 = 0;
  for (let b = 1; b < NB; b++) {
    const e = edges[b];
    let lo = lo0;
    let hi = desc.length - 1;
    if (SU(hi) < e) {
      tau[b] = -Infinity;
      continue;
    }
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (SU(mid) >= e) hi = mid;
      else lo = mid + 1;
    }
    tau[b] = desc[lo];
    lo0 = lo;
  }
  if (classify) {
    const uOfId = new Int16Array(64).fill(-1);
    for (let i = 0; i < m; i++) uOfId[omahaCardId(U[i])] = i;
    classify.binOfIds = (ids, start, len) => {
      let best = -Infinity;
      for (let a = start; a < start + len; a++) {
        const ua = uOfId[ids[a] as number];
        if (ua < 0) return -1;
        for (let b = a + 1; b < start + len; b++) {
          const ub = uOfId[ids[b] as number];
          if (ub < 0) return -1;
          const s = ua < ub ? sc[ua * m + ub] : sc[ub * m + ua];
          if (s > best) best = s;
        }
      }
      // bin b holds the holdings whose best score is in (tau[b + 1], tau[b]]
      for (let b = 0; b < NB; b++) if (best > tau[b + 1]) return b;
      return NB - 1;
    };
  }
  const cU = (t: number) => (t === Infinity ? totU : t === -Infinity ? 0 : cWU(t));
  const cV = (t: number) => (t === Infinity ? totV : t === -Infinity ? 0 : cWV(t));
  const sH = scoreOmahaHiPartial(hole, board);
  const below = cWV(sH, true); // holdings strictly weaker than the Horse
  const atOrBelow = cWV(sH, false);
  const mass0: number[] = [];
  const mass: number[] = [];
  const beat: number[] = [];
  const tie: number[] = [];
  for (let b = 0; b < NB; b++) {
    const hiT = tau[b];
    const loT = tau[b + 1];
    const u = cU(hiT) - cU(loT);
    const vHi = cV(hiT);
    const vLo = cV(loT);
    const v = vHi - vLo;
    mass0.push(u / totU);
    mass.push(v / totV);
    if (!(v > 0)) {
      beat.push(0);
      tie.push(0);
      continue;
    }
    const bt = clamp(Math.min(below, vHi) - vLo, 0, v);
    const tt = clamp(Math.min(atOrBelow, vHi) - vLo, 0, v) - bt;
    beat.push(bt / v);
    tie.push(Math.max(0, tt) / v);
  }
  return { mass0, mass, beat, tie };
}

/** His fold multiplier on the equilibrium fold from his record; m = 1 and weight 0 without one. */
export interface OmahaRiverOpeningFoldRecord {
  foldSmall?: { folds: number; opps: number } | null;
  foldBig?: { folds: number; opps: number } | null;
}
export function omahaRiverOpeningFoldMultiplier(
  record: OmahaRiverOpeningFoldRecord | null | undefined
): {
  m: number;
  n: number;
} {
  const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.river;
  const g = OMAHA_RIVER_OPENING_EQ_FOLD.mean;
  let F = 0;
  let E = 0;
  let n = 0;
  const take = (c: { folds: number; opps: number } | null | undefined, eq: number) => {
    if (!c || !fin(c.folds) || !fin(c.opps) || !(c.opps > 0) || c.folds < 0) return;
    F += Math.min(c.folds, c.opps);
    E += c.opps * eq;
    n += c.opps;
  };
  take(record?.foldSmall, OMAHA_RIVER_OPENING_EQ_FOLD.small);
  take(record?.foldBig, OMAHA_RIVER_OPENING_EQ_FOLD.big);
  if (!(n > 0)) return { m: 1, n: 0 };
  const m = (F + k * g) / (E + k * g);
  return fin(m) && m >= 0 ? { m, n } : { m: 1, n: 0 };
}

export interface OmahaRiverOpeningRow {
  amount: number;
  /** his fold share without / with the Horse's cards */
  fold0: number;
  fold: number;
  /** the Horse's share against the hands that continue */
  eqCall: number;
  ev: number;
  margin: number;
}
export interface OmahaRiverOpeningVerdict {
  position: OmahaRiverOpeningPosition;
  eq: number;
  evCheck: number;
  rows: OmahaRiverOpeningRow[];
  /** the best-EV bet that clears its margin, if any */
  best: OmahaRiverOpeningRow | null;
  kind: 'value' | 'bluff' | null;
  blocker: boolean;
  /**
   * The best-EV bluff that clears its margin AND has a positive blocker effect (his fold share given the Horse's
   * cards above his fold share without them), when the best bet is not a value bet; null otherwise. The blocker leg
   * is read on every size that clears, not only on the best one (2026-11-26 lane plo-bluffs reachability fix).
   */
  bluffBest: OmahaRiverOpeningRow | null;
  m: number;
  recordN: number;
}

/**
 * The comparison. `hist` is his unconditional range (bins); `bins` the exact card-removal shares. Pure arithmetic.
 */
export function omahaRiverOpeningPrice(
  hist: readonly number[],
  bins: OmahaRiverOpeningBins,
  pot: number,
  amounts: readonly number[],
  rake: number,
  fold: { m: number; n: number },
  position: OmahaRiverOpeningPosition,
  /** his fold multiplier for a bet of this size, when it depends on the size (people's cell by size); else `fold` */
  foldAt?: (amount: number) => { m: number; n: number }
): OmahaRiverOpeningVerdict | null {
  if (!(pot > 0) || hist.length !== NB) return null;
  const r = fin(rake) ? clamp(rake, 0, 0.2) : 0;
  // bins that hold holdings on this board; the histogram renormalised over them
  const w0 = hist.map((h, b) => (bins.mass0[b] > 0 ? Math.max(0, h) : 0));
  const s0 = w0.reduce((a, b) => a + b, 0);
  if (!(s0 > 0)) return null;
  const p0 = w0.map((x) => x / s0); // his range, no card knowledge
  const w1 = p0.map((x, b) => (bins.mass0[b] > 0 ? (x * bins.mass[b]) / bins.mass0[b] : 0));
  const s1 = w1.reduce((a, b) => a + b, 0);
  if (!(s1 > 0)) return null;
  const p1 = w1.map((x) => x / s1); // his range given the Horse's cards
  let eq = 0;
  for (let b = 0; b < NB; b++) eq += p1[b] * (bins.beat[b] + bins.tie[b] / 2);
  const evCheck = eq * pot * (1 - r);
  const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.river;
  const rows: OmahaRiverOpeningRow[] = [];
  for (const B of amounts) {
    if (!(B > 0)) continue;
    const fm = foldAt ? foldAt(B) : fold;
    const f = clamp((fm.m * B) / (pot + B), 0.01, 0.97);
    // his strategy: fold the weakest f of p0 (bins ordered strong -> weak). kappa[b] = continuing share of bin b.
    const kappa = new Array<number>(NB).fill(0);
    let left = 1 - f;
    for (let b = 0; b < NB; b++) {
      if (!(p0[b] > 0)) continue;
      const take = Math.min(p0[b], left);
      kappa[b] = take / p0[b];
      left -= take;
      if (left <= 1e-12) left = 0;
    }
    let cont = 0;
    let win = 0;
    for (let b = 0; b < NB; b++) {
      if (!(p1[b] > 0) || !(kappa[b] > 0)) continue;
      cont += p1[b] * kappa[b];
      // the continuing part is the bin's strongest kappa; the Horse beats its weakest `beat`, ties the next `tie`
      const top = 1 - kappa[b];
      const bw = Math.max(0, bins.beat[b] - top);
      const tw = Math.max(0, Math.min(bins.beat[b] + bins.tie[b], 1) - Math.max(bins.beat[b], top));
      win += p1[b] * (bw + tw / 2);
    }
    const foldC = clamp(1 - cont, 0, 1);
    const eqCall = cont > 0 ? clamp(win / cont, 0, 1) : 0;
    const ev = foldC * pot * (1 - r) + (1 - foldC) * (eqCall * (pot + 2 * B) * (1 - r) - B);
    const se = Math.sqrt((f * (1 - f)) / (fm.n + k));
    const ride = Math.abs(pot * (1 - r) - (eqCall * (pot + 2 * B) * (1 - r) - B));
    rows.push({
      amount: B,
      fold0: round4(f),
      fold: round4(foldC),
      eqCall: round4(eqCall),
      ev: round4(ev),
      margin: round4(se * ride),
    });
  }
  if (!rows.length) return null;
  let best: OmahaRiverOpeningRow | null = null;
  for (const row of rows)
    if (row.ev - evCheck > row.margin && (!best || row.ev > best.ev)) best = row;
  const kind = best ? (best.eqCall > 0.5 ? 'value' : 'bluff') : null;
  let bluffBest: OmahaRiverOpeningRow | null = null;
  if (kind === 'bluff')
    for (const row of rows)
      if (
        row.ev - evCheck > row.margin &&
        row.eqCall <= 0.5 &&
        row.fold > row.fold0 &&
        (!bluffBest || row.ev > bluffBest.ev)
      )
        bluffBest = row;
  return {
    position,
    eq: round4(eq),
    evCheck: round4(evCheck),
    rows,
    best,
    kind,
    blocker: best ? best.fold > best.fold0 : false,
    bluffBest,
    m: round4(fold.m),
    recordN: fold.n,
  };
}

export interface OmahaRiverOpeningOptions {
  value: boolean;
  bluff: boolean;
}
export interface OmahaRiverOpeningResult {
  decision: HorseDecision;
  changed: boolean;
  kind: 'value' | 'bluff' | null;
  verdict?: OmahaRiverOpeningVerdict;
}

/**
 * The options' one entry. Every decision that is not a final check in the spot is returned as given (the same
 * object). `legalize` is the engine's legalizer; `recordOf` reads his lifetime river fold record (null: none).
 */
export function omahaRiverOpeningBetRule(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  on: OmahaRiverOpeningOptions,
  rake: number,
  legalize: (d: HorseDecision) => HorseDecision,
  recordOf: (opponent: SeatPlayer) => OmahaRiverOpeningFoldRecord | null,
  /** his lifetime public unopened river wager record (bets, opportunities), or null */
  betRecordOf: (opponent: SeatPlayer) => { bets: number; opps: number } | null = () => null
): OmahaRiverOpeningResult {
  const same: OmahaRiverOpeningResult = { decision, changed: false, kind: null };
  if ((!on.value && !on.bluff) || decision.action !== 'check') return same;
  try {
    const spot = omahaRiverOpeningSpot(hero, gs);
    if (!spot) return same;
    if (spot.position === 'oop' && !on.bluff) return same;
    const cell = T.cells[spot.cell];
    const bins = omahaRiverOpeningBins(
      hero.cards,
      gs.communityCards ?? [],
      hero.knownDeadCards ?? []
    );
    if (!cell || !bins) return same;
    const amounts = omahaCardImpactAmounts(hero, spot.opponent, gs);
    if (!amounts.length) return same;
    let record: OmahaRiverOpeningFoldRecord | null = null;
    try {
      record = recordOf(spot.opponent);
    } catch {
      record = null;
    }
    let hist: readonly number[] = cell.hist;
    if (spot.position === 'ip') {
      let betRecord: { bets: number; opps: number } | null = null;
      try {
        betRecord = betRecordOf(spot.opponent);
      } catch {
        betRecord = null;
      }
      const prev = spot.cell.endsWith('|bet') ? 'bet' : 'check';
      hist =
        omahaRiverOpeningCheckerHist(String(gs.gameVariant ?? '').toLowerCase(), prev, betRecord) ??
        cell.hist;
    }
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    const place = (
      amount: number,
      kind: 'value' | 'bluff',
      verdict: OmahaRiverOpeningVerdict
    ): OmahaRiverOpeningResult => {
      const legal = legalize({ ...decision, action: 'bet', amount });
      if (legal.action !== 'bet' && legal.action !== 'all_in') return { ...same, verdict };
      if (
        !fin(legal.amount) ||
        !((legal.amount as number) > 0) ||
        (legal.amount as number) > hero.stack + 0.005
      )
        return { ...same, verdict };
      return {
        decision: { ...decision, action: legal.action, amount: round2(legal.amount as number) },
        changed: true,
        kind,
        verdict,
      };
    };
    // THE VALUE BET (in position): his fold from equilibrium moved by his own record, as before
    let valueVerdict: OmahaRiverOpeningVerdict | null = null;
    if (on.value && spot.position === 'ip') {
      valueVerdict = omahaRiverOpeningPrice(
        hist,
        bins,
        gs.pot,
        amounts,
        rake,
        omahaRiverOpeningFoldMultiplier(record),
        spot.position
      );
      if (valueVerdict?.best && valueVerdict.kind === 'value')
        return place(valueVerdict.best.amount, 'value', valueVerdict);
    }
    if (!on.bluff) return valueVerdict ? { ...same, verdict: valueVerdict } : same;
    // THE BLUFF: his fold read in the order his own record -> people's population for the line and size ->
    // equilibrium (HorseOmahaPeopleFold.ts), size by size; the blocker leg on every size that clears
    const line = omahaPeopleFoldLineOf(gs.actionHistory, 'river', hero.seat);
    const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.river;
    const foldAt = (B: number) =>
      omahaFoldMultiplierOnPeople(
        [
          { cell: record?.foldSmall, eq: OMAHA_RIVER_OPENING_EQ_FOLD.small },
          { cell: record?.foldBig, eq: OMAHA_RIVER_OPENING_EQ_FOLD.big },
        ],
        omahaPeopleFoldMultiplier(variant, 'river', line, B / gs.pot).m,
        OMAHA_RIVER_OPENING_EQ_FOLD.mean,
        k
      );
    const verdict = omahaRiverOpeningPrice(
      hist,
      bins,
      gs.pot,
      amounts,
      rake,
      foldAt(amounts[amounts.length - 1]),
      spot.position,
      foldAt
    );
    if (!verdict) return valueVerdict ? { ...same, verdict: valueVerdict } : same;
    if (verdict.kind !== 'bluff' || !verdict.bluffBest) return { ...same, verdict };
    return place(verdict.bluffBest.amount, 'bluff', verdict);
  } catch {
    return same;
  }
}
