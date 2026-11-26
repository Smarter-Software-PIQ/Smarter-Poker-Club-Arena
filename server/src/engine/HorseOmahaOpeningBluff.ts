/**
 * THE HEADS-UP TURN AND RIVER OPENING BLUFF: MATH, AND BLOCKERS OR THE RANGE ADVANTAGE (PLO-OWNER lead-7 lane
 * plo-bluffs, 2026-11-26). Three options, each default OFF (read `=== true`), switchable live, scopable per game
 * (horse.omahaGameScope):
 *
 *  omahaTurnBluffIsPricedOnBlockers          heads-up turn, nothing to call (he checked, or the Horse acts first): a
 *     final CHECK becomes the best-priced bet of 0.7 pot or more when ALL of (math) the bet is worth more than the
 *     check by more than its error, (equity) it is a semi-bluff, not a pure bluff, AND (blockers) the Horse's cards
 *     take more of his continuing hands than of his folding hands.
 *  omahaTurnBluffIsPricedOnRangeAdvantage    the same spot, math and equity leg; the second leg is the range advantage.
 *  omahaRiverBluffIsPricedOnRangeAdvantage   the heads-up river spot and the math of omahaRiverBluffIsPricedOnBlockers
 *     (HorseOmahaRiverOpeningBet.ts, the same verdict); the second leg is the range advantage.
 *
 * Owner order: a late-street bluff is never random; it is math dependent AND blocker dependent, OR the range
 * advantage is the Horse's. Each option that makes a bet needs the math leg and one second leg.
 *
 * HIS RANGE (turn). The measured strength-now histogram of his role, line and the board's texture
 * (HorseOmahaOpeningBluffRangeTables.json `cells`, fit by scripts/ops/omaha-opening-bluff-range-fit.mjs from PEOPLE's
 * shown hands only, showdown bias corrected by strata of his own action; review t4 2026-11-26: Horse hands never
 * enter it, owner order "the stats need to be used against human players, not horses"): after his check (`oopcheck`), or in position before he
 * acts (`ip`). CARD REMOVAL is exact (omahaOpeningBinsOnBoard): the bins are cut on the turn board's holdings and
 * each bin's weight is moved by the share of its holdings the Horse's cards and the known dead cards leave him.
 *
 * HIS FOLD RATE (HorseOmahaPeopleFold.ts; owner order: the stats are used against people, not Horses). In the order
 * his own lifetime public turn record (OPPONENT-HUD x.foldToBet by size cell; HorseMind.omahaStrongHandCheckRecordsOf)
 * -> people's population (answers by PEOPLE only to heads-up turn first wagers, by game, the Horse's line and the size
 * cell; Horse answers never enter it) -> equilibrium B / (P + B) where both are thin: each level is shrunk to the next
 * by k = 27.8 turn answers (the measured between-player prior of HorseOmahaStrongHandCheck). The same function for
 * every opponent. He folds the WEAKEST share of his range; the share that folds given the Horse's cards is read on
 * the card-removed range.
 *
 * THE TURN PRICE. The Horse's share with a card to come is the engine's big-draw sampler (omahaBigDrawEquities: one
 * seeded sample of holdings and river cards), counted by the strength bin each sampled holding is in on the board
 * now (the same cut as his range). The sampler's holdings are uniform, so the bins are re-weighted by HIS measured,
 * card-removed range (review t3, 2026-11-26: before, the share was read on the sampler's own tiers of uniform
 * holdings, so the price did not depend on how strong his range was). He continues with the strongest share of his
 * range, kappa_b of each bin, so e_c(B) = sum_b p_b kappa_b e_b / sum_b p_b kappa_b and e_all = sum_b p_b e_b: a
 * bigger bet is called by a stronger range, and against a strong range the Horse holds less equity.
 *   EV(check) = R x e_all x P x (1 - rake)                      R the engine's turn realization for the position
 *   EV(bet B) = f' x P x (1 - rake)
 *             + (1 - f') x ((1 - r) x (R x e_c(B) x (P + 2B) x (1 - rake) - B) - r x B)
 *     f' his fold share given the Horse's cards, R the same realization (river playability), r his raise share of
 *     the answers that continue (the engine's measured raise-back share of all answers over his continue share):
 *     against a raise the Horse is scored as losing the bet and its whole equity.
 *   margin = his fold rate's binomial error on n + k answers times d EV / d fold, plus the sampler's error on e_c
 *   (each bin's binomial error on its own sample count, weighted by the bin's share of the continuing range).
 * A bet whose share against the hands that continue is above one half is a value bet and is not this file's.
 * SIZES. Only bets of 0.7 pot or more are priced (the measured turn deficit is at that size; people fold 12 to 19% to
 * a turn bet under 0.4 pot against a 22 to 25% break-even, so a small turn bluff loses and none is added).
 * SEMI-BLUFF, NOT PURE BLUFF. The equity the bet puts to work when called, (1 - f') x (1 - r) x R x e_c x (P + 2B) x
 * (1 - rake), must be worth at least what the check keeps, EV(check): a pure turn bluff is worth little against
 * people (MEASURE: +1.4 bb a week PLO4, +4.7 bb PLO5), so the best bet is chosen only among semi-bluffs.
 *
 * THE RANGE ADVANTAGE. The Horse's own range is the measured histogram of ITS role and line on this texture, from the
 * Horses' own shown hands (the table's `heroCells`: what the deciding Horse's range holds is not a statistic about
 * the opponent, so it is measured on the Horses that play the role; it never prices his fold or his range); his is
 * his, from people only. On the bins of this board: (1) the Horse's range beats his range more than half the time by more than the two
 * histograms' sampling error; (2) the value the Horse's range holds against the hands that continue against this
 * bet (the share of the Horse's range that beats more than half of them) carries B / (P + B) of bluffs for each
 * value bet (the balanced share for the size), and the hand is in that weakest share of the Horse's range. So the
 * candidates are the bottom of the range, as many as the value in the range supports, never a random draw.
 *
 * No hand class, no fixed percentage, nothing keyed on an account, a name or a person/Horse flag; public actions, the
 * Horse's own cards and the known dead cards only. It changes only a check into a bet; never a raise (owner rules: a
 * hand that is not nut class never raises the turn or river; draws are never raised out of position). PLO4/PLO5 cash,
 * high only, one board, no bomb pot, heads-up; PLO6, hold'em and tournaments are untouched. Pure: no telemetry, no
 * state, no random draw (the sampler is seeded by the cards).
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaCardImpactAmounts, omahaCardImpactScope } from './HorseOmahaCardImpact.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import { OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS } from './HorseOmahaStrongHandCheck.js';
import {
  OMAHA_BIG_DRAW_SAMPLES,
  omahaBigDrawEquities,
  type OmahaBigDrawCounts,
} from './HorseOmahaBigDrawAggression.js';
import { OMAHA_BIG_DRAW_BET_RESPONSE_PRIORS } from './HorseOmahaBigDrawBetPriced.js';
import {
  OMAHA_RIVER_OPENING_BIN_EDGES,
  omahaOpeningBinsOnBoard,
  omahaRiverOpeningBetRule,
  type OmahaOpeningBinClassifier,
  type OmahaRiverOpeningBins,
  type OmahaRiverOpeningFoldRecord,
  type OmahaRiverOpeningVerdict,
} from './HorseOmahaRiverOpeningBet.js';
import {
  omahaFoldMultiplierOnPeople,
  omahaPeopleFoldMultiplier,
  type OmahaPeopleFoldLine,
} from './HorseOmahaPeopleFold.js';
import tables from './HorseOmahaOpeningBluffRangeTables.json' with { type: 'json' };

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
  /** HIS range: people's shown hands only (owner order 2026-11-26; review t4) */
  cells: Record<string, RangeCell>;
  /** the deciding Horse's OWN range: the Horses' own shown hands (never a statistic about the opponent) */
  heroCells: Record<string, RangeCell>;
};
export const OMAHA_OPENING_BLUFF_RANGE_VERSION: string = T.version;
const NB = OMAHA_RIVER_OPENING_BIN_EDGES.length - 1;
if (
  T.binEdges.length !== OMAHA_RIVER_OPENING_BIN_EDGES.length ||
  T.binEdges.some((e, i) => e !== OMAHA_RIVER_OPENING_BIN_EDGES[i])
)
  throw new Error(
    'HorseOmahaOpeningBluffRangeTables.json: bin edges differ from the river opening tables'
  );

