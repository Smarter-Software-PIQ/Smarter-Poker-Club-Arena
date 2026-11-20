/**
 * THE FACING-BET VALUE SHARE IS MEASURED (HORSE DECISIONS lane 2026-11-19; option
 * omahaFacingBetValueShareIsMeasured, default OFF, read `=== true`).
 *
 * The finding (audits A and B of the 48-hour human-versus-Horse slice, archive
 * plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J): the largest loss class is a fold with the price met.
 * The facing-bet verdict (HorseOmahaFacingBetEv) prices the bettor's bet as a VALUE region, the strongest
 * share V of ALL holdings on the board, plus a fixed bluff share q. V is a stated table
 * (OMAHA_EV_VALUE_SHARE) times 0.8 for every earlier street he bet. On a PLO5 board that share of random
 * five-card holdings is straights or better, so a set, two pair or a non-nut straight wins only q
 * (0.08 to 0.19) whoever bets: #60057733 folded top set on the river at 23 percent (vsValue 0), B's
 * 127f30c9 folded a straight all in at 26 percent. Neither the opponent's read nor his line moves V.
 *
 * This module gives the verdict two inputs that are measured instead of stated:
 *
 *  1. THE BETTOR'S STREET RECORD MOVES V (every covered spot, any bettor of a known kind).
 *     g = (his bet rate with no bet yet on a street / his kind's rate) ^ e, the rate the posterior mean
 *     of his decayed street cell against the kind's rate with the kind's measured pseudo-opportunities
 *     (HorseOmahaFlopBettorRead: OMAHA_FLOP_BETTOR_PRIOR, omahaFlopBettorRate; exactly 1 with no
 *     opportunity, no threshold). e is the measured elasticity of a bet range's width in the bet rate,
 *     read off the flop measurement already in the engine: slope / (mean rate / 2), the move of the mean
 *     strength percentile per unit of ln rate over the move a range of proportional width would make
 *     (person 0.95, Horse 0.47; STATED for the turn and the river, where no slope is measured).
 *     The value share of THIS street's first bet is multiplied by g(this street); the 0.8 narrowing of
 *     every earlier street on which he made the first bet becomes 0.8 ^ (1 / g(that street)), so a
 *     measured wide bettor narrows less and a measured tight one more. A raise has no cell: not moved.
 *  2. A PERSON'S HEADS-UP FIRST BET IS PRICED ON HIS LINE-CONDITIONED MEASURED RANGE (turn and river).
 *     His holdings are drawn from the unseen cards (the Horse's blockers exact), cut to the width of his
 *     preflop line (a 3-bet or more: omahaPreflopDefenceRangeWidth at the measured person re-raise rate,
 *     as HorseOmahaFacingBetValueRange); each holding's strength r is its percentile in that range on
 *     THIS board; the weight of r is the MEASURED density of r among people's first bets of this street,
 *     by the number of earlier postflop streets he bet or raised and by the bet's share of the pot
 *     (river: OMAHA_VALUE_RANGE_FIT, 1,201 bets; turn: OMAHA_TURN_RANGE_FIT below, fitted on the showdown
 *     hands of the two audit slices). His bluffs are inside that density: there is no separate bluff
 *     prior and no value percentile. His street record tilts the density, d(r) ^ (1 / g): a wider bettor
 *     flatter, a tighter one steeper, exactly the population's at g = 1. On the river the Horse wins the
 *     holdings it beats; on the turn its equity against each holding is counted exactly over every river
 *     card, and a call with chips behind takes the base verdict's realization. EV(call) at the actual
 *     price against the base verdict's one margin.
 *
 * Bet size never decides by itself: it selects the density row and the price, as before.
 * Pure: no telemetry, no opponent memory, nothing keyed to an account; the generator is seeded by the
 * cards (never the brain's random stream).
 */
