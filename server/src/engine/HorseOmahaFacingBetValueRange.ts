/**
 * OMAHA FACING-BET VALUE REGION FROM HIS RANGE (2026-11-18, lane VALUE-REGION;
 * option omahaFacingBetValueIsRangeRelative, default OFF, read `=== true`).
 *
 * Hand #59993188 (PLO5 1/2 cash): a Horse held the ace-high flush on the river
 * of 3c Td 2s Qs 3s and folded to a person's bet at a price of 26.0 percent.
 * The facing-bet expected value (HorseOmahaFacingBetEv) defines the bettor's
 * value bets as "the strongest share of ALL holdings" (OMAHA_EV_VALUE_SHARE
 * times the line factors: 0.192 here). On that board 23.6 percent of random
 * holdings make a full house, so the value region held only full houses, and
 * the verdict saw the nut flush beat nothing but the bluff share. That is the
 * general cause: the value region is a fixed percentile of random holdings,
 * not the hands this player bets on this board after this line.
 *
 * This module replaces that one input, in one spot, by a measured betting
 * range:
 *
 *  RANGE    His holdings are drawn from the unseen cards (the Horse's cards,
 *           the board and dead cards removed: the Horse's blockers are exact),
 *           with a deterministic generator seeded by the cards (no draw from
 *           the brain's random stream: the same cards give the same answer).
 *           Before the flop, when he re-raised (a 3-bet or more), the holdings
 *           are the top `width` by the engine's preflop percentile, the width
 *           the engine's preflop re-raise defence uses for a person at the
 *           measured population rate (omahaPreflopDefenceRangeWidth); an open
 *           or a call does not narrow it.
 *  STRENGTH Each holding's strength is its percentile r in that range on THIS
 *           river board (mid-rank for ties): 1 is the best holding he can
 *           have, whatever the board.
 *  BETS     Which r he bets is MEASURED, not assumed: the density of r among
 *           the river bets people actually made, heads-up into a Horse, with
 *           their cards known (OMAHA_VALUE_RANGE_FIT), by the number of
 *           earlier postflop streets he bet or raised and by the bet's share
 *           of the pot (read continuously between the four size centres of
 *           OMAHA_PRICED_SIZE_CENTRES). His bluffs are inside that density
 *           (the mass at low r): there is no separate bluff prior and no
 *           value percentile.
 *  PRICE    P(win), P(tie) = the density-weighted share of his holdings the
 *           Horse beats, ties; EV(call) = P(win) x what the call wins after
 *           rake + P(tie) x the split - P(lose) x the call; the call is made
 *           when it exceeds the facing-bet rule's one margin (the same margin
 *           the base verdict used).
 *
 * The spot (HorseLogic asks only then): PLO4 / PLO5 cash, one board, the
 * river, heads-up, the first bet of the street (not a raise), made by a
 * person (the density is measured on people). Every other spot keeps the
 * facing-bet verdict as it is. Option off: nothing here runs.
 *
 * Pure: no telemetry, no opponent memory, nothing keyed to a player.
 */