/** The equilibrium fold the record of a size cell is read against (small: 0.7 pot or less; big: above). */
export const OMAHA_OPENING_BLUFF_EQ_FOLD = Object.freeze({ small: 1 / 3, big: 1 / 2 });
/** The edge between the two size cells of his public fold record (OPPONENT-HUD x.foldToBet small / big). */
export const OMAHA_OPENING_BLUFF_BIG_SIZE = 0.7;
/** A turn semi-bluff's equity when called pays back at least this share of the bet (half the price of a call). */
export const OMAHA_TURN_SEMI_BLUFF_PRICE_SHARE = 0.5;

export type OmahaOpeningBluffStreet = 'turn' | 'river';
export type OmahaOpeningBluffPosition = 'ip' | 'oop';
export type OmahaOpeningBluffLine = 'agg' | 'def' | 'chk';
export type OmahaOpeningBluffTexture = 'paired' | 'flush' | 'plain';
export interface OmahaOpeningBluffSpot {
  street: OmahaOpeningBluffStreet;
  opponent: SeatPlayer;
  position: OmahaOpeningBluffPosition;
  /** his measured range cell, and the Horse's own */
  hisCell: string;
  heroCell: string;
  /** the Horse's line as the bettor (people's fold cells are cut by it) */
  heroLine: OmahaPeopleFoldLine;
}

