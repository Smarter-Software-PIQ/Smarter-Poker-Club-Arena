/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RIVER BLUFF LIVE REPORT - how the river bluffs of #9803, #9837, #9838 and
 * #9842 actually play at the live tables, and what that says about tuning
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure. No network, no clock, no database. The CLI
 * (scripts/horse-measure/river-bluff-ev.ts) renders the two read-only
 * statements, the operator runs them (Supabase MCP execute_sql or the
 * management API, one statement per call), and the saved result files come
 * back here:
 *
 *   spots     sql/river-bluff-spots.sql, one per time slice: every horse river
 *             decision with nothing to call, aggregated into cells of
 *             variant x format x heads-up/multiway x line x game type x
 *             opponent style x opponent kind, with the bet, air, fold, call,
 *             raise, break-even and decision-EV sums of each cell;
 *   receipts  sql/river-bluff-receipts.sql: daily horse_brain_telemetry fires
 *             of every river bluff layer, plus the decide_* liveness controls.
 *
 * Every function answers "could not tell" distinctly from a number (CLAUDE.md
 * 10.86): a rate over no sample is null, a day without flowing controls is
 * NO_DATA, a layer that could have fired and did not is ZERO, and a window
 * the slices do not cover is reported as a gap rather than read as quiet.
 *
 * The opponent kind (human / horse) is DATA IDENTIFICATION ONLY (CLAUDE.md
 * 10.5): it splits a report so an operator can see both, and nothing here
 * feeds a strategy.
 *
 * NEVER refer to the horses as "bots" - they are HORSES only.
 */

import { rowsFromResultText } from '../engine/HorseComplaintReplay.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One outcome vector, in the order sql/river-bluff-spots.sql builds it:
 * [bets, bets with a responder, all responders folded, called (not raised),
 *  raised, sum break-even fold, sum size / pot, bets with a recorded net,
 *  sum decision EV bb, sum decision EV bb squared].
 */
