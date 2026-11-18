/**
 * RANGE CALIBRATION OF THE OMAHA PRICED RULES (2026-11-17, PLO Strategy lane).
 *
 * A priced comparison is only as good as the range it assumes. This scorer
 * compares, for a bet a Horse faced where the bettor's cards are public (a
 * showdown), the range the facing-bet comparison ASSUMED for that bet, street
 * and board (a value region of the strongest share of holdings, and a bluff
 * share) with what the bettor HELD: inside the value region, or outside it
 * (on the turn: a draw, or neither).
 *
 * The bettor's place is taken on the board as it stood when he bet, among
 * the holdings the Horse could not see (its own cards and the board removed),
 * by a seeded sample of holdings: the share of them that score above his.
 * He is in the value region when that share is below the region's.
 *
 * Offline only: no decision reads this file. The driver that feeds it the
 * recorded hands is kept with the evidence
 * (archive plo-handoff-review-01a1cbbd/priced-01BNteGZ/calibration).
 */
import type { Card } from '../types.js';
import { omahaDrawQuality, scoreOmahaHiPartial } from '../engine/HorseEval.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The share of holdings (of the bettor's size, drawn from the cards the Horse
 * does not see) that score above the bettor's hand on this board. Seeded:
 * the same cards give the same number.
 */
export function omahaHoldingShareAbove(
  bettorHole: readonly Card[],
  board: readonly Card[],
  horseHole: readonly Card[],
  samples = 4000
): number {
  const seen = new Set([...horseHole, ...board].map(key));
  const deck: Card[] = [];
  for (const rank of RANKS)
    for (const suit of SUITS) {
      const c = { rank, suit } as Card;
      if (!seen.has(key(c))) deck.push(c);
    }
  const mine = scoreOmahaHiPartial([...bettorHole], [...board]);
  let seed = 0x9e3779b9;
  for (const c of [...board, ...horseHole])
    seed = Math.imul(seed ^ key(c).charCodeAt(0), 0x01000193) ^ key(c).length;
  const rnd = mulberry32(seed);
  const n = bettorHole.length;
  let above = 0;
  for (let k = 0; k < samples; k++) {
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    if (scoreOmahaHiPartial(deck.slice(0, n), [...board]) > mine) above++;
  }
  return above / samples;
}

export type OmahaHeldClass = 'value' | 'draw' | 'other';

/** What the bettor held, beside the value region the comparison assumed. */
export function omahaHeldClass(
  bettorHole: readonly Card[],
  board: readonly Card[],
  horseHole: readonly Card[],
  valueShare: number
): OmahaHeldClass {
  if (omahaHoldingShareAbove(bettorHole, board, horseHole) < valueShare) return 'value';
  if (board.length === 4) {
    const d = omahaDrawQuality([...bettorHole], [...board], false);
    if (d.nutFlushDraw || d.dominatedFlushDraw || d.straightOuts >= 8) return 'draw';
  }
  return 'other';
}

export interface OmahaCalibrationRow {
  /** the group the row is scored in, for example "river|70-110|paired" */
  group: string;
  /** the comparison's assumed share of his bets that are value (1 - bluff share) */
  assumedValue: number;
  held: OmahaHeldClass;
}
export interface OmahaCalibrationScore {
  group: string;
  n: number;
  assumedValue: number;
  observedValue: number;
  observedDraw: number;
  observedOther: number;
  /** assumed minus observed value share */
  gap: number;
}

/** Per group: the mean assumed value share beside the observed shares, with the count. */
export function omahaCalibrationScores(
  rows: readonly OmahaCalibrationRow[]
): OmahaCalibrationScore[] {
  const groups = new Map<string, OmahaCalibrationRow[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([group, rs]) => {
      const n = rs.length;
      const share = (c: OmahaHeldClass) => rs.filter((r) => r.held === c).length / n;
      const assumedValue = rs.reduce((s, r) => s + r.assumedValue, 0) / n;
      return {
        group,
        n,
        assumedValue,
        observedValue: share('value'),
        observedDraw: share('draw'),
        observedOther: share('other'),
        gap: assumedValue - share('value'),
      };
    });
}

/** The count-weighted mean absolute gap over the groups: one number to compare two range models on the same bets. */
export function omahaCalibrationError(scores: readonly OmahaCalibrationScore[]): number {
  const n = scores.reduce((s, x) => s + x.n, 0);
  return n > 0 ? scores.reduce((s, x) => s + x.n * Math.abs(x.gap), 0) / n : 0;
}

/** One faced bet for the win-share calibration: what the comparison predicted beside what the Horse won. */
export interface OmahaWinShareRow {
  /** the Horse's share against his real cards (the turn: over every river card neither holds) */
  actual: number;
  /** the comparison's win share against its value region and against the rest of his range */
  vsValue: number;
  vsOther: number;
}

/**
 * The bluff share q that makes the comparison's mean predicted win share,
 * q x vsOther + (1 - q) x vsValue, equal the mean share the Horse actually
 * won. Null when the two regions cannot be told apart.
 */
export function omahaWinShareBluffFit(rows: readonly OmahaWinShareRow[]): number | null {
  if (rows.length === 0) return null;
  const mean = (f: (r: OmahaWinShareRow) => number) =>
    rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const actual = mean((r) => r.actual);
  const v = mean((r) => r.vsValue);
  const o = mean((r) => r.vsOther);
  return Math.abs(o - v) < 1e-9 ? null : (actual - v) / (o - v);
}

/** A measured share shrunk toward the prior it replaces, the prior counting `k` pseudo-bets. */
export function omahaShrunkShare(measured: number, n: number, prior: number, k: number): number {
  return (measured * n + prior * k) / (n + k);
}