const WAGERS = new Set(['bet', 'raise', 'all_in']);
const PREVIOUS: Readonly<Record<OmahaOpeningBluffStreet, string>> = { turn: 'flop', river: 'turn' };

/** The board's texture, as the fit cuts it: a rank twice, else three or more of a suit, else plain. */
export function omahaOpeningBluffTexture(board: readonly Card[]): OmahaOpeningBluffTexture {
  const ranks = new Map<string, number>();
  const suits = new Map<string, number>();
  for (const c of board) {
    const r = String(c.rank).toUpperCase().replace('10', 'T');
    const s = String(c.suit).toLowerCase();
    ranks.set(r, (ranks.get(r) ?? 0) + 1);
    suits.set(s, (suits.get(s) ?? 0) + 1);
  }
  for (const n of ranks.values()) if (n >= 2) return 'paired';
  for (const n of suits.values()) if (n >= 3) return 'flush';
  return 'plain';
}

/** The spot, or null: PLO4/PLO5 cash heads-up turn or river, nothing to call, he checked or nobody has acted. */
export function omahaOpeningBluffSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaOpeningBluffSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(hero, gs)) return null;
    const scope = omahaCardImpactScope(hero, gs);
    if (!scope) return null;
    const street = scope.street;
    const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
    const here = history.filter((a) => String(a.stage) === street);
    let position: OmahaOpeningBluffPosition;
    if (scope.heroCloses) {
      if (here.some((a) => WAGERS.has(String(a.action)))) return null;
      position = 'ip';
    } else {
      if (here.length > 0) return null;
      position = 'oop';
    }
    let lastAgg: number | null = null;
    for (const a of history)
      if (String(a.stage) === PREVIOUS[street] && WAGERS.has(String(a.action))) lastAgg = a.seat;
    const lineOf = (seat: number): OmahaOpeningBluffLine =>
      lastAgg === null ? 'chk' : lastAgg === seat ? 'agg' : 'def';
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    const tex = omahaOpeningBluffTexture(gs.communityCards ?? []);
    const hisRole = position === 'ip' ? 'oopcheck' : 'ip';
    const hisCell = `${variant}|${street}|${hisRole}|${lineOf(scope.opponent.seat)}|${tex}`;
    const heroCell = `${variant}|${street}|${position}|${lineOf(hero.seat)}|${tex}`;
    if (!T.cells[hisCell] || !T.heroCells?.[heroCell]) return null;
    const own = lineOf(hero.seat);
    const heroLine: OmahaPeopleFoldLine = own === 'def' ? 'vsAgg' : own;
    return { street, opponent: scope.opponent, position, hisCell, heroCell, heroLine };
  } catch {
    return null;
  }
}

