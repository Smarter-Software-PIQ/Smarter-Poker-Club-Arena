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
 * Each sample over the limit now also writes exactly one JSON line to the
 * engine log. It carries the same identity and the same gap the recorder
 * counts, plus the timings the engine already holds: never cards, players,
 * tokens or credentials, and no database call.
 */
export const CASH_NEXT_HAND_BREACH_TAG = '[CashNextHandStart.breach]';

export interface CashNextHandBreach {
  readonly tableId: string;
  /** The completed hand the gap starts from. */
  readonly handNumber: number | null;
  /** The hand the controller is about to start. */
  readonly nextHandNumber: number | null;
  readonly gapMs: number;
  readonly at: number;
  /**
   * Loop phases from the completion stamp to the end of the rest
   * (await_post_hand_tasks, load_next_hand_inputs, next_hand_rest, ...) plus
   * `deal`: the end of the rest to the controller start. They add up to gapMs.
   */
  readonly stages: Readonly<Record<string, number>>;
  /**
   * The completed hand's settlement spans (PostHandStageTiming), by stage.
   * These overlap and must never be added to the gap.
   */
  readonly settlement?: {
    readonly complete: boolean;
    readonly spansMs: Readonly<Record<string, number>>;
    readonly threw: readonly string[];
  } | null;
}

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const ms = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
const int = (n: unknown): number | null =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;

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
  const record = {
    v: 1,
    tableId: String(b.tableId),
    handNumber: int(b.handNumber),
    nextHandNumber: int(b.nextHandNumber),
    gapMs,
    limitMs: CASH_NEXT_HAND_LIMIT_MS,
    at: ms(b.at),
    stages: durations(b.stages),
    ...(s
      ? {
          settlement: {
            complete: s.complete === true,
            spansMs: durations(s.spansMs),
            threw: s.threw.filter((n) => NAME.test(n)),
          },
        }
      : {}),
  };
  return `${CASH_NEXT_HAND_BREACH_TAG} ${JSON.stringify(record)}`;
}

/** Writes the breach line when the gap is over the limit; one line, nothing else. */
export function reportCashNextHandBreach(
  b: CashNextHandBreach,
  log: (line: string) => void = console.warn
): void {
  try {
    const line = cashNextHandBreachLine(b);
    if (line !== null) log(line);
  } catch {
    /* Observation only: a failed log line must never hold a deal. */
  }
}