export type OutcomeVector = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const DIMENSIONS = ['v', 'fmt', 'ways', 'line', 'gt', 'style', 'who'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface SpotCell {
  v: string;
  fmt: string;
  ways: string;
  line: string;
  gt: string;
  style: string;
  who: string;
  spots: number;
  bets: number;
  known: number;
  known_bets: number;
  air_spots: number;
  air_bets: number;
  bet_out: OutcomeVector;
  air_out: OutcomeVector;
}

export interface SpotsSlice {
  window: [string, string];
  cells: SpotCell[];
}

export interface ReceiptRow {
  day: string;
  kind: 'bet' | 'control' | 'other';
  feature: string;
  layer: string | null;
  fires: number;
}

export interface ReceiptsResult {
  days: [string, string];
  rows: ReceiptRow[];
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

function outcome(x: unknown, what: string): OutcomeVector {
  if (!Array.isArray(x) || x.length !== 10 || !x.every(isNum))
    throw new Error(`${what}: expected 10 finite numbers`);
  return x as OutcomeVector;
}

function cellFrom(x: unknown, i: number): SpotCell {
  const c = x as Record<string, unknown>;
  if (!c || typeof c !== 'object') throw new Error(`cell ${i}: not an object`);
  for (const d of DIMENSIONS) if (!isStr(c[d])) throw new Error(`cell ${i}: missing ${d}`);
  for (const k of ['spots', 'bets', 'known', 'known_bets', 'air_spots', 'air_bets'])
    if (!isNum(c[k]) || (c[k] as number) < 0) throw new Error(`cell ${i}: bad ${k}`);
  const cell: SpotCell = {
    v: c.v as string,
    fmt: c.fmt as string,
    ways: c.ways as string,
    line: c.line as string,
    gt: c.gt as string,
    style: c.style as string,
    who: c.who as string,
    spots: c.spots as number,
    bets: c.bets as number,
    known: c.known as number,
    known_bets: c.known_bets as number,
    air_spots: c.air_spots as number,
    air_bets: c.air_bets as number,
    bet_out: outcome(c.bet_out, `cell ${i} bet_out`),
    air_out: outcome(c.air_out, `cell ${i} air_out`),
  };
  if (
    cell.bets > cell.spots ||
    cell.known > cell.spots ||
    cell.known_bets > Math.min(cell.bets, cell.known) ||
    cell.air_bets > Math.min(cell.air_spots, cell.known_bets) ||
    cell.air_spots > cell.known
  )
    throw new Error(`cell ${i}: counts are inconsistent`);
  if (cell.bet_out[0] !== cell.bets || cell.air_out[0] !== cell.air_bets)
    throw new Error(`cell ${i}: outcome vector does not match the bet counts`);
  return cell;
}

/** The single object a one-row, one-column statement returned. */
function singleObject(text: string, column: string): Record<string, unknown> {
  const rows = rowsFromResultText(text);
  if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}`);
  const row = rows[0] as Record<string, unknown>;
  const v = row && typeof row === 'object' && column in row ? row[column] : row;
  const obj = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  if (!obj || typeof obj !== 'object') throw new Error(`column ${column} is not an object`);
  return obj as Record<string, unknown>;
}

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse one saved sql/river-bluff-spots.sql result (raw JSON or MCP text). */
export function parseSpotsResult(text: string): SpotsSlice {
  const o = singleObject(text, 'report');
  if (o.section !== 'river_bluff_spots') throw new Error('not a river-bluff-spots result');
  const w = o.window;
  if (!Array.isArray(w) || w.length !== 2 || !w.every((x) => typeof x === 'string' && TS.test(x)))
    throw new Error('spots result has no valid window');
  if (!Array.isArray(o.cells)) throw new Error('spots result has no cells array');
  return { window: [w[0], w[1]] as [string, string], cells: o.cells.map(cellFrom) };
}

/** Parse one saved sql/river-bluff-receipts.sql result. */
export function parseReceiptsResult(text: string): ReceiptsResult {
  const o = singleObject(text, 'receipts');
  if (o.section !== 'river_bluff_receipts') throw new Error('not a river-bluff-receipts result');
  const d = o.days;
  if (!Array.isArray(d) || d.length !== 2 || !d.every((x) => typeof x === 'string' && DAY.test(x)))
    throw new Error('receipts result has no valid days');
  if (!Array.isArray(o.rows)) throw new Error('receipts result has no rows array');
  const rows = o.rows.map((r, i): ReceiptRow => {
    if (!Array.isArray(r) || r.length !== 5) throw new Error(`receipt row ${i}: expected 5 fields`);
    const [day, kind, feature, layer, fires] = r as unknown[];
    if (typeof day !== 'string' || !DAY.test(day)) throw new Error(`receipt row ${i}: bad day`);
    if (kind !== 'bet' && kind !== 'control' && kind !== 'other')
      throw new Error(`receipt row ${i}: bad kind`);
    if (!isStr(feature)) throw new Error(`receipt row ${i}: bad feature`);
    if (!isNum(fires) || fires < 0) throw new Error(`receipt row ${i}: bad fires`);
    return { day, kind, feature, layer: typeof layer === 'string' ? layer : null, fires };
  });
  return { days: [d[0], d[1]] as [string, string], rows };
}

/** Which kind of result a saved file holds, without throwing. */
export function resultSection(text: string): 'spots' | 'receipts' | null {
  if (text.includes('river_bluff_spots')) return 'spots';
  if (text.includes('river_bluff_receipts')) return 'receipts';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage: the slices must tile the window
// ─────────────────────────────────────────────────────────────────────────────

export interface Coverage {
  complete: boolean;
  gaps: Array<[string, string]>;
  overlaps: Array<[string, string]>;
  outside: Array<[string, string]>;
}

const ms = (t: string) => Date.parse(t);
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');

/** Do the slices cover [start, end) exactly once? Gaps are "not read", never "quiet". */
export function coverage(start: string, end: string, windows: Array<[string, string]>): Coverage {
  const s = ms(start);
  const e = ms(end);
  const sorted = windows
    .map(([a, b]) => [ms(a), ms(b)] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const gaps: Array<[string, string]> = [];
  const overlaps: Array<[string, string]> = [];
  const outside: Array<[string, string]> = [];
  let at = s;
  for (const [a, b] of sorted) {
    if (b <= s || a >= e) {
      outside.push([iso(a), iso(b)]);
      continue;
    }
    if (a < s || b > e) outside.push([iso(a), iso(b)]);
    if (a > at) gaps.push([iso(at), iso(a)]);
    if (a < at) overlaps.push([iso(Math.max(a, s)), iso(Math.min(at, b))]);
    at = Math.max(at, b);
  }
  if (at < e) gaps.push([iso(at), iso(e)]);
  return {
    complete: gaps.length === 0 && overlaps.length === 0 && outside.length === 0,
    gaps,
    overlaps,
    outside,
  };
}

/** [start, end) in slices of `hours` (the last may be shorter). */
export function slices(start: string, end: string, hours: number): Array<[string, string]> {
  if (!TS.test(start) || !TS.test(end)) throw new Error('timestamps need an explicit offset');
  if (!(hours > 0 && hours <= 24)) throw new Error('slice hours must be in (0, 24]');
  const out: Array<[string, string]> = [];
  const e = ms(end);
  for (let t = ms(start); t < e; t += hours * 3_600_000)
    out.push([iso(t), iso(Math.min(e, t + hours * 3_600_000))]);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merging and summarising
// ─────────────────────────────────────────────────────────────────────────────

const keyOf = (c: Pick<SpotCell, Dimension>, dims: readonly Dimension[]) =>
  dims.map((d) => c[d]).join('|');

const addVec = (a: OutcomeVector, b: OutcomeVector): OutcomeVector =>
  a.map((x, i) => x + b[i]) as OutcomeVector;

const ZERO: OutcomeVector = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Sum cells that share every dimension (slices of one window). */
export function mergeCells(cells: readonly SpotCell[]): SpotCell[] {
  const m = new Map<string, SpotCell>();
  for (const c of cells) {
    const k = keyOf(c, DIMENSIONS);
    const p = m.get(k);
    if (!p) {
      m.set(k, {
        ...c,
        bet_out: [...c.bet_out] as OutcomeVector,
        air_out: [...c.air_out] as OutcomeVector,
      });
      continue;
    }
    p.spots += c.spots;
    p.bets += c.bets;
    p.known += c.known;
    p.known_bets += c.known_bets;
    p.air_spots += c.air_spots;
    p.air_bets += c.air_bets;
    p.bet_out = addVec(p.bet_out, c.bet_out);
    p.air_out = addVec(p.air_out, c.air_out);
  }
  return [...m.values()];
}

/** A proportion with its binomial standard error; null when there is no sample. */
export interface Rate {
  k: number;
  n: number;
  p: number | null;
  se: number | null;
}

export function rate(k: number, n: number): Rate {
  if (n <= 0) return { k, n, p: null, se: null };
  const p = k / n;
  return { k, n, p, se: Math.sqrt((p * (1 - p)) / n) };
}

/** Mean decision EV (bb) and its standard error; null below two observations. */
export interface Mean {
  n: number;
  mean: number | null;
  se: number | null;
}

export function meanFromSums(n: number, sum: number, sumSq: number): Mean {
  if (n <= 0) return { n, mean: null, se: null };
  const mean = sum / n;
  if (n < 2) return { n, mean, se: null };
  const v = Math.max(0, (sumSq - n * mean * mean) / (n - 1));
  return { n, mean, se: Math.sqrt(v / n) };
}

export interface BetOutcome {
  bets: number;
  /** bets an opponent could still answer (a live, not all-in, opponent behind) */
  responders: number;
  /** every responder folded */
  fold: Rate;
  called: Rate;
  raised: Rate;
  /** mean break-even fold of the size used: added / (pot + added) */
  breakEven: number | null;
  /** mean size as a fraction of the pot */
  sizeFrac: number | null;
  /** fold rate minus break-even: positive means the bluffs got more folds than they needed */
  foldMargin: number | null;
  /** (net + chips invested at the node) / bb, against checking and losing */
  ev: Mean;
}

export function betOutcome(v: OutcomeVector): BetOutcome {
  const [n, resp, folds, calls, raises, sumBe, sumFrac, nEv, sumEv, sumEv2] = v;
  const fold = rate(folds, resp);
  const breakEven = n > 0 ? sumBe / n : null;
  return {
    bets: n,
    responders: resp,
    fold,
    called: rate(calls, resp),
    raised: rate(raises, resp),
    breakEven,
    sizeFrac: n > 0 ? sumFrac / n : null,
    foldMargin: fold.p !== null && breakEven !== null ? fold.p - breakEven : null,
    ev: meanFromSums(nEv, sumEv, sumEv2),
  };
}

export interface Summary {
  key: Partial<Record<Dimension, string>>;
  spots: number;
  bets: number;
  /** bet, raise or all_in share of every river decision with nothing to call */
  betRate: Rate;
  /** spots with recorded hole cards (the air classification needs them) */
  known: number;
  airSpots: number;
  airBets: number;
  /** share of the classifiable bets that are air */
  airShareOfBets: Rate;
  /** how often air bets when it has the chance */
  airBetRate: Rate;
  /** every bet */
  all: BetOutcome;
  /** the air bets: the bluffs */
  bluff: BetOutcome;
}

/** Pool cells by the given dimensions (empty: one row for everything). */
export function summarize(cells: readonly SpotCell[], dims: readonly Dimension[]): Summary[] {
  const groups = new Map<string, { key: Partial<Record<Dimension, string>>; acc: SpotCell }>();
  for (const c of cells) {
    const k = keyOf(c, dims);
    const g = groups.get(k);
    if (!g) {
      const key: Partial<Record<Dimension, string>> = {};
      for (const d of dims) key[d] = c[d];
      groups.set(k, {
        key,
        acc: {
          ...c,
          bet_out: [...c.bet_out] as OutcomeVector,
          air_out: [...c.air_out] as OutcomeVector,
        },
      });
      continue;
    }
    const a = g.acc;
    a.spots += c.spots;
    a.bets += c.bets;
    a.known += c.known;
    a.known_bets += c.known_bets;
    a.air_spots += c.air_spots;
    a.air_bets += c.air_bets;
    a.bet_out = addVec(a.bet_out, c.bet_out);
    a.air_out = addVec(a.air_out, c.air_out);
  }
  return [...groups.values()].map(({ key, acc }) => ({
    key,
    spots: acc.spots,
    bets: acc.bets,
    betRate: rate(acc.bets, acc.spots),
    known: acc.known,
    airSpots: acc.air_spots,
    airBets: acc.air_bets,
    airShareOfBets: rate(acc.air_bets, acc.known_bets),
    airBetRate: rate(acc.air_bets, acc.air_spots),
    all: betOutcome(acc.bet_out),
    bluff: betOutcome(acc.air_out),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The pre-release baseline (2026-11-07, before any of #9803 / #9837 / #9838 /
// #9842 served) and the comparison against it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Captured 2026-11-07 for [06:00, 08:00) UTC on engine 92e26a9f (horse river
 * decisions with nothing to call, bet = bet / raise / all_in), reproduced
 * exactly by sql/river-bluff-spots.sql. Receipts that day: v53_river_bluff 11
 * and v53_river_scare_bluff 16 at about 08:20 UTC, no river_bluff_baseline_*.
 */
export const PRE_RELEASE_BASELINE = Object.freeze({
  window: ['2026-11-07T06:00:00Z', '2026-11-07T08:00:00Z'] as const,
  engine: '92e26a9f',
  betRate: Object.freeze({
    nlh: { spots: 4328, pct: 29.5 },
    plo4: { spots: 3453, pct: 27.0 },
    plo6: { spots: 268, pct: 33.2 },
    plo5: { spots: 164, pct: 31.7 },
    flo8: { spots: 22, pct: 18.2 },
  } as Record<string, { spots: number; pct: number }>),
});

export interface BaselineDelta {
  v: string;
  baseline: { spots: number; pct: number };
  now: Rate;
  /** percentage points */
  delta: number | null;
  /** standard error of the difference, percentage points */
  se: number | null;
}

export function compareToBaseline(byVariant: readonly Summary[]): BaselineDelta[] {
  return Object.entries(PRE_RELEASE_BASELINE.betRate).map(([v, b]) => {
    const s = byVariant.find((x) => x.key.v === v);
    const now = s ? s.betRate : rate(0, 0);
    if (now.p === null) return { v, baseline: b, now, delta: null, se: null };
    const pb = b.pct / 100;
    const se = Math.sqrt((pb * (1 - pb)) / b.spots + (now.se ?? 0) ** 2) * 100;
    return { v, baseline: b, now, delta: now.p * 100 - b.pct, se };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipts
// ─────────────────────────────────────────────────────────────────────────────

export type ReceiptStatus = 'FIRED' | 'ZERO' | 'NO_DATA';

export interface LayerReceipt {
  feature: string;
  layer: string;
  fires: number;
  /** days the controls were flowing */
  liveDays: number;
  status: ReceiptStatus;
  firstDay: string | null;
}

export interface ReceiptSummary {
  liveDays: string[];
  deadDays: string[];
  layers: LayerReceipt[];
  /** non-bet river receipts (checks, skips, evaluations), totalled */
  other: Array<{ feature: string; fires: number }>;
}

/** A day is live only when a decide_* control fired that day. */
export function summarizeReceipts(r: ReceiptsResult): ReceiptSummary {
  const days = new Set(r.rows.map((x) => x.day));
  const live = new Set(r.rows.filter((x) => x.kind === 'control' && x.fires > 0).map((x) => x.day));
  const allDays: string[] = [];
  for (
    let t = Date.parse(`${r.days[0]}T00:00:00Z`);
    t <= Date.parse(`${r.days[1]}T00:00:00Z`);
    t += 86_400_000
  )
    allDays.push(new Date(t).toISOString().slice(0, 10));
  for (const d of days) if (!allDays.includes(d)) allDays.push(d);
  allDays.sort();
  const layers = new Map<string, LayerReceipt>();
  const other = new Map<string, number>();
  for (const x of r.rows) {
    if (x.kind === 'control') continue;
    if (x.kind === 'other') {
      if (live.has(x.day)) other.set(x.feature, (other.get(x.feature) ?? 0) + x.fires);
      continue;
    }
    const l = layers.get(x.feature) ?? {
      feature: x.feature,
      layer: x.layer ?? x.feature,
      fires: 0,
      liveDays: 0,
      status: 'NO_DATA' as ReceiptStatus,
      firstDay: null,
    };
    if (live.has(x.day)) {
      l.fires += x.fires;
      l.liveDays += 1;
      if (x.fires > 0 && (l.firstDay === null || x.day < l.firstDay)) l.firstDay = x.day;
    }
    layers.set(x.feature, l);
  }
  for (const l of layers.values())
    l.status = l.liveDays === 0 ? 'NO_DATA' : l.fires > 0 ? 'FIRED' : 'ZERO';
  return {
    liveDays: allDays.filter((d) => live.has(d)),
    deadDays: allDays.filter((d) => !live.has(d)),
    layers: [...layers.values()].sort((a, b) => a.layer.localeCompare(b.layer)),
    other: [...other.entries()]
      .map(([feature, fires]) => ({ feature, fires }))
      .sort((a, b) => b.fires - a.fires),
  };
}

/** The receipts introduced by the four new river bluff layers (#9803 / #9837 / #9838 / #9842). */
export const NEW_LAYER_PREFIXES = [
  'river_bluff_baseline_',
  'river_bluff_multiway_',
  'river_lead_',
  'river_bluff_hilo_',
] as const;

export const isNewLayer = (feature: string) =>
  NEW_LAYER_PREFIXES.some((p) => feature.startsWith(p));

// ─────────────────────────────────────────────────────────────────────────────
// The default window: since the engine boot that first served 57d9c627
// ─────────────────────────────────────────────────────────────────────────────

export const RIVER_BLUFF_RELEASE_COMMIT = '57d9c627';

export type WindowResolution =
  | { status: 'RELEASED'; start: string; end: string; releaseSha: string; note: string }
  | { status: 'NOT_RELEASED'; releaseSha: string; note: string }
  | { status: 'UNKNOWN'; note: string };

/**
 * From /health (releaseSha, bootPhases.processStartedAt) and whether that
 * release contains the commit (true / false / null = could not tell).
 * `firstFireDay` is the first UTC day a river_bluff_baseline_* receipt fired;
 * when it precedes the current boot, an earlier boot already served the
 * commit and the window starts there (04:05 America/Chicago that day is the
 * only time a routine release activates).
 */
export function resolveWindow(input: {
  health: unknown;
  containsCommit: boolean | null;
  now: string;
  firstBootStart?: string | null;
}): WindowResolution {
  const h = input.health as {
    releaseSha?: unknown;
    bootPhases?: { processStartedAt?: unknown };
  } | null;
  const sha =
    h && typeof h.releaseSha === 'string' && /^[0-9a-f]{7,40}$/.test(h.releaseSha)
      ? h.releaseSha
      : null;
  const boot =
    h?.bootPhases && typeof h.bootPhases.processStartedAt === 'string'
      ? h.bootPhases.processStartedAt
      : null;
  if (!sha || !boot || Number.isNaN(Date.parse(boot)))
    return { status: 'UNKNOWN', note: 'engine /health gave no releaseSha or boot time' };
  if (input.containsCommit === null)
    return {
      status: 'UNKNOWN',
      note: `could not tell whether ${sha} contains ${RIVER_BLUFF_RELEASE_COMMIT} (fetch it, then retry)`,
    };
  if (!input.containsCommit)
    return {
      status: 'NOT_RELEASED',
      releaseSha: sha,
      note: `the serving engine ${sha.slice(0, 8)} does not contain ${RIVER_BLUFF_RELEASE_COMMIT}: the new river bluffs are not live; pass an explicit window to measure the old engine`,
    };
  const earlier =
    input.firstBootStart && Date.parse(input.firstBootStart) < Date.parse(boot)
      ? input.firstBootStart
      : null;
  const start = new Date(Date.parse(earlier ?? boot)).toISOString().replace('.000Z', 'Z');
  return {
    status: 'RELEASED',
    start,
    end: new Date(Date.parse(input.now)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    releaseSha: sha,
    note: earlier
      ? `an earlier boot already served ${RIVER_BLUFF_RELEASE_COMMIT} (receipts from ${earlier}); the window starts there`
      : `current boot of ${sha.slice(0, 8)} at ${boot}`,
  };
}

/**
 * 04:05 America/Chicago on a UTC day, as an ISO instant: the end of the daily
 * maintenance window, when a routine release activates. DST aware without a
 * time zone database: Chicago is UTC-5 from the second Sunday of March to the
 * first Sunday of November (02:00 local), UTC-6 otherwise.
 */
export function chicagoReleaseInstant(day: string): string {
  if (!DAY.test(day)) throw new Error('day must be YYYY-MM-DD');
  const [y, m, d] = day.split('-').map(Number);
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const t = Date.UTC(y, m - 1, d);
  const dstStart = Date.UTC(y, 2, nthSunday(3, 2));
  const dstEnd = Date.UTC(y, 10, nthSunday(11, 1));
  const offsetHours = t >= dstStart && t < dstEnd ? 5 : 6;
  return new Date(t + (4 * 60 + 5) * 60_000 + offsetHours * 3_600_000)
    .toISOString()
    .replace('.000Z', 'Z');
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

const pct = (r: Rate) =>
  r.p === null
    ? 'no data'
    : `${(100 * r.p).toFixed(1)}% +/- ${(100 * (r.se ?? 0)).toFixed(1)} (${r.k}/${r.n})`;
const num = (x: number | null, d = 2) => (x === null ? '-' : x.toFixed(d));
const evs = (m: Mean) =>
  m.mean === null
    ? 'no data'
    : `${m.mean >= 0 ? '+' : ''}${m.mean.toFixed(2)}${m.se === null ? '' : ` +/- ${m.se.toFixed(2)}`} (n ${m.n})`;

export interface Report {
  window: [string, string];
  coverage: Coverage;
  status: 'DATA' | 'NO_DATA';
  overall: Summary | null;
  byVariant: Summary[];
  baseline: BaselineDelta[];
  tables: Array<{ title: string; dims: Dimension[]; rows: Summary[] }>;
  receipts: ReceiptSummary | null;
  notes: string[];
}

export const REPORT_TABLES: ReadonlyArray<{ title: string; dims: Dimension[] }> = [
  { title: 'By variant', dims: ['v'] },
  { title: 'By variant and table shape', dims: ['v', 'ways'] },
  { title: 'By variant and format', dims: ['v', 'fmt'] },
  { title: 'By variant, table shape and line', dims: ['v', 'ways', 'line'] },
  { title: 'By game type', dims: ['v', 'gt'] },
  { title: 'By opponent style (public stats; heads-up, multiway pooled)', dims: ['ways', 'style'] },
  { title: 'By opponent kind (data identification only)', dims: ['ways', 'who'] },
];

export function buildReport(input: {
  window: [string, string];
  slices: SpotsSlice[];
  receipts: ReceiptsResult | null;
}): Report {
  const cov = coverage(
    input.window[0],
    input.window[1],
    input.slices.map((s) => s.window)
  );
  const cells = mergeCells(input.slices.flatMap((s) => s.cells));
  const notes: string[] = [];
  if (!cov.complete)
    notes.push(
      `COVERAGE INCOMPLETE: gaps ${JSON.stringify(cov.gaps)}, overlaps ${JSON.stringify(cov.overlaps)}, outside ${JSON.stringify(cov.outside)}. Missing time is NOT read, not quiet.`
    );
  const total = cells.reduce((a, c) => a + c.spots, 0);
  const byVariant = summarize(cells, ['v']).sort((a, b) => b.spots - a.spots);
  const receipts = input.receipts ? summarizeReceipts(input.receipts) : null;
  if (!receipts) notes.push('No receipts result supplied: layer fire counts are NO DATA.');
  else {
    if (receipts.deadDays.length)
      notes.push(
        `Telemetry controls silent on ${receipts.deadDays.join(', ')}: those days are NO DATA.`
      );
    const newFired = receipts.layers.filter((l) => isNewLayer(l.feature) && l.status === 'FIRED');
    if (receipts.liveDays.length && !newFired.length)
      notes.push(
        'No receipt of the new river bluff layers fired on any live day: either the serving engine does not contain them yet, or they never reached the tables.'
      );
  }
  return {
    window: input.window,
    coverage: cov,
    status: total > 0 ? 'DATA' : 'NO_DATA',
    overall: total > 0 ? summarize(cells, [])[0] : null,
    byVariant,
    baseline: compareToBaseline(byVariant),
    tables: REPORT_TABLES.map((t) => ({
      title: t.title,
      dims: t.dims,
      rows: summarize(cells, t.dims).sort((a, b) =>
        keyOf(a.key as SpotCell, t.dims).localeCompare(keyOf(b.key as SpotCell, t.dims))
      ),
    })),
    receipts,
    notes,
  };
}

export function renderMarkdown(r: Report): string {
  const L: string[] = [
    `# River bluff live report, ${r.window[0]} to ${r.window[1]}`,
    '',
    'Read-only. Horse river decisions with nothing to call. Every rate carries its standard error and sample;',
    'behaviour is not profitability, and an interval that straddles the threshold means the data cannot speak yet.',
    'Opponent kind is data identification only (CLAUDE.md 10.5).',
    '',
  ];
  for (const n of r.notes) L.push(`- ${n}`);
  if (r.notes.length) L.push('');
  if (r.status === 'NO_DATA') {
    L.push(
      '## NO DATA',
      '',
      'The slices read contain no horse river decision with nothing to call. This is not a zero.',
      ''
    );
  } else {
    const o = r.overall as Summary;
    L.push(
      '## Overall',
      '',
      `${o.spots} spots, bet ${pct(o.betRate)}; air share of bets ${pct(o.airShareOfBets)}; air bets ${pct(o.airBetRate)} of air spots.`,
      `Bluffs (air bets): fold ${pct(o.bluff.fold)} vs break-even ${num(o.bluff.breakEven === null ? null : 100 * o.bluff.breakEven, 1)}%, EV ${evs(o.bluff.ev)} bb.`,
      ''
    );
    L.push(
      '## Versus the pre-release baseline',
      '',
      `Baseline ${PRE_RELEASE_BASELINE.window.join(' to ')} on engine ${PRE_RELEASE_BASELINE.engine}.`,
      ''
    );
    L.push(
      '| variant | baseline bet % (spots) | now bet % | delta pp |',
      '| --- | --- | --- | --- |'
    );
    for (const b of r.baseline)
      L.push(
        `| ${b.v} | ${b.baseline.pct.toFixed(1)}% (${b.baseline.spots}) | ${pct(b.now)} | ${b.delta === null ? 'no data' : `${b.delta >= 0 ? '+' : ''}${b.delta.toFixed(1)} +/- ${(b.se ?? 0).toFixed(1)}`} |`
      );
    L.push('');
    for (const t of r.tables) {
      L.push(`## ${t.title}`, '');
      L.push(
        `| ${t.dims.join(' | ')} | spots | bet % | air % of bets | air bet % | bluffs | bluff fold % | break-even % | size/pot | bluff EV bb | all-bet fold % | all-bet EV bb |`,
        `|${' --- |'.repeat(t.dims.length + 11)}`
      );
      for (const s of t.rows)
        L.push(
          `| ${t.dims.map((d) => s.key[d]).join(' | ')} | ${s.spots} | ${pct(s.betRate)} | ${pct(s.airShareOfBets)} | ${pct(s.airBetRate)} | ${s.bluff.bets} | ${pct(s.bluff.fold)} | ${num(s.bluff.breakEven === null ? null : 100 * s.bluff.breakEven, 1)} | ${num(s.bluff.sizeFrac)} | ${evs(s.bluff.ev)} | ${pct(s.all.fold)} | ${evs(s.all.ev)} |`
        );
      L.push('');
    }
  }
  L.push('## Layer receipts (horse_brain_telemetry, whole UTC days, whole fleet)', '');
  if (!r.receipts) L.push('NO DATA: no receipts result supplied.', '');
  else {
    L.push(
      `Live days: ${r.receipts.liveDays.join(', ') || 'none'}. Silent days: ${r.receipts.deadDays.join(', ') || 'none'}.`,
      ''
    );
    L.push('| layer | receipt | fires | status | first day |', '| --- | --- | ---: | --- | --- |');
    for (const l of r.receipts.layers)
      L.push(
        `| ${l.layer} | ${l.feature} | ${l.status === 'NO_DATA' ? '-' : l.fires} | ${l.status} | ${l.firstDay ?? '-'} |`
      );
    L.push('');
    if (r.receipts.other.length) {
      L.push(
        'Other river receipts (checks, skips, evaluations):',
        '',
        '| receipt | fires |',
        '| --- | ---: |'
      );
      for (const x of r.receipts.other) L.push(`| ${x.feature} | ${x.fires} |`);
      L.push('');
    }
  }
  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering the read-only statements
// ─────────────────────────────────────────────────────────────────────────────

const WRITE_WORDS =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|refresh|comment|call|do|lock|notify|listen|unlisten|reindex|cluster|merge|into|prepare|execute|discard|reset|set|begin|commit|rollback|savepoint|import|load|security)\b/i;
const SIDE_EFFECTS =
  /\b(pg_terminate_backend|pg_cancel_backend|pg_sleep\w*|pg_advisory\w*|pg_try_advisory\w*|set_config|nextval|setval|dblink\w*|lo_\w+|pg_read_\w+|pg_ls_\w+|pg_notify|txid_current|http\w*)\s*\(/i;

/** Replace each standard '...' literal with ''. Null for anything that could
 *  hide text: an unterminated literal, or a prefixed one (E'..', U&'..') whose
 *  opening quote follows an identifier character. */
function blankStrings(sql: string): string | null {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch !== "'") {
      out += ch;
      i++;
      continue;
    }
    if (i > 0 && /[A-Za-z0-9_&]/.test(sql[i - 1])) return null;
    let j = i + 1;
    for (;;) {
      if (j >= sql.length) return null;
      if (sql[j] === "'") {
        if (sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        break;
      }
      j++;
    }
    out += "''";
    i = j + 1;
  }
  return out;
}