/** His range on this board's bins without (p0) and with (p1) the Horse's cards; null when it holds nothing. */
function rangesOn(
  hist: readonly number[],
  bins: OmahaRiverOpeningBins
): { p0: number[]; p1: number[] } | null {
  if (hist.length !== NB) return null;
  const w0 = hist.map((h, b) => (bins.mass0[b] > 0 ? Math.max(0, h) : 0));
  const s0 = w0.reduce((a, b) => a + b, 0);
  if (!(s0 > 0)) return null;
  const p0 = w0.map((x) => x / s0);
  const w1 = p0.map((x, b) => (bins.mass0[b] > 0 ? (x * bins.mass[b]) / bins.mass0[b] : 0));
  const s1 = w1.reduce((a, b) => a + b, 0);
  if (!(s1 > 0)) return null;
  return { p0, p1: w1.map((x) => x / s1) };
}

/** He folds the weakest f of p0 (bins ordered strong to weak): the continuing share of each bin. */
function continuing(p0: readonly number[], f: number): number[] {
  const kappa = new Array<number>(NB).fill(0);
  let left = 1 - f;
  for (let b = 0; b < NB; b++) {
    if (!(p0[b] > 0)) continue;
    const take = Math.min(p0[b], left);
    kappa[b] = take / p0[b];
    left -= take;
    if (left <= 1e-12) left = 0;
  }
  return kappa;
}

export interface OmahaOpeningBluffRangeLeg {
  /** the Horse's range against his, hand for hand (ties half), and the sampling error it must clear */
  advantage: number;
  error: number;
  /** the share of the Horse's range that beats more than half of the hands that continue against this bet */
  value: number;
  /** the bluffs that value carries at this size: value x B / (P + B) */
  quota: number;
  /** the share of the Horse's range that is weaker than this hand */
  weaker: number;
  holds: boolean;
}

/**
 * THE RANGE ADVANTAGE at one bet. `heroHist` / `hisHist` the two measured ranges, `bins` the exact shares of this
 * board (the Horse's own hand's place among the holdings is in `beat` / `tie`), `fold0` his fold share to the bet
 * without card knowledge. Pure arithmetic.
 */
export function omahaOpeningBluffRangeLeg(
  heroHist: readonly number[],
  hisHist: readonly number[],
  heroShown: number,
  hisShown: number,
  bins: OmahaRiverOpeningBins,
  fold0: number,
  pot: number,
  amount: number
): OmahaOpeningBluffRangeLeg | null {
  if (heroHist.length !== NB || hisHist.length !== NB || !(pot > 0) || !(amount > 0)) return null;
  const norm = (h: readonly number[]): number[] | null => {
    const w = h.map((x, b) => (bins.mass0[b] > 0 ? Math.max(0, x) : 0));
    const s = w.reduce((a, b) => a + b, 0);
    return s > 0 ? w.map((x) => x / s) : null;
  };
  const H = norm(heroHist);
  const V = norm(hisHist);
  if (!H || !V) return null;
  // (1) range against range: bins are ordered strong to weak
  let advantage = 0;
  let below = 1;
  for (let i = 0; i < NB; i++) {
    below -= V[i];
    advantage += H[i] * (Math.max(0, below) + V[i] / 2);
  }
  const error = 0.5 * Math.sqrt(1 / Math.max(1, heroShown) + 1 / Math.max(1, hisShown));
  // (2) the value in the Horse's range against the hands that continue, and the bluffs it carries
  const f = clamp(fold0, 0, 0.99);
  const kappa = continuing(V, f);
  const cont = 1 - f;
  let value = 0;
  let weakerCont = cont;
  for (let i = 0; i < NB; i++) {
    const own = V[i] * kappa[i];
    weakerCont -= own;
    const beats = cont > 0 ? (Math.max(0, weakerCont) + own / 2) / cont : 0;
    if (beats > 0.5) value += H[i];
  }
  const quota = (value * amount) / (pot + amount);
  let weaker = 0;
  for (let i = 0; i < NB; i++) weaker += H[i] * clamp(bins.beat[i] + bins.tie[i] / 2, 0, 1);
  return {
    advantage: round4(advantage),
    error: round4(error),
    value: round4(value),
    quota: round4(quota),
    weaker: round4(weaker),
    holds: advantage > 0.5 + error && weaker < quota,
  };
}