import type { Card } from '../types.js';
import { omahaPreflopPercentile, scoreOmahaHiPartial } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';
import type { OmahaFacingBetEvSpot, OmahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_VALUE_RANGE_FIT,
  OMAHA_VALUE_RANGE_RERAISE_RATE,
  omahaValueRangeDensity,
  omahaValueRangePreflopDepth,
  type OmahaValueRangeFit,
} from './HorseOmahaFacingBetValueRange.js';
import { omahaPreflopDefenceRangeWidth } from './HorseOmahaPreflopReraiseDefence.js';
import {
  OMAHA_FLOP_BETTOR_PRIOR,
  omahaFlopBettorIsPreflopAggressor,
  omahaFlopBettorRate,
} from './HorseOmahaFlopBettorRead.js';
import { flopTextureOf, validStreetRead, type StreetReadCounters } from './HorseOmahaStreetRead.js';
import type { OmahaOpponentKind } from './HorseOmahaPricedMode.js';

// ───────────────────────────── 1. the street record moves V ─────────────────────────────

/** The narrowing per earlier street he bet that the stated table applies (HorseOmahaFacingBetEv). */
export const OMAHA_MEASURED_LINE_AGGRESSOR = 0.8;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
/**
 * The measured elasticity of a bet range's width in the bet rate, per kind: the flop slope of his other
 * first bets (HorseOmahaFlopBettorRead, measured) over the slope a range of proportional width would give,
 * which is half the kind's mean flop-bet rate. Derived from the engine's own constants, never typed twice.
 */
export function omahaMeasuredRangeElasticity(kind: OmahaOpponentKind): number {
  const P = OMAHA_FLOP_BETTOR_PRIOR[kind];
  const rate = mean(Object.values(P.flopBet));
  return rate > 0 ? Math.max(0, Math.min(1.5, P.slope.flopBet / (rate / 2))) : 0;
}

export type OmahaMeasuredStreet = 'flop' | 'turn' | 'river';

export interface OmahaMeasuredStreetFactor {
  street: OmahaMeasuredStreet;
  /** his posterior rate over his kind's: exactly 1 with no opportunity */
  ratio: number;
  /** ratio ^ elasticity */
  g: number;
  opportunities: number;
}

/** The first-bet cell of a street (on the flop the texture's continuation-bet or flop-bet cell). */
export function omahaMeasuredStreetFactor(
  counters: StreetReadCounters,
  kind: OmahaOpponentKind,
  street: OmahaMeasuredStreet,
  flop: { texture: ReturnType<typeof flopTextureOf>; cbet: boolean } | null
): OmahaMeasuredStreetFactor {
  const P = OMAHA_FLOP_BETTOR_PRIOR[kind];
  let rate;
  if (street === 'flop') {
    const texture = flop?.texture ?? null;
    const line = flop?.cbet ? 'cbet' : 'flopBet';
    rate = texture
      ? omahaFlopBettorRate(counters[line][texture], P[line][texture], P.strength[line])
      : { ratio: 1, weight: 0, opportunities: 0 };
  } else
    rate = omahaFlopBettorRate(
      counters.bet[street],
      street === 'turn' ? P.turnBet : P.riverBet,
      street === 'turn' ? P.strength.turnBet : P.strength.riverBet
    );
  const g = rate.ratio === 1 ? 1 : Math.pow(rate.ratio, omahaMeasuredRangeElasticity(kind));
  return { street, ratio: rate.ratio, g, opportunities: rate.opportunities };
}

interface LineAction {
  stage: string;
  action: string;
  amount: number;
  seat: number;
  isFullRaise?: boolean;
}

/** Whether `seat` made the FIRST bet of `street` (opened the betting), from the public history. */
export function omahaMadeFirstBetOn(
  history: readonly LineAction[] | undefined,
  street: string,
  seat: number
): boolean {
  for (const a of history ?? []) {
    if (String(a.stage) !== street) continue;
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in')
      return a.seat === seat && Number(a.amount) > 0;
  }
  return false;
}

export interface OmahaMeasuredValueShare {
  /** the value share the verdict uses */
  valueShare: number;
  /** the factor applied to the stated share (1: unchanged) */
  factor: number;
  current: OmahaMeasuredStreetFactor | null;
  earlier: OmahaMeasuredStreetFactor[];
}

/**
 * The spot's value share moved by the bettor's street record. Null when there is nothing to read (no
 * well-formed record, a kind the decision does not know). With a record that holds no opportunity in the
 * cells asked the factor is exactly 1.
 */
