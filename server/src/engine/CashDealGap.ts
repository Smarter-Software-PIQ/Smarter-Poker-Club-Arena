/**
 * CASH NEXT-HAND START - the full wait a cash table's players see between one
 * hand being completed and the next hand actually starting.
 *
 * Dan 2026-11-05, verbatim: "AS SOON AS ONE CASH GAME HAND FINISHES AT A
 * TABLE, THE NEXT HAND NEEDS TO START WITHIN 2 SECONDS, ANYTHING LESS IS
 * UNACCEPTABLE". And: "Measure the complete transition ... Report the sample
 * size, median, p95, p99, maximum gap, and the count of eligible transitions
 * exceeding two seconds."
 *
 * `nextHandGap` (NextHandGap.ts) stops its clock when the rest ends, before
 * dealHand's own awaits, and mixes cash with tournament tables. This one:
 *
 *   start = the end of the completion hold (the winning hand shown, the pot
 *           pushed with its total, the cards mucked - Dan 2026-08-21), the
 *           same instant armNextHandRest stamps;
 *   stop  = immediately before the hand controller starts the new hand, after
 *           every await dealHand makes (hand number, seat boundary, the cash
 *           participant manifest, time-bank reads);
 *   scope = cash tables only. A gap in which the table idled (not enough
 *           players, an operator or maintenance pause) or ran Dan's five second
 *           rebuy pause is a legitimate wait, not a sample.
 *
 * Every sample over the limit stays countable as `over`, never folded into an
 * average, and the slowest are kept with their table so each can be named.
 */

export const CASH_NEXT_HAND_LIMIT_MS = 2000;
const WINDOW_MS = 60 * 60_000;
const MAX_SAMPLES = 30_000;

export interface CashDealGapSample {
  readonly tableId: string;
  readonly gapMs: number;
  readonly at: number;
}

export interface CashDealGapStats {
  n: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  over: number;
}

export interface CashDealGapSnapshot extends CashDealGapStats {
  limitMs: number;
  windowMs: number;
  byTable: Record<string, CashDealGapStats>;
  slowest: CashDealGapSample[];
}

function pct(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

function stats(gaps: number[]): CashDealGapStats {
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50Ms: pct(sorted, 0.5),
    p95Ms: pct(sorted, 0.95),
    p99Ms: pct(sorted, 0.99),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
    over: sorted.filter((g) => g > CASH_NEXT_HAND_LIMIT_MS).length,
  };
}

export class CashDealGapRecorder {
  private samples: CashDealGapSample[] = [];

  record(sample: CashDealGapSample): void {
    if (!Number.isFinite(sample.gapMs) || sample.gapMs < 0) return;
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES)
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  snapshot(now: number = Date.now()): CashDealGapSnapshot {
    const cutoff = now - WINDOW_MS;
    this.samples = this.samples.filter((s) => s.at >= cutoff);
    const perTable = new Map<string, number[]>();
    for (const s of this.samples) {
      const arr = perTable.get(s.tableId) ?? [];
      arr.push(s.gapMs);
      perTable.set(s.tableId, arr);
    }
    const byTable: Record<string, CashDealGapStats> = {};
    for (const [tableId, gaps] of perTable) byTable[tableId] = stats(gaps);
    return {
      ...stats(this.samples.map((s) => s.gapMs)),
      limitMs: CASH_NEXT_HAND_LIMIT_MS,
      windowMs: WINDOW_MS,
      byTable,
      slowest: this.samples
        .filter((s) => s.gapMs > CASH_NEXT_HAND_LIMIT_MS)
        .sort((a, b) => b.gapMs - a.gapMs)
        .slice(0, 10)
        .map((s) => ({ ...s })),
    };
  }
}

/** The process-wide recorder every cash table engine reports into; read by /health. */
export const cashDealGap = new CashDealGapRecorder();

