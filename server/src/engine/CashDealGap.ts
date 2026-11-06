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