/**
 * The Horse's sampled shares with a card to come (omahaBigDrawEquities' one seeded sample), counted by the STRENGTH
 * BIN each sampled holding of his is in on the board now (omahaOpeningBinsOnBoard's cut, strongest first). Review t3
 * (2026-11-26): the sampler draws his holdings uniformly from the unseen cards, so its plain share (`all`) is the
 * Horse's share against a RANDOM hand. Read by bin, each bin's share is the Horse's share against the holdings of
 * that strength, and his measured range on this board (card-removed) weights the bins: the price then depends on how
 * strong his range is, and the hands that continue against a bet are the strongest bins of HIS range.
 */
export interface OmahaTurnBluffEquity {
  /** against a random holding (the sampler's plain share; reported, not priced on) */
  all: number;
  /** per strength bin, strongest first: sampled holdings and the Horse's summed share against them */
  bins: { got: readonly number[]; won: readonly number[] };
  samples: number;
}
export function omahaTurnBluffEquityOf(counts: OmahaBigDrawCounts): OmahaTurnBluffEquity | null {
  const n = fin(counts.got[0]) ? (counts.got[0] as number) : 0;
  if (!(n > 0)) return null;
  const w = fin(counts.won[0]) ? (counts.won[0] as number) : 0;
  const bg = counts.binGot;
  const bw = counts.binWon;
  if (!Array.isArray(bg) || !Array.isArray(bw)) return null;
  const got = Array.from({ length: NB }, (_, b) => (fin(bg[b]) ? (bg[b] as number) : 0));
  const won = Array.from({ length: NB }, (_, b) => (fin(bw[b]) ? (bw[b] as number) : 0));
  if (!(got.reduce((a, x) => a + x, 0) > 0)) return null;
  return { all: clamp(w / n, 0, 1), bins: { got, won }, samples: n };
}
/**
 * The bins of this board and the Horse's sampled shares by bin, from one call of the engine's big-draw sampler (the
 * same seeded draws as omahaBigDrawEquities). Null when either cannot be had.
 */
export function omahaTurnBluffSample(
  hole: Card[],
  board: Card[],
  dead: Card[],
  samples: number = OMAHA_BIG_DRAW_SAMPLES
): { bins: OmahaRiverOpeningBins; equity: OmahaTurnBluffEquity } | null {
  const classify: OmahaOpeningBinClassifier = {};
  const bins = omahaOpeningBinsOnBoard(hole, board, dead, classify);
  if (!bins || !classify.binOfIds) return null;
  const counts: OmahaBigDrawCounts = {
    got: [0, 0, 0],
    won: [0, 0, 0],
    binOf: classify.binOfIds,
    binGot: new Array<number>(NB).fill(0),
    binWon: new Array<number>(NB).fill(0),
  };
  if (!omahaBigDrawEquities(hole, board, dead, samples, counts)) return null;
  const equity = omahaTurnBluffEquityOf(counts);
  return equity ? { bins, equity } : null;
}
/**
 * The Horse's share against each bin. A bin the sample did not reach takes the nearest sampled bin's share (the
 * stronger one on a tie); its sample count stays 0, so its weight enters the margin at the full binomial error.
 */
function binShares(e: OmahaTurnBluffEquity): number[] {
  const eq = new Array<number>(NB).fill(e.all);
  for (let b = 0; b < NB; b++) {
    for (let d = 0; d < NB; d++) {
      const s =
        b - d >= 0 && e.bins.got[b - d] > 0
          ? b - d
          : b + d < NB && e.bins.got[b + d] > 0
            ? b + d
            : -1;
      if (s >= 0) {
        eq[b] = clamp(e.bins.won[s] / e.bins.got[s], 0, 1);
        break;
      }
    }
  }
  return eq;
}
/** The Horse's share against a weighting of his bins (weights need not sum to 1), and the sampling error of it. */
function shareAgainst(
  e: OmahaTurnBluffEquity,
  eq: readonly number[],
  weight: readonly number[]
): { eq: number; se: number } {
  let W = 0;
  for (let b = 0; b < NB; b++) W += Math.max(0, weight[b]);
  if (!(W > 0)) return { eq: eq[0], se: 0.5 };
  let m = 0;
  let v = 0;
  for (let b = 0; b < NB; b++) {
    const w = Math.max(0, weight[b]) / W;
    m += w * eq[b];
    v += (w * w * Math.max(eq[b] * (1 - eq[b]), 0.01)) / Math.max(1, e.bins.got[b]);
  }
  return { eq: clamp(m, 0, 1), se: Math.sqrt(v) };
}