/**
 * A DURABLE LINE FOR EVERY BREACH (2026-11-10). The recorder above keeps one
 * rolling hour in memory and /health names only the ten slowest, so the
 * eleventh breach in an hour, and every breach before a restart, was lost.
 * Each next-hand wait over the limit now also writes exactly one JSON line to
 * the engine log: the waits the recorder counts, and the waits it does not
 * (an attempt abandoned before the deal, a table stopped mid-wait, a wait the
 * metric excludes), each labelled. Identity and timings only: never cards,
 * players, tokens or credentials, and no database call.
 *
 * CLOCKS. The recorder's own gap is a Date.now() difference and stays so. The
 * breach line's gapMs and stages come from one CashNextHandSpan, stamped with
 * performance.now() at the same two instants (the completion stamp in
 * armNextHandRest, the controller start in dealHand), so a wall-clock step
 * cannot shorten, lengthen or reorder them. Only `at` is wall-clock.
 */
export const CASH_NEXT_HAND_BREACH_TAG = '[CashNextHandStart.breach]';

const monoNow = (): number => performance.now();

/**
 * One hand-end to next-deal wait, partitioned by loop phase. Each phase change
 * closes the current segment at the same stamp that opens the next, so the
 * segments tile [start, end] with no gap and no overlap.
 */
export class CashNextHandSpan {
  private readonly startMono: number;
  private readonly bounds: { name: string; at: number }[];
  /** The first wait the metric contract excludes (waiting for players, a pause, a rebuy pause). */
  excluded: string | null = null;
  /** Set once the rest has ended; a later pass with the span still open never dealt. */
  restEnded = false;
  /** Why an earlier attempt in this wait ended without a deal (kept while under the limit). */
  retried: string | null = null;

  constructor(
    readonly tableId: string,
    readonly handNumber: number | null,
    phase: string,
    startMono: number = monoNow()
  ) {
    this.startMono = startMono;
    this.bounds = [{ name: phase, at: startMono }];
  }

  enter(phase: string, excludedAs: string | null = null, now: number = monoNow()): void {
    // Mirrors the metric: only a wait seen before the rest ends excludes it.
    if (excludedAs !== null && this.excluded === null && !this.restEnded)
      this.excluded = excludedAs;
    const last = this.bounds[this.bounds.length - 1];
    if (last.name === phase) return;
    this.bounds.push({ name: phase, at: Math.max(now, last.at) });
  }

  elapsedMs(now: number = monoNow()): number {
    return now - this.startMono;
  }

  /**
   * gapMs and stages, in whole ms. Boundaries are rounded cumulatively from the
   * start, so the stages always add up to exactly gapMs.
   */
  close(now: number = monoNow()): { gapMs: number; stages: Record<string, number> } {
    const end = Math.max(now, this.bounds[this.bounds.length - 1].at);
    const stages: Record<string, number> = {};
    for (let i = 0; i < this.bounds.length; i++) {
      const from = Math.round(this.bounds[i].at - this.startMono);
      const to = Math.round(
        (i + 1 < this.bounds.length ? this.bounds[i + 1].at : end) - this.startMono
      );
      const name = this.bounds[i].name;
      stages[name] = (stages[name] ?? 0) + (to - from);
    }
    return { gapMs: Math.round(end - this.startMono), stages };
  }
}