import type { Card } from '../types.js';
import { omahaPreflopPercentile, scoreOmahaHiPartial } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';
import type { OmahaFacingBetEvSpot, OmahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import { OMAHA_PRICED_SIZE_CENTRES } from './HorseOmahaPricedMode.js';
import { omahaPreflopDefenceRangeWidth } from './HorseOmahaPreflopReraiseDefence.js';

/** Bettor holdings drawn for one verdict, and the tries allowed per holding (the preflop cut rejects). */
export const OMAHA_VALUE_RANGE_SAMPLES = 2000;
export const OMAHA_VALUE_RANGE_TRIES_PER_SAMPLE = 60;
/** Bins of the strength percentile r in the fitted density. */
export const OMAHA_VALUE_RANGE_BINS = 10;

/**
 * A person's measured re-raise rate by game, the rate the engine's preflop
 * re-raise defence was fitted on (HorseOmahaPreflopReraiseDefence: 0.117 for
 * PLO4 people over 576 recorded re-raising hands, 0.224 for PLO5 people over
 * 414). Through omahaPreflopDefenceRangeWidth they give a 3-bet width of
 * 0.40 / 0.50 and a 4-bet width of 0.28 / 0.38.
 */
export const OMAHA_VALUE_RANGE_RERAISE_RATE: Readonly<Record<4 | 5, number>> = {
  4: 0.117,
  5: 0.224,
};

/**
 * The density of r among a person's river bets: `byLine[a][s]` is the
 * density (OMAHA_VALUE_RANGE_BINS bins, mean 1) for a bettor who bet or
 * raised `a` earlier postflop streets (0, 1, 2) at size centre s of
 * OMAHA_PRICED_SIZE_CENTRES. Method, rows and shrinkage: the option's
 * authority file, section "The fit".
 */
export interface OmahaValueRangeFit {
  byLine: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>;
}

/* FIT-BEGIN: the full fit of 2026-11-18 (1201 recorded river bets by people, heads-up into a Horse, first bet
 * of the river, cards known from the hand facts; 2026-10-19 to 2026-11-18; by earlier aggressor streets 0 / 1 / 2:
 * 531 / 455 / 215 bets; docs/horse-option-authority.d/omahaFacingBetValueIsRangeRelative.md, section "The fit") */
export const OMAHA_VALUE_RANGE_FIT: OmahaValueRangeFit = Object.freeze({
  byLine: [
    [
      [0.4262, 0.3841, 0.6292, 0.4886, 0.5826, 0.6979, 1.343, 1.9743, 1.4918, 1.9823],
      [0.4475, 0.3602, 0.4053, 0.3234, 0.4937, 0.7194, 0.7756, 1.7157, 2.2809, 2.4782],
      [0.6225, 0.5855, 0.4599, 0.3272, 0.3071, 0.5247, 0.5467, 1.0339, 2.0016, 3.5909],
      [0.5797, 0.5299, 0.4646, 0.3823, 0.2843, 0.5446, 0.7052, 1.1441, 2.0818, 3.2835],
    ],
    [
      [0.3548, 0.5523, 0.4946, 0.602, 0.1686, 0.5806, 0.911, 1.7378, 1.9554, 2.643],
      [0.5547, 0.9675, 0.3312, 0.4033, 0.4548, 0.3764, 0.7253, 1.2383, 2.3517, 2.5968],
      [0.4438, 0.7038, 0.57, 0.2711, 0.3058, 0.2017, 0.3503, 0.7759, 2.1384, 4.2392],
      [0.403, 0.7232, 0.4984, 0.3268, 0.3056, 0.2627, 0.4393, 0.9297, 2.1337, 3.9777],
    ],
    [
      [0.2095, 0.379, 0.0942, 0.5132, 0.9147, 0.6055, 0.8236, 1.5656, 2.6654, 2.2292],
      [0.235, 0.5803, 0.5138, 0.3954, 0.1098, 0.3975, 0.3848, 1.2953, 2.4068, 3.6813],
      [0.5958, 0.3247, 0.3528, 0.3853, 0.1704, 0.2715, 0.2558, 0.467, 2.2149, 4.9619],
      [0.6102, 0.3305, 0.2993, 0.3182, 0.3488, 0.4521, 0.4322, 0.8945, 2.3414, 3.9727],
    ],
  ],
});
/* FIT-END */

let fitInForce: OmahaValueRangeFit = OMAHA_VALUE_RANGE_FIT;
/** The fit the rule reads (OMAHA_VALUE_RANGE_FIT outside withOmahaValueRangeFit). */
export function omahaValueRangeFitNow(): OmahaValueRangeFit {
  return fitInForce;
}
/**
 * Evaluation seam: run fn with another fit in force (a cross-fitted or
 * out-of-sample fit for an offline replay). No rule calls it.
 */
export function withOmahaValueRangeFit<T>(fit: OmahaValueRangeFit, fn: () => T): T {
  const before = fitInForce;
  fitInForce = fit;
  try {
    return fn();
  } finally {
    fitInForce = before;
  }
}

/** The bettor's public line this hand. */
export interface OmahaValueRangeLine {
  /** his deepest preflop raise: 0 none, 1 an open, 2 a 3-bet, 3 a 4-bet ... */
  preflopDepth: number;
  /** earlier postflop streets (flop, turn) on which he bet or raised: 0, 1 or 2 */
  aggressorStreets: number;
}

interface LineAction {
  stage: string;
  action: string;
  amount: number;
  seat: number;
  isFullRaise?: boolean;
}

/** His deepest preflop raise level from the public action history. */
export function omahaValueRangePreflopDepth(
  history: readonly LineAction[] | undefined,
  bettorSeat: number
): number {
  let depth = 0;
  let mine = 0;
  for (const a of history ?? []) {
    if (String(a.stage) !== 'preflop') continue;
    if (
      a.action === 'raise' ||
      a.action === 'bet' ||
      (a.action === 'all_in' && a.isFullRaise !== undefined)
    ) {
      depth++;
      if (a.seat === bettorSeat) mine = depth;
    }
  }
  return mine;
}

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

/**
 * His range on this river, drawn: the score of each drawn holding on the
 * final board, sorted ascending, and the preflop width used. Null when the
 * cards are not a four- or five-card river hand or too few holdings could be
 * drawn. `exclude` are the cards he cannot hold (the Horse's, dead cards).
 */
export interface OmahaValueRangeDraw {
  scores: Float64Array;
  preflopWidth: number;
  tries: number;
}

export function omahaValueRangeDraw(
  holeSize: number,
  exclude: Card[],
  board: Card[],
  preflopDepth: number
): OmahaValueRangeDraw | null {
  if ((holeSize !== 4 && holeSize !== 5) || !Array.isArray(board) || board.length !== 5)
    return null;
  const unseen = unseenOf([...exclude, ...board]);
  const n = unseen.length;
  if (n < holeSize + 2) return null;
  const pair = new Float64Array(n * n);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < n; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < n; j++) {
      two[1] = unseen[j];
      const s = scoreOmahaHiPartial(two, board);
      pair[i * n + j] = s;
      pair[j * n + i] = s;
    }
  }
  const preflopWidth =
    preflopDepth >= 2
      ? omahaPreflopDefenceRangeWidth(
          OMAHA_VALUE_RANGE_RERAISE_RATE[holeSize as 4 | 5],
          preflopDepth
        )
      : 1;
  const lo = 1 - preflopWidth;
  const rnd = generator(seedOf([...exclude, ...board]));
  const want = OMAHA_VALUE_RANGE_SAMPLES;
  const budget = want * OMAHA_VALUE_RANGE_TRIES_PER_SAMPLE;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const scores = new Float64Array(want);
  const cards: Card[] = new Array(holeSize);
  let got = 0;
  let tries = 0;
  for (; got < want && tries < budget; tries++) {
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
    let r = 0;
    for (let a = 0; a < holeSize; a++)
      for (let b = a + 1; b < holeSize; b++) {
        const v = pair[idx[a] * n + idx[b]];
        if (v > r) r = v;
      }
    scores[got++] = r;
  }
  if (got < want / 2) return null;
  const out = scores.slice(0, got).sort();
  return { scores: out, preflopWidth, tries };
}