export function omahaMeasuredValueShare(
  spot: Pick<OmahaFacingBetEvSpot, 'street' | 'isRaise' | 'valueShare' | 'bettorSeat'>,
  counters: StreetReadCounters | null | undefined,
  kind: OmahaOpponentKind | null | undefined,
  history: readonly LineAction[] | undefined,
  board: readonly Card[]
): OmahaMeasuredValueShare | null {
  if (kind !== 'person' && kind !== 'horse') return null;
  if (!counters || !validStreetRead(counters)) return null;
  const flop = {
    texture: flopTextureOf(board),
    cbet: omahaFlopBettorIsPreflopAggressor(history, spot.bettorSeat),
  };
  let factor = 1;
  const current = spot.isRaise
    ? null
    : omahaMeasuredStreetFactor(counters, kind, spot.street, null);
  if (current) factor *= current.g;
  const earlier: OmahaMeasuredStreetFactor[] = [];
  for (const st of spot.street === 'river' ? (['flop', 'turn'] as const) : (['flop'] as const)) {
    if (!omahaMadeFirstBetOn(history, st, spot.bettorSeat)) continue;
    const f = omahaMeasuredStreetFactor(counters, kind, st, st === 'flop' ? flop : null);
    earlier.push(f);
    if (f.g !== 1) factor *= Math.pow(OMAHA_MEASURED_LINE_AGGRESSOR, 1 / f.g - 1);
  }
  const valueShare =
    factor === 1 ? spot.valueShare : Math.max(0.01, Math.min(0.95, spot.valueShare * factor));
  return { valueShare, factor, current, earlier };
}

// ─────────────────────── 2. a person's first bet on his line-conditioned range ───────────────────────

/**
 * The density of r among people's first TURN bets (10 bins of r, mean 1) by earlier aggressor streets
 * (0: he did not bet or raise the flop; 1: he did) and size centre (OMAHA_PRICED_SIZE_CENTRES). Method,
 * rows and shrinkage: docs/horse-option-authority.d/omahaFacingBetValueShareIsMeasured.md, "The turn fit".
 */
/* TURN-FIT-BEGIN: the fit of 2026-11-19 (161 recorded first turn bets by 9 people, heads-up into a Horse, the
 * person's cards known at showdown; audit slices A (PLO5 Lightning, 67) and B (PLO4/PLO5 tables and PLO4 Lightning,
 * 94), 2026-11-17 to 2026-11-19; by earlier aggressor streets 0 / 1: 78 / 83 bets; one person supplies 98 of the
 * 161; SHOWDOWN-SELECTED (a bet that won uncalled is not in it), so it leans to value) */
export const OMAHA_TURN_RANGE_FIT: OmahaValueRangeFit = Object.freeze({
  byLine: [
    [
      [1.3625, 0.3093, 0.2388, 0.322, 1.2992, 0.633, 0.4744, 2.0454, 1.5576, 1.7578],
      [0.7099, 0.5833, 0.3172, 0.4759, 1.5536, 0.8725, 0.5763, 1.5761, 1.7925, 1.5427],
      [0.8002, 0.3306, 0.2242, 0.3613, 1.355, 0.7683, 0.7172, 1.7557, 1.3988, 2.2887],
      [0.9026, 0.3171, 0.274, 0.3734, 1.272, 0.8221, 0.685, 1.7581, 1.409, 2.1868],
    ],
    [
      [0.914, 0.5676, 0.134, 0.5096, 1.2367, 1.6957, 0.2102, 0.9494, 1.444, 2.3388],
      [0.5824, 0.6383, 0.2227, 0.3816, 0.9903, 0.6904, 0.2891, 1.3759, 1.8603, 2.9691],
      [0.9585, 0.3617, 0.3279, 0.2692, 0.85, 0.7095, 0.5209, 1.3042, 1.4406, 3.2573],
      [0.9175, 0.3716, 0.2592, 0.3521, 0.9076, 0.8636, 0.4343, 1.2314, 1.5307, 3.1318],
    ],
  ],
});
/* TURN-FIT-END */

/** Holdings drawn for one verdict: river and turn. */
export const OMAHA_MEASURED_RANGE_SAMPLES: Readonly<Record<'turn' | 'river', number>> = {
  turn: 700,
  river: 2000,
};
export const OMAHA_MEASURED_RANGE_TRIES_PER_SAMPLE = 60;