export interface CashNextHandBreach {
  readonly tableId: string;
  /** The completed hand the gap starts from. */
  readonly handNumber: number | null;
  /** The hand the controller is about to start; null when no deal happened. */
  readonly nextHandNumber: number | null;
  /** Monotonic, from CashNextHandSpan.close(). */
  readonly gapMs: number;
  /** Wall clock, for correlation only. */
  readonly at: number;
  /** `dealt`: the next hand started. `aborted`: the wait ended without a deal. */
  readonly outcome?: 'dealt' | 'aborted';
  /** For `aborted`, or a deal that followed an abandoned attempt. */
  readonly reason?: string | null;
  /** Whether the cashDealGap metric counted this same interval. */
  readonly counted?: boolean;
  /** The metric-contract exclusion this wait fell under, if any. */
  readonly excluded?: string | null;
  /** A partition of gapMs by loop phase; sums to gapMs exactly. */
  readonly stages: Readonly<Record<string, number>>;
  /**
   * The completed hand's settlement spans (PostHandStageTiming), by stage.
   * These overlap each other and the stages, and are never added to the gap.
   */
  readonly settlement?: {
    readonly complete: boolean;
    readonly spansMs: Readonly<Record<string, number>>;
    readonly threw: readonly string[];
  } | null;
}

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const REASON = /^[a-z][a-z0-9_:]{0,95}$/;
const ms = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
const int = (n: unknown): number | null =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
const reason = (r: unknown): string | null => (typeof r === 'string' && REASON.test(r) ? r : null);

function durations(src: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src ?? {})) {
    const d = ms(v);
    if (NAME.test(k) && d !== null) out[k] = d;
  }
  return out;
}

/** The breach line, or null when the gap is at or under the limit. Fixed fields only. */
export function cashNextHandBreachLine(b: CashNextHandBreach): string | null {
  const gapMs = ms(b.gapMs);
  if (gapMs === null || !(b.gapMs > CASH_NEXT_HAND_LIMIT_MS)) return null;
  const s = b.settlement;
  const outcome = b.outcome === 'aborted' ? 'aborted' : 'dealt';
  const why = reason(b.reason);
  const excluded = reason(b.excluded);
  const record = {
    v: 2,
    tableId: String(b.tableId),
    outcome,
    counted: b.counted === true,
    ...(why ? { reason: why } : {}),
    ...(excluded ? { excluded } : {}),
    handNumber: int(b.handNumber),
    nextHandNumber: int(b.nextHandNumber),
    gapMs,
    limitMs: CASH_NEXT_HAND_LIMIT_MS,
    at: ms(b.at),
    stages: durations(b.stages),
    ...(s
      ? {
          settlement: {
            overlapping: true,
            complete: s.complete === true,
            spansMs: durations(s.spansMs),
            threw: s.threw.filter((n) => NAME.test(n)),
          },
        }
      : {}),
  };
  return `${CASH_NEXT_HAND_BREACH_TAG} ${JSON.stringify(record)}`;
}

/**
 * A per-process ceiling on breach lines: at most `max` per rolling `windowMs`.
 * Past it lines are counted, not written, and the next line after the window
 * rolls is preceded by one summary line carrying the dropped count. Driven by
 * the reports themselves; no timer.
 */
export class CashBreachLineBudget {
  private stamps: number[] = [];
  private dropped = 0;
  constructor(
    readonly max = 600,
    readonly windowMs = 60_000
  ) {}

  /** Returns the lines to write for one breach (zero, one, or summary + line). */
  admit(line: string, now: number = monoNow()): string[] {
    while (this.stamps.length && now - this.stamps[0] >= this.windowMs) this.stamps.shift();
    if (this.stamps.length >= this.max) {
      this.dropped++;
      return [];
    }
    const out: string[] = [];
    if (this.dropped > 0) {
      out.push(
        `${CASH_NEXT_HAND_BREACH_TAG} ${JSON.stringify({
          v: 2,
          summary: true,
          dropped: this.dropped,
          maxLines: this.max,
          windowMs: this.windowMs,
        })}`
      );
      this.dropped = 0;
    }
    this.stamps.push(now);
    out.push(line);
    return out;
  }
}

const processBudget = new CashBreachLineBudget();

/** Writes the breach line when the gap is over the limit; one line per breach, capped. */
export function reportCashNextHandBreach(
  b: CashNextHandBreach,
  log: (line: string) => void = console.warn,
  budget: CashBreachLineBudget = processBudget
): void {
  try {
    const line = cashNextHandBreachLine(b);
    if (line !== null) for (const l of budget.admit(line)) log(l);
  } catch {
    /* Observation only: a failed log line must never hold a deal. */
  }
}
