/**
 * A DROPPED HORSE TELEMETRY BATCH REACHES PRODUCTION ALERTS THE SAME DAY (2026-11-14).
 *
 * Since #10732 a telemetry batch can be dropped unwritten in four ways: the database writer refuses its bytes
 * ('rejected'), it stays unconfirmed for an hour ('abandoned'), it is older than the retained receipt window
 * ('expired'), or the engine stops before it is written ('shutdown_unwritten'). Each was counted and printed with
 * reportError, and reportError is a line in the host log (errorReporter.ts): nobody was told. A day with a dropped
 * batch has incomplete counters in horse_brain_telemetry, so the daily upgrade audit's numbers for that day are a
 * lower bound, and the owner has to know that on the day.
 *
 * This is not a new channel. It builds an ordinary engine alert and hands it to raiseEngineAlert (engineAlerts.ts),
 * the path every other engine alert takes to the owner's Production Alerts.
 *
 * ONE ALERT PER KIND PER DAY. The alert system de-duplicates by fingerprint, `alertname:component`
 * (engineAlertDelivery.ts, transition): a fingerprint that is already firing is not raised again. The component here
 * carries the affected UTC day, so a second drop of the same kind on the same day is the same fingerprint and is
 * not repeated, and a drop on a new day is a new fingerprint and is. There is no timer and no state in this file.
 * When a later day's alert of a kind is raised, the earlier days' alerts of that kind still firing in the journal
 * are resolved, so the journal's active list stays at one entry per kind.
 *
 * AN ALERT CLOSES ITSELF. The flush says 'written' when a batch is confirmed for a day (once per UTC day per
 * thread: BrainTelemetryFlush.ts, noteWritten). Every gap alert of
 * an EARLIER day is then resolved: telemetry is flowing again. The alert's own day stays incomplete, and the
 * resolution note says so. The open alerts are read from the alert journal, so a process started today closes
 * what the process that stopped yesterday left open.
 *
 * MAIN THREAD ONLY, AND OUTSIDE THE DECISION CLOSURE. The alert journal has one owner per process. Nothing on the
 * Horse decision path imports this file: index.ts injects handleHorseTelemetryGapEvent into the flush service
 * (setBrainTelemetryGapSink), a worker thread posts its event to the main thread, and client.ts hands it to the
 * same injected sink. HorseDecisionClosure.test.ts fails if an engine alert file enters the closure.
 */
import {
  engineAlertDeliverySnapshot,
  firingFingerprints,
  raiseEngineAlert,
  resolveEngineAlert,
} from './engineAlerts.js';
import type { EngineAlertInput } from './engineAlerts.js';

export const HORSE_TELEMETRY_GAP_KINDS = [
  'rejected',
  'abandoned',
  'expired',
  'shutdown_unwritten',
] as const;
export type HorseTelemetryGapKind = (typeof HORSE_TELEMETRY_GAP_KINDS)[number];

export interface HorseTelemetryGap {
  kind: HorseTelemetryGapKind;
  /** Batches lost in this event. Zero only at shutdown, when the last partial interval was never captured. */
  batches: number;
  /** The UTC day (YYYY-MM-DD) whose counters are incomplete. */
  day: string;
  /** The publisher's worker id, as written in every batch of that thread. */
  workerId: string;
  thread: 'main' | 'worker';
  /** Shutdown only: why the stop ended with batches unwritten. */
  reason?: string;
  /** Shutdown only: the last partial interval was never captured, so its counters are lost uncounted. */
  intervalUncaptured?: boolean;
}

/** A batch was confirmed written for this UTC day: gap alerts of earlier days close. */
export interface HorseTelemetryWritten {
  kind: 'written';
  day: string;
  workerId: string;
  thread: 'main' | 'worker';
}

const ALERT_NAME: Record<HorseTelemetryGapKind, string> = {
  rejected: 'HorseTelemetryBatchRejected',
  abandoned: 'HorseTelemetryBatchAbandoned',
  expired: 'HorseTelemetryBatchExpired',
  shutdown_unwritten: 'HorseTelemetryShutdownUnwritten',
};
/** The counter that keeps counting after the day's one alert. Shutdown has none: nothing can be written then. */
const COUNTER: Partial<Record<HorseTelemetryGapKind, string>> = {
  rejected: 'phase15_telemetry_batch_rejected',
  abandoned: 'phase15_telemetry_batch_abandoned',
  expired: 'phase15_telemetry_batch_expired',
};
export const HORSE_TELEMETRY_GAP_COMPONENT_PREFIX = 'horse-telemetry-';

/** A gap can arrive as a thread message; nothing unvalidated becomes an alert. */
export function isHorseTelemetryGap(value: unknown): value is HorseTelemetryGap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const gap = value as Record<string, unknown>;
  return (
    (HORSE_TELEMETRY_GAP_KINDS as readonly unknown[]).includes(gap.kind) &&
    Number.isSafeInteger(gap.batches) &&
    (gap.batches as number) >= 0 &&
    typeof gap.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(gap.day) &&
    typeof gap.workerId === 'string' &&
    gap.workerId.length > 0 &&
    gap.workerId.length <= 64 &&
    (gap.thread === 'main' || gap.thread === 'worker') &&
    (gap.reason === undefined || (typeof gap.reason === 'string' && gap.reason.length <= 64)) &&
    (gap.intervalUncaptured === undefined || typeof gap.intervalUncaptured === 'boolean')
  );
}

