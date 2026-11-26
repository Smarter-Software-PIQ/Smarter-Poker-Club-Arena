/**
 * THE HAND'S OPTION RECEIPTS ARE WRITTEN AFTER THE HAND, NEVER WITH IT
 * (2026-11-25, Hold'em Strategy lane; engine/HorseHandOptionReceipts.ts).
 *
 * One row per (hand, receipt) in public.ca_horse_hand_receipts, for a hand a
 * person was dealt into. Called from logHandHistory after the hand's own
 * commit has returned, fire-and-forget like writeHandFacts and
 * recordHorseHandReviews: the hand save never waits for it, and a failed or
 * refused write (the table not installed yet, a timeout) is never thrown.
 * Insert only; a replayed hand inserts nothing twice (the primary key is
 * (hand_id, receipt)).
 *
 * A row is an option name, two action kinds and a count. No card of any kind
 * can reach it: the rows are rebuilt here from the closed row text
 * (horseHandReceiptRows), and the table refuses anything else.
 *
 * A LOST RECEIPT IS VISIBLE FROM OUTSIDE THE ENGINE (2026-11-26). A failed
 * write used to be one throttled line in the host console, which nobody can
 * read without a shell on the engine: on 2026-11-26 the coordinator had to
 * rule failure out by counting hands. Now:
 *   - a process-lifetime tally (hands attempted, rows written, writes failed,
 *     last failure time and a closed-vocabulary failure class) is published
 *     on the engine's public /health payload as `horseHandReceipts`
 *     (horseHandReceiptsSnapshot, pure);
 *   - the first failure raises HorseHandReceiptsNotWritten through
 *     raiseEngineAlert (engineAlerts.ts), the path every engine alert takes to
 *     the owner's Production Alerts, and the next successful write resolves
 *     it, so the alert closes itself. This file is on the Horse decision
 *     closure (HorseDecisionClosure.test.ts: no engine alert file may enter
 *     it), so it never imports the alert module: index.ts injects the two
 *     calls with setHorseHandReceiptsAlertSink, in the main process, the same
 *     way it wires the telemetry gap and opponent HUD alerts.
 * The failure text is a fixed word plus at most a Postgres or PostgREST
 * error code (five characters, or PGRST and three digits): never the database's message, which can quote a failing row.
 * No card, user id or token can be in it by construction.
 */
import { supabase } from './supabase/client.js';
import { reportThrottled } from './errorReporter.js';
import type { EngineAlertInput } from './engineAlerts.js';
import { horseHandReceiptRows } from '../engine/HorseHandOptionReceipts.js';

export const HORSE_HAND_RECEIPTS_TABLE = 'ca_horse_hand_receipts';
export const HORSE_HAND_RECEIPTS_WRITE_TIMEOUT_MS = 5_000;
export const HORSE_HAND_RECEIPTS_ALERT = 'HorseHandReceiptsNotWritten';
export const HORSE_HAND_RECEIPTS_ALERT_COMPONENT = 'horse-hand-receipts';

/** Every failure class the tally can carry. Nothing outside this set is ever published. */
export const HORSE_HAND_RECEIPT_FAILURE_KINDS = [
  'timeout',
  'table_missing',
  'refused',
  'network',
  'error',
] as const;
export type HorseHandReceiptFailureKind = (typeof HORSE_HAND_RECEIPT_FAILURE_KINDS)[number];

export interface HorseHandReceiptsSnapshot {
  /** Hands that had at least one receipt row to write. */
  handsAttempted: number;
  /** Rows the database accepted (a replayed duplicate counts as sent). */
  rowsWritten: number;
  /** Hands whose write failed, timed out or was refused. */
  writesFailed: number;
  /** ISO time of the last failure, null when none in this process. */
  lastFailureAt: string | null;
  /** `<kind>` or `<kind>:<pg code>`, closed vocabulary; null when none. */
  lastError: string | null;
  /** ISO time of the last successful write, null when none in this process. */
  lastWrittenAt: string | null;
}

const tally = {
  handsAttempted: 0,
  rowsWritten: 0,
  writesFailed: 0,
  lastFailureAt: null as number | null,
  lastError: null as string | null,
  lastWrittenAt: null as number | null,
};
/** The main process's alert calls (index.ts). Null in a worker thread or a test that sets none. */
export interface HorseHandReceiptsAlertSink {
  raise(alert: EngineAlertInput): void;
  resolve(alertname: string, component: string, summary: string): void;
}
let alertSink: HorseHandReceiptsAlertSink | null = null;
export function setHorseHandReceiptsAlertSink(sink: HorseHandReceiptsAlertSink | null): void {
  alertSink = sink;
}

/** True while this process holds the alert raised. */
let alerting = false;
/** The first success in a process closes an alert a previous process left in the journal. */
let resolvedSinceStart = false;