const key = (c: Card): string => `${c.rank}:${c.suit}`;
function seedOf(cards: readonly Card[]): number {
  let h = 2166136261;
  for (const c of cards)
    for (const ch of key(c)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
  return h >>> 0 || 1;
}
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function unseenOf(seen: readonly Card[]): Card[] {
  const s = new Set(seen.map(key));
  const out: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const c = { rank, suit } as Card;
      if (!s.has(key(c))) out.push(c);
    }
  return out;
}
/** Every two-card score of the unseen cards on a board (n x n, symmetric; -1 where a card is excluded). */
function pairTable(unseen: readonly Card[], board: Card[], skip = -1): Float64Array {
  const n = unseen.length;
  const pair = new Float64Array(n * n);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < n; i++) {
    if (i === skip) continue;
    two[0] = unseen[i];
    for (let j = i + 1; j < n; j++) {
      if (j === skip) continue;
      two[1] = unseen[j];
      const s = scoreOmahaHiPartial(two, board);
      pair[i * n + j] = s;
      pair[j * n + i] = s;
    }
  }
  return pair;
}
function bestOf(pair: Float64Array, n: number, idx: Int32Array, at: number, size: number): number {
  let r = 0;
  for (let a = 0; a < size; a++)
    for (let b = a + 1; b < size; b++) {
      const v = pair[idx[at + a] * n + idx[at + b]];
      if (v > r) r = v;
    }
  return r;
}

/** His range on this board, drawn: each holding's cards (indices into `unseen`) and score now. */
export interface OmahaMeasuredRangeDraw {
  unseen: Card[];
  holeSize: number;
  /** holdings x holeSize indices into unseen */
  holdings: Int32Array;
  /** score of each holding on the board */
  scores: Float64Array;
  /** mid-rank percentile of each holding's score in the drawn range (1 = his best) */
  r: Float64Array;
  count: number;
  preflopWidth: number;
}

/** The last few draws (the same cards give the same draw; a decision asks the same spot more than once). */
const DRAW_MEMO_SIZE = 8;
const drawMemo = new Map<string, OmahaMeasuredRangeDraw | null>();
export function omahaMeasuredRangeDraw(
  holeSize: number,
  exclude: Card[],
  board: Card[],
  preflopDepth: number,
  samples: number
): OmahaMeasuredRangeDraw | null {
  const k = `${holeSize}|${exclude.map(key).join(',')}|${board.map(key).join(',')}|${preflopDepth}|${samples}`;
  if (drawMemo.has(k)) return drawMemo.get(k) ?? null;
  const out = drawUncached(holeSize, exclude, board, preflopDepth, samples);
  if (drawMemo.size >= DRAW_MEMO_SIZE) drawMemo.delete(drawMemo.keys().next().value as string);
  drawMemo.set(k, out);
  return out;
}