function whatWasLost(gap: HorseTelemetryGap): string {
  const count = `${gap.batches} batch${gap.batches === 1 ? '' : 'es'}`;
  if (gap.kind === 'rejected') return `${count} refused by the database writer and dropped`;
  if (gap.kind === 'abandoned') return `${count} unconfirmed for an hour and dropped`;
  if (gap.kind === 'expired') return `${count} older than the retained receipt window and dropped`;
  const uncaptured = gap.intervalUncaptured
    ? ', and the last partial minute was never captured'
    : '';
  return `${count} left unwritten when the engine stopped (${gap.reason ?? 'unknown'})${uncaptured}`;
}

/** The engine alert for one gap. Pure: the same kind and day always give the same fingerprint. */
export function horseTelemetryGapAlert(gap: HorseTelemetryGap): EngineAlertInput {
  const counter = COUNTER[gap.kind];
  return {
    alertname: ALERT_NAME[gap.kind],
    // The same severity as the other Horse measurement alert (HorseRiverValueAudit.ts): no table and no chip is
    // at risk, a day's evidence is. Never a page.
    severity: 'warning',
    component: `${HORSE_TELEMETRY_GAP_COMPONENT_PREFIX}${gap.day}`,
    summary: `Horse telemetry for ${gap.day} is incomplete: ${whatWasLost(gap)}`,
    description:
      `Telemetry publisher ${gap.workerId} (${gap.thread} thread) lost ${whatWasLost(gap)}. ` +
      `The counters in it never reached horse_brain_telemetry, so every Horse counter for ${gap.day} is a lower ` +
      `bound and the daily upgrade audit's numbers for that day are a lower bound too. No decision, wager or ` +
      `table was affected. This is the only alert of this kind for ${gap.day}: ` +
      (counter
        ? `later drops that day are counted in ${counter} and are not alerted again.`
        : `a later stop the same day is not alerted again.`),
    labels: {
      kind: gap.kind,
      day: gap.day,
      batches: String(gap.batches),
      worker_id: gap.workerId,
      thread: gap.thread,
      ...(gap.reason ? { reason: gap.reason } : {}),
      ...(gap.intervalUncaptured ? { interval_uncaptured: 'true' } : {}),
    },
  };
}

/** Raise the day's alert for this kind. Never throws; an invalid gap raises nothing. */
export async function raiseHorseTelemetryGapAlert(gap: unknown): Promise<void> {
  try {
    if (!isHorseTelemetryGap(gap)) return;
    const alert = horseTelemetryGapAlert(gap);
    await raiseEngineAlert(alert);
    const current = `${alert.alertname}:${alert.component}`;
    const sameKind = `${alert.alertname}:${HORSE_TELEMETRY_GAP_COMPONENT_PREFIX}`;
    for (const fingerprint of firingFingerprints()) {
      if (fingerprint === current || !fingerprint.startsWith(sameKind)) continue;
      const earlier = fingerprint.slice(alert.alertname.length + 1);
      // Only an EARLIER day closes: an hour-old batch dropped just after midnight must not close today's alert.
      if (earlier >= alert.component) continue;
      await resolveEngineAlert(
        alert.alertname,
        earlier,
        `Closed by the alert for ${gap.day}. The earlier day's telemetry stays incomplete.`
      );
    }
  } catch {
    // An alarm never breaks the flush or the shutdown it reports on.
  }
}

/** A fingerprint that is never raised. Resolving a fingerprint that is not firing records nothing and sends
 * nothing (engineAlertDelivery.ts, transition); it only makes the delivery read its journal. */
const JOURNAL_LOAD_PROBE = `${HORSE_TELEMETRY_GAP_COMPONENT_PREFIX}journal-load`;

/** Resolve every gap alert of a day earlier than `writtenDay`. Never throws. */
export async function closeHorseTelemetryGapAlerts(writtenDay: string): Promise<void> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(writtenDay)) return;
    // After a restart nothing may have read the journal yet, and yesterday's alert is only in the journal.
    if (!engineAlertDeliverySnapshot().loaded)
      await resolveEngineAlert(ALERT_NAME.rejected, JOURNAL_LOAD_PROBE);
    const names = new Set(Object.values(ALERT_NAME));
    for (const fingerprint of firingFingerprints()) {
      const split = fingerprint.indexOf(':');
      const alertname = fingerprint.slice(0, split);
      const component = fingerprint.slice(split + 1);
      if (!names.has(alertname) || !component.startsWith(HORSE_TELEMETRY_GAP_COMPONENT_PREFIX))
        continue;
      const day = component.slice(HORSE_TELEMETRY_GAP_COMPONENT_PREFIX.length);
      // The same day never closes: a batch written today does not show today's loss is over.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= writtenDay) continue;
      await resolveEngineAlert(
        alertname,
        component,
        `Horse telemetry is being written again: a batch for ${writtenDay} was confirmed. ` +
          `${day} stays incomplete; the counters lost that day are not recovered.`
      );
    }
  } catch {
    // An alarm never breaks the flush it reports on.
  }
}

/** The one sink the main process injects into the flush service (index.ts). Validates everything it is given:
 * an event can come from a worker thread. Never throws. */
export async function handleHorseTelemetryGapEvent(event: unknown): Promise<void> {
  const written = event as Partial<HorseTelemetryWritten> | null;
  if (written !== null && typeof written === 'object' && written.kind === 'written') {
    if (typeof written.day === 'string') await closeHorseTelemetryGapAlerts(written.day);
    return;
  }
  await raiseHorseTelemetryGapAlert(event);
}