/** Maps any thrown value to the closed failure text. Never reads the message into the result. */
export function horseHandReceiptFailureText(error: unknown): string {
  try {
    const e = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
    const name = typeof e.name === 'string' ? e.name : '';
    const message = typeof e.message === 'string' ? e.message : String(error);
    const code =
      typeof e.code === 'string' && /^(?:\d{2}[0-9A-Z]{3}|PGRST\d{3})$/.test(e.code)
        ? e.code
        : null;
    let kind: HorseHandReceiptFailureKind;
    if (name === 'TimeoutError' || name === 'AbortError' || /\babort|timed? ?out\b/i.test(message))
      kind = 'timeout';
    else if (
      code === '42P01' ||
      code === 'PGRST205' ||
      /does not exist|schema cache|could not find the table/i.test(message)
    )
      kind = 'table_missing';
    else if (code !== null) kind = 'refused';
    else if (/fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(message))
      kind = 'network';
    else kind = 'error';
    return code ? `${kind}:${code}` : kind;
  } catch {
    return 'error';
  }
}

/** The process-lifetime tally. Pure: reads counters, never throws, never writes. */
export function horseHandReceiptsSnapshot(): HorseHandReceiptsSnapshot {
  return {
    handsAttempted: tally.handsAttempted,
    rowsWritten: tally.rowsWritten,
    writesFailed: tally.writesFailed,
    lastFailureAt:
      tally.lastFailureAt === null ? null : new Date(tally.lastFailureAt).toISOString(),
    lastError: tally.lastError,
    lastWrittenAt:
      tally.lastWrittenAt === null ? null : new Date(tally.lastWrittenAt).toISOString(),
  };
}

/** Test seam. */
export function __resetHorseHandReceiptsTally(): void {
  tally.handsAttempted = 0;
  tally.rowsWritten = 0;
  tally.writesFailed = 0;
  tally.lastFailureAt = null;
  tally.lastError = null;
  tally.lastWrittenAt = null;
  alerting = false;
  resolvedSinceStart = false;
}

/** True when this hand writes receipt rows: a person was dealt in and an option changed a decision. */
export function handWritesOptionReceipts(
  rosterHasHuman: boolean | undefined,
  counts: Readonly<Record<string, number>> | null | undefined
): counts is Readonly<Record<string, number>> {
  return rosterHasHuman === true && !!counts && Object.keys(counts).length > 0;
}

function noteWritten(rows: number): void {
  tally.rowsWritten += rows;
  tally.lastWrittenAt = Date.now();
  if (alerting || !resolvedSinceStart) {
    const wasAlerting = alerting;
    alerting = false;
    resolvedSinceStart = true;
    try {
      alertSink?.resolve(
        HORSE_HAND_RECEIPTS_ALERT,
        HORSE_HAND_RECEIPTS_ALERT_COMPONENT,
        wasAlerting
          ? `Hand option receipts are being written again (${tally.writesFailed} hand(s) lost in this process).`
          : 'Hand option receipts are being written.'
      );
    } catch {
      /* an alarm never breaks the write it reports on */
    }
  }
}

function noteFailed(error: unknown): void {
  tally.writesFailed += 1;
  tally.lastFailureAt = Date.now();
  tally.lastError = horseHandReceiptFailureText(error);
  try {
    reportThrottled(
      'HorseHandReceipts.write_failed',
      `hand option receipts not written: ${tally.lastError}`
    );
  } catch {
    /* reporting a lost receipt never throws */
  }
  if (alerting) return;
  alerting = true;
  try {
    alertSink?.raise(horseHandReceiptsAlert(tally.lastError));
  } catch {
    /* an alarm never breaks the write it reports on */
  }
}

/** The engine alert for a lost receipt. Pure; `failure` is the closed failure text. */
export function horseHandReceiptsAlert(failure: string): EngineAlertInput {
  return {
    alertname: HORSE_HAND_RECEIPTS_ALERT,
    // A measurement is at risk, not a table or a chip: the same severity as the
    // other Horse evidence alerts (HorseRiverValueAudit.ts, horseTelemetryGapAlert.ts). Never a page.
    severity: 'warning',
    component: HORSE_HAND_RECEIPTS_ALERT_COMPONENT,
    summary: `Hand option receipts are not being written (${failure})`,
    description:
      'A per-hand Horse option receipt write to public.ca_horse_hand_receipts failed. No hand, chip or ' +
      'decision was affected (the write runs after the hand is saved), but person-vs-horse results by option ' +
      'receipt are a lower bound until this resolves. The running tally is on the engine /health payload as ' +
      '`horseHandReceipts`; the alert resolves itself on the next successful write.',
    page: false,
    labels: { failure },
  };
}

/** Writes the hand's rows; resolves to how many were sent (0 on nothing to write or any failure). Never rejects. */
export async function writeHorseHandReceipts(
  handId: string,
  counts: Readonly<Record<string, number>> | null | undefined
): Promise<number> {
  try {
    const rows = horseHandReceiptRows(handId, counts);
    if (rows.length === 0) return 0;
    tally.handsAttempted += 1;
    const { error } = await supabase
      .from(HORSE_HAND_RECEIPTS_TABLE)
      .upsert(rows, { onConflict: 'hand_id,receipt', ignoreDuplicates: true })
      .abortSignal(AbortSignal.timeout(HORSE_HAND_RECEIPTS_WRITE_TIMEOUT_MS));
    if (error) throw error;
    noteWritten(rows.length);
    return rows.length;
  } catch (error) {
    try {
      noteFailed(error);
    } catch {
      /* the tally never throws */
    }
    return 0;
  }
}
