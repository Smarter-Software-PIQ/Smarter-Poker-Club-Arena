/**
 * FIXED-LIMIT POPULATION CELLS (2026-11-16, Fixed-Limit lane, option fixedLimitPopulationCells): the measurement
 * that rebuilds FIXED_LIMIT_POPULATION_ENVELOPE (HorseOpponentExploit.ts) from recorded Horse-only fixed-limit cash
 * hands. Measurement only: it reads public actions (who acted, on which street, what they did) and never a card.
 *
 * Every hand goes through exploitHandIncrements() - the exact code the live counters use - and is counted in the
 * cell `${variant}:${size}` of its own game and dealt size (hu <= 2, short 3-5, full >= 6, as readScopeOf). For
 * each statistic: the pooled Horse rate is the cell mean; the band is the 1st and 99th percentiles of per-Horse
 * rates among Horses with 40+ opportunities when 30 or more Horses qualify (P1-P99); else the pooled rate plus or
 * minus 2.33 between-Horse standard deviations from a method-of-moments beta-binomial fit over Horses with 3+
 * opportunities, the half-width floored at 0.08 (moments, when 10 or more such Horses); else, with 3-9 such Horses,
 * the pooled rate plus or minus 0.20 (sparse). The same band rule as OPPONENT_EXPLOIT_ENVELOPE (2026-10-16), applied
 * per fixed-limit game and table size, and a statistic is NEVER borrowed from another size or a family cell: a cell
 * with a statistic no rule can measure is reported as unmeasured and the table is not built.
 *
 * Alongside the cells it returns, for the census law, every Horse's final decayed counters per cell, built hand by
 * hand in recorded order exactly as the in-process learner builds them (HorseMind.observe: exploitHandIncrements with
 * the individual-fold path, observeExploitRow with opportunity-scoped decay and the long participation window), so a
 * law can replay the census through the style read at the Horses' observed hand counts.
 */
import {
  EXPLOIT_STATS,
  EXPLOIT_STAT_FIELDS,
  exploitHandIncrements,
  freshExploitCounters,
  observeExploitRow,
  type ExploitCounters,
  type ExploitCountersWithLong,
  type ExploitHandAction,
  type ExploitStat,
} from '../engine/HorseOpponentExploit.js';

export const FIXED_LIMIT_POPULATION_VARIANTS = ['flh', 'flo8'] as const;
export const FIXED_LIMIT_POPULATION_SIZES = ['hu', 'short', 'full'] as const;
export type FixedLimitPopulationSize = (typeof FIXED_LIMIT_POPULATION_SIZES)[number];

export interface FixedLimitPopulationHand {
  id: string;
  variant: string;
  /** dealt seats (players array length) */
  n: number;
  uids: readonly (string | null)[];
  actions: readonly ExploitHandAction[] | null;
}

export type BandRule = 'p1_p99' | 'moments' | 'sparse' | 'unmeasured';

export interface MeasuredStat {
  mean: number;
  lo: number;
  hi: number;
  rule: BandRule;
  /** pooled successes and opportunities */
  successes: number;
  opportunities: number;
  /** Horses with 40+ (p1_p99) or 3+ (moments, sparse) opportunities */
  horses: number;
}

export interface MeasuredCell {
  cell: string;
  hands: number;
  seatHands: number;
  horses: number;
  stats: Record<ExploitStat, MeasuredStat>;
}

export interface FixedLimitPopulationMeasurement {
  cells: MeasuredCell[];
  handsRead: number;
  handsUsed: number;
  /** hands skipped because a seat was not a Horse or the variant is not fixed limit */
  handsSkipped: { notFixedLimit: number; notHorseOnly: number; noActions: number };
  /** final decayed counters per (cell, Horse), recorded order, with the long participation window */
  decayed: Map<string, Map<string, ExploitCountersWithLong>>;
}

export const sizeOfDealt = (n: number): FixedLimitPopulationSize =>
  n <= 2 ? 'hu' : n <= 5 ? 'short' : 'full';

const P1P99_MIN_OPPS = 40;
const P1P99_MIN_HORSES = 30;
const MOMENTS_MIN_OPPS = 3;
const MOMENTS_MIN_HORSES = 10;
const SPARSE_MIN_HORSES = 3;
const MOMENTS_Z = 2.33;
const MOMENTS_FLOOR = 0.08;
const SPARSE_HALF = 0.2;

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Linear-interpolation percentile (type 7) of a sorted array. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Between-Horse standard deviation of the true rates (method of moments, beta-binomial). */
export function momentsSd(rows: readonly (readonly [s: number, n: number])[]): number {
  const N = rows.reduce((a, [, n]) => a + n, 0);
  const S = rows.reduce((a, [s]) => a + s, 0);
  const k = rows.length;
  if (k < 2 || N <= 0) return 0;
  const p = S / N;
  const ss = rows.reduce((a, [s, n]) => a + n * (s / n - p) ** 2, 0);
  const denom = N - rows.reduce((a, [, n]) => a + n * n, 0) / N;
  if (!(denom > 0)) return 0;
  const tau2 = Math.max(0, (ss - (k - 1) * p * (1 - p)) / denom);
  return Math.sqrt(tau2);
}