export interface OmahaTurnBluffRow {
  amount: number;
  /** his fold share without / with the Horse's cards */
  fold0: number;
  fold: number;
  /** the Horse's share, a card to come, against the hands of HIS range that continue against this size */
  eqCall: number;
  ev: number;
  margin: number;
  /**
   * A semi-bluff, not a pure bluff: the Horse's equity against the hands that continue, times how often they call
   * and the pot they call into, is worth at least what the check keeps (EV(check)). Pure turn bluffs are worth
   * little against people (MEASURE: +1.4 bb / +4.7 bb a week), so a turn bet made by these options needs it.
   */
  semi: boolean;
}
export interface OmahaTurnBluffVerdict {
  position: OmahaOpeningBluffPosition;
  /** the Horse's share, a card to come, against his whole measured range on this board */
  eqAll: number;
  evCheck: number;
  rows: OmahaTurnBluffRow[];
  /** the best-EV bet that clears its margin over the check, if any */
  best: OmahaTurnBluffRow | null;
  /** the best bet is a value bet (its share against the hands that continue is above one half) */
  value: boolean;
  blocker: boolean;
  recordN: number;
}

export interface OmahaTurnBluffInput {
  hist: readonly number[];
  bins: OmahaRiverOpeningBins;
  pot: number;
  amounts: readonly number[];
  rake: number;
  /** the engine's turn realization for the Horse's position */
  realization: number;
  /** his raise share of all answers (the engine's measured raise-back prior) */
  raiseBack: number;
  record: OmahaRiverOpeningFoldRecord | null;
  position: OmahaOpeningBluffPosition;
  equity: OmahaTurnBluffEquity;
  /** game and the Horse's line: people's fold cell for each size (HorseOmahaPeopleFold.ts) */
  variant: string;
  line: OmahaPeopleFoldLine;
}