function drawUncached(
  holeSize: number,
  exclude: Card[],
  board: Card[],
  preflopDepth: number,
  samples: number
): OmahaMeasuredRangeDraw | null {
  if ((holeSize !== 4 && holeSize !== 5) || !Array.isArray(board)) return null;
  if (board.length < 3 || board.length > 5) return null;
  const unseen = unseenOf([...exclude, ...board]);
  const n = unseen.length;
  if (n < holeSize + 2) return null;
  const pair = pairTable(unseen, board);
  const preflopWidth =
    preflopDepth >= 2
      ? omahaPreflopDefenceRangeWidth(
          OMAHA_VALUE_RANGE_RERAISE_RATE[holeSize as 4 | 5],
          preflopDepth
        )
      : 1;
  const lo = 1 - preflopWidth;
  const rnd = generator(seedOf([...exclude, ...board]));
  const budget = samples * OMAHA_MEASURED_RANGE_TRIES_PER_SAMPLE;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const holdings = new Int32Array(samples * holeSize);
  const scores = new Float64Array(samples);
  const cards: Card[] = new Array(holeSize);
  let got = 0;
  for (let tries = 0; got < samples && tries < budget; tries++) {
    for (let i = 0; i < holeSize; i++) {
      const j = i + Math.floor(rnd() * (n - i));
      const t = idx[i];
      idx[i] = idx[j];
      idx[j] = t;
    }
    if (lo > 1e-9) {
      for (let i = 0; i < holeSize; i++) cards[i] = unseen[idx[i]];
      if (omahaPreflopPercentile(cards, false) < lo) continue;
    }
    for (let i = 0; i < holeSize; i++) holdings[got * holeSize + i] = idx[i];
    scores[got] = bestOf(pair, n, holdings, got * holeSize, holeSize);
    got++;
  }
  if (got < samples / 2) return null;
  const order = Array.from({ length: got }, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const r = new Float64Array(got);
  for (let i = 0; i < got; ) {
    let j = i;
    while (j < got && scores[order[j]] === scores[order[i]]) j++;
    const p = (i + 0.5 * (j - i)) / got;
    for (let k = i; k < j; k++) r[order[k]] = p;
    i = j;
  }
  return {
    unseen,
    holeSize,
    holdings: holdings.slice(0, got * holeSize),
    scores: scores.slice(0, got),
    r,
    count: got,
    preflopWidth,
  };
}

/** The percentile of one holding's score in a draw (mid-rank), for the fit. */
export function omahaMeasuredRangePercentile(draw: OmahaMeasuredRangeDraw, score: number): number {
  let below = 0;
  let equal = 0;
  for (let i = 0; i < draw.count; i++)
    if (draw.scores[i] < score) below++;
    else if (draw.scores[i] === score) equal++;
  return (below + 0.5 * equal) / draw.count;
}

/** The Horse's win and tie share against each drawn holding over every river card not in it (memo per draw). */
const turnMemo = new WeakMap<
  OmahaMeasuredRangeDraw,
  { hole: string; win: Float64Array; tie: Float64Array }
>();
function turnEquity(
  draw: OmahaMeasuredRangeDraw,
  hole: Card[],
  board: Card[]
): { win: Float64Array; tie: Float64Array } {
  const hk = hole.map(key).join(',');
  const m = turnMemo.get(draw);
  if (m && m.hole === hk) return m;
  const n = draw.unseen.length;
  const H = draw.holeSize;
  const winAt = new Float64Array(draw.count);
  const tieAt = new Float64Array(draw.count);
  const valid = new Float64Array(draw.count);
  const inHolding = new Uint8Array(draw.count * n);
  for (let i = 0; i < draw.count; i++)
    for (let a = 0; a < H; a++) inHolding[i * n + draw.holdings[i * H + a]] = 1;
  for (let c = 0; c < n; c++) {
    const full = [...board, draw.unseen[c]];
    const pair = pairTable(draw.unseen, full, c);
    const hero = scoreOmahaHiPartial(hole, full);
    for (let i = 0; i < draw.count; i++) {
      if (inHolding[i * n + c]) continue;
      const s = bestOf(pair, n, draw.holdings, i * H, H);
      valid[i]++;
      if (hero > s) winAt[i]++;
      else if (hero === s) tieAt[i]++;
    }
  }
  for (let i = 0; i < draw.count; i++) {
    winAt[i] = valid[i] > 0 ? winAt[i] / valid[i] : 0;
    tieAt[i] = valid[i] > 0 ? tieAt[i] / valid[i] : 0;
  }
  const out = { hole: hk, win: winAt, tie: tieAt };
  turnMemo.set(draw, out);
  return out;
}

export interface OmahaMeasuredRangeVerdict {
  call: boolean;
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  price: number;
  realization: number;
  /** the tilt exponent applied to the density (1 / g); 1: the population's density */
  tilt: number;
  preflopWidth: number;
  samples: number;
}

/**
 * The verdict against the drawn range weighted by the fitted density (tilted by 1 / g). On the river the
 * Horse wins the holdings it beats; on the turn its share over every river card that is not in the holding.
 */
export function omahaMeasuredRangeVerdictOf(
  draw: OmahaMeasuredRangeDraw,
  hole: Card[],
  board: Card[],
  line: { aggressorStreets: number },
  spot: { potFrac: number; paid: number; winnable: number; final: boolean },
  ctx: { rake?: number; margin: number; realization: number; g: number },
  fit: OmahaValueRangeFit
): OmahaMeasuredRangeVerdict {
  const tilt = ctx.g > 0 && Number.isFinite(ctx.g) ? 1 / ctx.g : 1;
  const weight = new Float64Array(draw.count);
  let total = 0;
  for (let i = 0; i < draw.count; i++) {
    const d = Math.max(
      0,
      omahaValueRangeDensity(draw.r[i], line.aggressorStreets, spot.potFrac, fit)
    );
    weight[i] = tilt === 1 ? d : Math.pow(d, tilt);
    total += weight[i];
  }
  let w = 0;
  let t = 0;
  if (board.length === 5) {
    const hero = scoreOmahaHiPartial(hole, board);
    for (let i = 0; i < draw.count; i++) {
      if (hero > draw.scores[i]) w += weight[i];
      else if (hero === draw.scores[i]) t += weight[i];
    }
  } else {
    const eq = turnEquity(draw, hole, board);
    for (let i = 0; i < draw.count; i++) {
      w += weight[i] * eq.win[i];
      t += weight[i] * eq.tie[i];
    }
  }
  const realization = spot.final ? 1 : Math.max(0.3, Math.min(1, ctx.realization));
  const pWin = total > 0 ? (w / total) * realization : 0;
  const pTie = total > 0 ? (t / total) * realization : 0;
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? (ctx.rake as number) : 0));
  const win = spot.winnable * (1 - rake);
  const pLose = Math.max(0, 1 - pWin - pTie);
  const ev = pWin * win + pTie * ((win - spot.paid) / 2) - pLose * spot.paid;
  return {
    call: ev > ctx.margin,
    ev,
    margin: ctx.margin,
    pWin,
    pTie,
    price: spot.paid / (spot.winnable + spot.paid),
    realization,
    tilt,
    preflopWidth: draw.preflopWidth,
    samples: draw.count,
  };
}