/** The percentile (mid-rank) of `score` among the sorted drawn scores. */
export function omahaValueRangePercentile(sorted: Float64Array, score: number): number {
  const n = sorted.length;
  if (n === 0) return 0.5;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] < score) lo = m + 1;
    else hi = m;
  }
  const below = lo;
  hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] <= score) lo = m + 1;
    else hi = m;
  }
  const equal = lo - below;
  return (below + 0.5 * equal) / n;
}

/** The fitted density at strength r for this line and size (linear between bin centres and size centres). */
export function omahaValueRangeDensity(
  r: number,
  aggressorStreets: number,
  potFrac: number,
  fit: OmahaValueRangeFit = fitInForce
): number {
  const rows = fit.byLine[Math.max(0, Math.min(fit.byLine.length - 1, aggressorStreets | 0))];
  if (!rows || rows.length !== 4) return 1;
  const B = rows[0].length;
  const atBin = (row: ReadonlyArray<number>): number => {
    const x = Math.max(0, Math.min(1, Number.isFinite(r) ? r : 0.5)) * B - 0.5;
    if (x <= 0) return row[0];
    if (x >= B - 1) return row[B - 1];
    const i = Math.floor(x);
    return row[i] + (row[i + 1] - row[i]) * (x - i);
  };
  const c = OMAHA_PRICED_SIZE_CENTRES;
  if (!Number.isFinite(potFrac) || potFrac <= c[0]) return atBin(rows[0]);
  for (let i = 1; i < 4; i++)
    if (potFrac <= c[i]) {
      const w = (potFrac - c[i - 1]) / (c[i] - c[i - 1]);
      return atBin(rows[i - 1]) * (1 - w) + atBin(rows[i]) * w;
    }
  return atBin(rows[3]);
}