/** The turn comparison. Pure arithmetic. */
export function omahaTurnBluffPrice(i: OmahaTurnBluffInput): OmahaTurnBluffVerdict | null {
  if (!(i.pot > 0)) return null;
  const ranges = rangesOn(i.hist, i.bins);
  if (!ranges) return null;
  const { p0, p1 } = ranges;
  const r = fin(i.rake) ? clamp(i.rake, 0, 0.2) : 0;
  const R = fin(i.realization) ? clamp(i.realization, 0.5, 1) : 0.85;
  const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.turn;
  const P = i.pot * (1 - r);
  // review t3: the Horse's share is read against HIS range on this board, bin by bin (card-removed), never against
  // the sampler's random holdings: EV(check) against his whole range, the bet against the bins that continue
  const eqBin = binShares(i.equity);
  const eqRange = shareAgainst(i.equity, eqBin, p1).eq;
  const evCheck = R * eqRange * P;
  const rows: OmahaTurnBluffRow[] = [];
  let recordN = 0;
  for (const B of i.amounts) {
    if (!(B > 0)) continue;
    const ratio = B / i.pot;
    const big = ratio > OMAHA_OPENING_BLUFF_BIG_SIZE;
    // his fold: his own record -> people's population for the line and size -> equilibrium
    const eqCell = big ? OMAHA_OPENING_BLUFF_EQ_FOLD.big : OMAHA_OPENING_BLUFF_EQ_FOLD.small;
    const fm = omahaFoldMultiplierOnPeople(
      [{ cell: big ? i.record?.foldBig : i.record?.foldSmall, eq: eqCell }],
      omahaPeopleFoldMultiplier(i.variant, 'turn', i.line, ratio).m,
      eqCell,
      k
    );
    const f = clamp((fm.m * ratio) / (1 + ratio), 0.01, 0.97);
    recordN = Math.max(recordN, fm.n);
    const kappa = continuing(p0, f);
    let cont = 0;
    for (let b = 0; b < NB; b++) cont += p1[b] * kappa[b];
    cont = clamp(cont, 0, 1);
    const foldC = 1 - cont;
    const against = shareAgainst(
      i.equity,
      eqBin,
      p1.map((x, b) => x * kappa[b])
    );
    const eC = against.eq;
    const raise = cont > 0 ? clamp(i.raiseBack / cont, 0, 0.5) : 0;
    const called = R * eC * (i.pot + 2 * B) * (1 - r) - B;
    const continued = (1 - raise) * called - raise * B;
    const ev = foldC * P + cont * continued;
    const se = Math.sqrt((f * (1 - f)) / (fm.n + k));
    const seEq = against.se;
    const margin = se * Math.abs(P - continued) + seEq * cont * (1 - raise) * R * (i.pot + 2 * B);
    rows.push({
      amount: B,
      fold0: round4(f),
      fold: round4(foldC),
      eqCall: round4(eC),
      ev: round4(ev),
      margin: round4(margin),
      // a semi-bluff: when called its equity pays back at least half of what a call of this bet needs
      // (R x eC x (P + 2B) >= B / 2, i.e. R x eC >= half of B / (P + 2B)), and the equity it puts to work when called
      // is worth at least what the check keeps. A hand with no equity is never a semi-bluff (lead-7: with zero equity
      // both sides of the second test are zero, so it alone let a pure bluff through).
      semi:
        R * eC * (i.pot + 2 * B) >= OMAHA_TURN_SEMI_BLUFF_PRICE_SHARE * B &&
        cont * (1 - raise) * R * eC * (i.pot + 2 * B) * (1 - r) >= evCheck,
    });
  }
  if (!rows.length) return null;
  let best: OmahaTurnBluffRow | null = null;
  for (const row of rows)
    if (row.semi && row.ev - evCheck > row.margin && (!best || row.ev > best.ev)) best = row;
  return {
    position: i.position,
    eqAll: round4(eqRange),
    evCheck: round4(evCheck),
    rows,
    best,
    value: best ? best.eqCall > 0.5 : false,
    blocker: best ? best.fold > best.fold0 : false,
    recordN,
  };
}

export interface OmahaOpeningBluffOptions {
  turnBlockers: boolean;
  turnRange: boolean;
  riverRange: boolean;
}
export type OmahaOpeningBluffKind = 'turn_blockers' | 'turn_range' | 'river_range';
export interface OmahaOpeningBluffResult {
  decision: HorseDecision;
  changed: boolean;
  kind: OmahaOpeningBluffKind | null;
  turn?: OmahaTurnBluffVerdict;
  river?: OmahaRiverOpeningVerdict;
  range?: OmahaOpeningBluffRangeLeg;
}
export interface OmahaOpeningBluffDeps {
  rake: number;
  /** the engine's turn realization for the Horse's position (omahaPricedDeps) */
  realization: number;
  legalize: (d: HorseDecision) => HorseDecision;
  /** his lifetime public fold record on the street (null: none) */
  recordOf: (
    opponent: SeatPlayer,
    street: OmahaOpeningBluffStreet
  ) => OmahaRiverOpeningFoldRecord | null;
  /** his lifetime public unopened river wager record (bets, opportunities), or null */
  betRecordOf: (opponent: SeatPlayer) => { bets: number; opps: number } | null;
}

/**
 * The options' one entry. Every decision that is not a final check (or, for the size option, a final bet) in the
 * spot is returned as given (the same object).
 */