/** One statement, SELECT or WITH, no write keyword or side-effect function
 *  outside comments and standard string literals. A dollar quote or a
 *  prefixed literal (E'..') is refused outright: it could hide either. */
export function isReadOnlyStatement(sql: string): boolean {
  const noBlock = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const noLine = noBlock
    .split('\n')
    .map((l) => l.split('--')[0])
    .join('\n');
  if (/\$[A-Za-z_]*\$/.test(noLine)) return false;
  const body = blankStrings(noLine);
  if (body === null) return false;
  const statements = body
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length !== 1 || !/^(with|select)\b/i.test(statements[0])) return false;
  return !WRITE_WORDS.test(body) && !SIDE_EFFECTS.test(body);
}

function checked(sql: string, placeholders: string[]): string {
  for (const p of placeholders)
    if (sql.includes(`:${p}`)) throw new Error(`placeholder :${p} left unrendered`);
  if (!isReadOnlyStatement(sql)) throw new Error('rendered statement is not read-only');
  return sql;
}

/** sql/river-bluff-spots.sql for [start, end): explicit offsets, at most 24 hours. */
export function renderSpotsSql(template: string, start: string, end: string): string {
  if (!TS.test(start) || !TS.test(end))
    throw new Error('START and END need an explicit offset (e.g. 2026-11-08T10:05:00Z)');
  const span = Date.parse(end) - Date.parse(start);
  if (!(span > 0)) throw new Error('END must be after START');
  if (span > 24 * 3_600_000)
    throw new Error('one spots statement covers at most 24 hours; slice the window (plan)');
  return checked(template.replace(/:START/g, `'${start}'`).replace(/:END/g, `'${end}'`), [
    'START',
    'END',
  ]);
}

/** sql/river-bluff-receipts.sql for the UTC days [startDay, endDay], at most 62. */
export function renderReceiptsSql(template: string, startDay: string, endDay: string): string {
  if (!DAY.test(startDay) || !DAY.test(endDay)) throw new Error('days must be YYYY-MM-DD');
  const span = Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`);
  if (span < 0) throw new Error('END_DAY must not precede START_DAY');
  if (span > 62 * 86_400_000) throw new Error('receipts cover at most 62 days per statement');
  return checked(
    template.replace(/:START_DAY/g, `'${startDay}'`).replace(/:END_DAY/g, `'${endDay}'`),
    ['START_DAY', 'END_DAY']
  );
}