export interface OmahaValueRangeVerdict {
  call: boolean;
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  price: number;
  /** the Horse's own strength percentile in his range on this board */
  heroR: number;
  preflopWidth: number;
  samples: number;
}

/**
 * The priced verdict against the drawn range weighted by the fitted density.
 * `margin` is in chips (the facing-bet rule's one margin for this pot).
 */
export function omahaValueRangeVerdictOf(
  draw: OmahaValueRangeDraw,
  heroScore: number,
  line: OmahaValueRangeLine,
  spot: { potFrac: number; paid: number; winnable: number },
  ctx: { rake?: number; margin: number },
  fit: OmahaValueRangeFit = fitInForce
): OmahaValueRangeVerdict {
  const s = draw.scores;
  const n = s.length;
  let total = 0;
  let w = 0;
  let t = 0;
  // Holdings with the same score share one percentile (mid-rank).
  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && s[j] === s[i]) j++;
    const r = (i + 0.5 * (j - i)) / n;
    const d = Math.max(0, omahaValueRangeDensity(r, line.aggressorStreets, spot.potFrac, fit));
    const mass = d * (j - i);
    total += mass;
    if (heroScore > s[i]) w += mass;
    else if (heroScore === s[i]) t += mass;
    i = j;
  }
  const pWin = total > 0 ? w / total : 0;
  const pTie = total > 0 ? t / total : 0;
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
    heroR: omahaValueRangePercentile(s, heroScore),
    preflopWidth: draw.preflopWidth,
    samples: n,
  };
}

/** The spot this module prices (the caller adds: PLO4/PLO5 cash, a person's bet). */
export function omahaValueRangeSpotCovered(
  spot: OmahaFacingBetEvSpot,
  hole: Card[],
  board: Card[]
): boolean {
  return (
    spot.street === 'river' &&
    !spot.isRaise &&
    spot.callers === 0 &&
    spot.allIns === 0 &&
    spot.behind === 0 &&
    Array.isArray(hole) &&
    (hole.length === 4 || hole.length === 5) &&
    Array.isArray(board) &&
    board.length === 5
  );
}

/**
 * The rule's one entry: the facing-bet verdict of a covered spot priced on
 * his measured betting range; null outside the spot or when the range cannot
 * be drawn (the facing-bet verdict then stands as it is). `base` is the
 * facing-bet verdict of the same decision: its margin is the margin here, and
 * every field this module does not price is carried from it.
 */
export function omahaFacingBetValueRangeOver(
  spot: OmahaFacingBetEvSpot,
  base: OmahaFacingBetEvVerdict,
  hole: Card[],
  board: Card[],
  dead: Card[],
  history: readonly LineAction[] | undefined,
  rake: number,
  fit: OmahaValueRangeFit = fitInForce
): (OmahaFacingBetEvVerdict & { valueRange: OmahaValueRangeVerdict }) | null {
  if (!omahaValueRangeSpotCovered(spot, hole, board)) return null;
  if (!(fit.byLine.length > 0)) return null;
  const line: OmahaValueRangeLine = {
    preflopDepth: omahaValueRangePreflopDepth(history, spot.bettorSeat),
    aggressorStreets: Math.max(0, Math.min(2, spot.aggressorStreets | 0)),
  };
  const draw = omahaValueRangeDraw(
    hole.length,
    [...hole, ...(dead ?? [])],
    board,
    line.preflopDepth
  );
  if (!draw) return null;
  const heroScore = scoreOmahaHiPartial(hole, board);
  if (!(heroScore > 0)) return null;
  const v = omahaValueRangeVerdictOf(
    draw,
    heroScore,
    line,
    spot,
    { rake, margin: base.margin },
    fit
  );
  return {
    ...base,
    call: v.call,
    ev: v.ev,
    pWin: v.pWin,
    pTie: v.pTie,
    field: 1,
    realization: 1,
    valueRange: v,
  };
}