/** The spot part 2 prices (the caller adds: PLO4/PLO5 cash, a person's bet). */
export function omahaMeasuredRangeSpotCovered(
  spot: OmahaFacingBetEvSpot,
  hole: Card[],
  board: Card[]
): boolean {
  const fit = spot.street === 'river' ? OMAHA_VALUE_RANGE_FIT : OMAHA_TURN_RANGE_FIT;
  return (
    spot.callers === 0 &&
    spot.allIns === 0 &&
    spot.behind === 0 &&
    fit.byLine.length > 0 &&
    Array.isArray(hole) &&
    (hole.length === 4 || hole.length === 5) &&
    Array.isArray(board) &&
    board.length === (spot.street === 'river' ? 5 : 4)
  );
}

/**
 * Part 2's entry: the facing-bet verdict of a covered spot priced on the bettor's line-conditioned measured
 * range, or null outside the spot or when the range cannot be drawn (the base verdict then stands).
 * `base` is the facing-bet verdict of the same decision: its margin and turn realization are used here,
 * and every field this module does not price is carried from it. `g` is his street factor (1: none).
 */
export function omahaFacingBetMeasuredRangeOver(
  spot: OmahaFacingBetEvSpot,
  base: OmahaFacingBetEvVerdict,
  hole: Card[],
  board: Card[],
  dead: Card[],
  history: readonly LineAction[] | undefined,
  rake: number,
  g = 1
): (OmahaFacingBetEvVerdict & { measuredRange: OmahaMeasuredRangeVerdict }) | null {
  if (!omahaMeasuredRangeSpotCovered(spot, hole, board)) return null;
  const fit = spot.street === 'river' ? OMAHA_VALUE_RANGE_FIT : OMAHA_TURN_RANGE_FIT;
  const preflopDepth = omahaValueRangePreflopDepth(history, spot.bettorSeat);
  const draw = omahaMeasuredRangeDraw(
    hole.length,
    [...hole, ...(dead ?? [])],
    board,
    preflopDepth,
    OMAHA_MEASURED_RANGE_SAMPLES[spot.street]
  );
  if (!draw) return null;
  const v = omahaMeasuredRangeVerdictOf(
    draw,
    hole,
    board,
    {
      // A raise has no measured row: it takes the most aggressive measured line (STATED, not measured).
      aggressorStreets: spot.isRaise
        ? fit.byLine.length - 1
        : Math.max(0, Math.min(fit.byLine.length - 1, spot.aggressorStreets | 0)),
    },
    spot,
    { rake, margin: base.margin, realization: base.realization, g },
    fit
  );
  return {
    ...base,
    call: v.call,
    ev: v.ev,
    pWin: v.pWin,
    pTie: v.pTie,
    field: 1,
    realization: v.realization,
    measuredRange: v,
  };
}