export function omahaOpeningBluffRule(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  on: OmahaOpeningBluffOptions,
  deps: OmahaOpeningBluffDeps
): OmahaOpeningBluffResult {
  const same: OmahaOpeningBluffResult = { decision, changed: false, kind: null };
  if (!on.turnBlockers && !on.turnRange && !on.riverRange) return same;
  if (decision.action !== 'check') return same;
  try {
    const stage = String(gs.stage ?? '');
    if (stage === 'turn') {
      if (!on.turnBlockers && !on.turnRange) return same;
    } else if (stage !== 'river' || !on.riverRange) return same;
    const spot = omahaOpeningBluffSpot(hero, gs);
    if (!spot) return same;
    const his = T.cells[spot.hisCell];
    const mine = T.heroCells[spot.heroCell];
    const board = gs.communityCards ?? [];
    const dead = hero.knownDeadCards ?? [];
    const place = (
      amount: number,
      kind: OmahaOpeningBluffKind,
      extra: Partial<OmahaOpeningBluffResult>
    ): OmahaOpeningBluffResult => {
      const legal = deps.legalize({ ...decision, action: 'bet', amount });
      if (legal.action !== 'bet' && legal.action !== 'all_in') return { ...same, ...extra };
      if (
        !fin(legal.amount) ||
        !((legal.amount as number) > 0) ||
        (legal.amount as number) > hero.stack + 0.005
      )
        return { ...same, ...extra };
      const placed = round2(legal.amount as number);
      return {
        decision: { ...decision, action: legal.action, amount: placed },
        changed: true,
        kind,
        ...extra,
      };
    };
    if (spot.street === 'river') {
      // the math is omahaRiverBluffIsPricedOnBlockers' own verdict (no option of that file is switched by this call)
      const priced = omahaRiverOpeningBetRule(
        decision,
        hero,
        gs,
        { value: false, bluff: true },
        deps.rake,
        (d) => d,
        (o) => deps.recordOf(o, 'river'),
        deps.betRecordOf
      );
      const river = priced.verdict;
      if (!river || !river.best || river.kind !== 'bluff') return { ...same, river };
      const bins = omahaOpeningBinsOnBoard(hero.cards, board, dead);
      if (!bins) return { ...same, river };
      const range = omahaOpeningBluffRangeLeg(
        mine.hist,
        his.hist,
        mine.shown,
        his.shown,
        bins,
        river.best.fold0,
        gs.pot,
        river.best.amount
      );
      if (!range || !range.holds) return { ...same, river, ...(range ? { range } : {}) };
      return place(river.best.amount, 'river_range', { river, range });
    }
    // a check becomes a bet only at 0.7 pot or more: the measured turn deficit is there; a small turn bluff loses
    // against people (under 0.4 pot they fold 12 to 19% against a 22 to 25% break-even), so none is added
    const amounts = omahaCardImpactAmounts(hero, spot.opponent, gs).filter(
      (a) => a >= OMAHA_OPENING_BLUFF_BIG_SIZE * gs.pot - 0.005
    );
    if (!amounts.length) return same;
    const sampled = omahaTurnBluffSample(hero.cards, board, dead);
    if (!sampled) return same;
    const { bins, equity } = sampled;
    let record: OmahaRiverOpeningFoldRecord | null = null;
    try {
      record = deps.recordOf(spot.opponent, 'turn');
    } catch {
      record = null;
    }
    const variant = String(gs.gameVariant ?? '').toLowerCase() === 'plo5' ? 'plo5' : 'plo4';
    const turn = omahaTurnBluffPrice({
      hist: his.hist,
      bins,
      pot: gs.pot,
      amounts,
      rake: deps.rake,
      realization: deps.realization,
      raiseBack: OMAHA_BIG_DRAW_BET_RESPONSE_PRIORS[variant].turn.rBetHu,
      record,
      position: spot.position,
      equity,
      variant,
      line: spot.heroLine,
    });
    if (!turn) return same;
    if (!turn.best || turn.value) return { ...same, turn };
    if (on.turnBlockers && turn.blocker) return place(turn.best.amount, 'turn_blockers', { turn });
    if (!on.turnRange) return { ...same, turn };
    const range = omahaOpeningBluffRangeLeg(
      mine.hist,
      his.hist,
      mine.shown,
      his.shown,
      bins,
      turn.best.fold0,
      gs.pot,
      turn.best.amount
    );
    if (!range || !range.holds) return { ...same, turn, ...(range ? { range } : {}) };
    return place(turn.best.amount, 'turn_range', { turn, range });
  } catch {
    return same;
  }
}