export function bandOf(perHorse: readonly (readonly [s: number, n: number])[]): MeasuredStat {
  const successes = perHorse.reduce((a, [s]) => a + s, 0);
  const opportunities = perHorse.reduce((a, [, n]) => a + n, 0);
  const mean = opportunities > 0 ? successes / opportunities : NaN;
  const qualified = perHorse.filter(([, n]) => n >= P1P99_MIN_OPPS);
  if (qualified.length >= P1P99_MIN_HORSES) {
    const rates = qualified.map(([s, n]) => s / n).sort((a, b) => a - b);
    return {
      mean: round4(mean),
      lo: round4(clamp01(percentile(rates, 0.01))),
      hi: round4(clamp01(percentile(rates, 0.99))),
      rule: 'p1_p99',
      successes,
      opportunities,
      horses: qualified.length,
    };
  }
  const some = perHorse.filter(([, n]) => n >= MOMENTS_MIN_OPPS);
  if (some.length >= MOMENTS_MIN_HORSES) {
    const half = Math.max(MOMENTS_Z * momentsSd(some), MOMENTS_FLOOR);
    return {
      mean: round4(mean),
      lo: round4(clamp01(mean - half)),
      hi: round4(clamp01(mean + half)),
      rule: 'moments',
      successes,
      opportunities,
      horses: some.length,
    };
  }
  if (some.length >= SPARSE_MIN_HORSES) {
    return {
      mean: round4(mean),
      lo: round4(clamp01(mean - SPARSE_HALF)),
      hi: round4(clamp01(mean + SPARSE_HALF)),
      rule: 'sparse',
      successes,
      opportunities,
      horses: some.length,
    };
  }
  return {
    mean: Number.isFinite(mean) ? round4(mean) : NaN,
    lo: NaN,
    hi: NaN,
    rule: 'unmeasured',
    successes,
    opportunities,
    horses: some.length,
  };
}

/** Measure every fixed-limit cell from hands given in recorded order. */
export function measureFixedLimitPopulation(
  hands: Iterable<FixedLimitPopulationHand>,
  isHorse: (id: string) => boolean
): FixedLimitPopulationMeasurement {
  const raw = new Map<string, Map<string, ExploitCounters>>();
  const decayed = new Map<string, Map<string, ExploitCountersWithLong>>();
  const cellHands = new Map<string, number>();
  const cellSeatHands = new Map<string, number>();
  const skipped = { notFixedLimit: 0, notHorseOnly: 0, noActions: 0 };
  let handsRead = 0;
  let handsUsed = 0;
  for (const h of hands) {
    handsRead++;
    const variant = String(h.variant ?? '').toLowerCase();
    if (!(FIXED_LIMIT_POPULATION_VARIANTS as readonly string[]).includes(variant)) {
      skipped.notFixedLimit++;
      continue;
    }
    const uids = (h.uids ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (uids.length === 0 || uids.some((u) => !isHorse(u))) {
      skipped.notHorseOnly++;
      continue;
    }
    if (!h.actions || h.actions.length === 0) {
      skipped.noActions++;
      continue;
    }
    const cell = `${variant}:${sizeOfDealt(h.n)}`;
    const increments = exploitHandIncrements(h.actions);
    let rawCell = raw.get(cell);
    if (!rawCell) raw.set(cell, (rawCell = new Map()));
    let decCell = decayed.get(cell);
    if (!decCell) decayed.set(cell, (decCell = new Map()));
    for (const [uid, inc] of increments) {
      if (!isHorse(uid)) continue;
      let r = rawCell.get(uid);
      if (!r) rawCell.set(uid, (r = freshExploitCounters()));
      for (const k of Object.keys(inc) as (keyof ExploitCounters)[]) r[k] += inc[k];
      cellSeatHands.set(cell, (cellSeatHands.get(cell) ?? 0) + 1);
    }
    // The learner's own path (HorseMind.observe): individual-fold increments, opportunity-scoped decay, long window.
    for (const [uid, inc] of exploitHandIncrements(h.actions, true))
      if (isHorse(uid)) observeExploitRow(decCell, uid, inc, Number.MAX_SAFE_INTEGER, true);
    cellHands.set(cell, (cellHands.get(cell) ?? 0) + 1);
    handsUsed++;
  }
  const cells: MeasuredCell[] = [];
  for (const variant of FIXED_LIMIT_POPULATION_VARIANTS)
    for (const size of FIXED_LIMIT_POPULATION_SIZES) {
      const cell = `${variant}:${size}`;
      const rows = raw.get(cell) ?? new Map<string, ExploitCounters>();
      const stats = Object.fromEntries(
        EXPLOIT_STATS.map((stat) => {
          const [sField, nField] = EXPLOIT_STAT_FIELDS[stat];
          const perHorse = [...rows.values()]
            .map((r) => [r[sField], r[nField]] as const)
            .filter(([, n]) => n > 0);
          return [stat, bandOf(perHorse)];
        })
      ) as Record<ExploitStat, MeasuredStat>;
      cells.push({
        cell,
        hands: cellHands.get(cell) ?? 0,
        seatHands: cellSeatHands.get(cell) ?? 0,
        horses: rows.size,
        stats,
      });
    }
  return { cells, handsRead, handsUsed, handsSkipped: skipped, decayed };
}

/** The TypeScript rows for FIXED_LIMIT_POPULATION_ENVELOPE; throws when a statistic is unmeasured. */
export function envelopeSource(cells: readonly MeasuredCell[]): string {
  const lines: string[] = [];
  for (const c of cells) {
    const bad = EXPLOIT_STATS.filter((s) => c.stats[s].rule === 'unmeasured');
    if (bad.length)
      throw new Error(`fixed-limit population cell ${c.cell}: unmeasured ${bad.join(', ')}`);
    lines.push(`  '${c.cell}': row(`);
    EXPLOIT_STATS.forEach((s, i) => {
      const m = c.stats[s];
      lines.push(
        `    [${m.mean}, ${m.lo}, ${m.hi}]${i < EXPLOIT_STATS.length - 1 ? ',' : ''} // ${s} ${m.rule} ${m.horses}`
      );
    });
    lines.push(`  ), // ${c.hands} hands, ${c.seatHands} Horse seat-hands, ${c.horses} Horses`);
  }
  return lines.join('\n');
}
