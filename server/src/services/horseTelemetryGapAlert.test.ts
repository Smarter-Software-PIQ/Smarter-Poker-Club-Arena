/**
 * A dropped Horse telemetry batch is ONE engine alert per kind per UTC day (2026-11-14).
 *
 * These run the real engine alert delivery (engineAlerts.ts + engineAlertDelivery.ts) over an in-memory journal,
 * so the de-duplication proved here is the alert system's own fingerprint rule, not a copy of it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAlertJournal } from './engineAlertDelivery.js';
import { emptyAlertJournal } from './engineAlertJournal.js';
import { __setEngineAlertJournal, firingFingerprints } from './engineAlerts.js';
import {
  HORSE_TELEMETRY_GAP_KINDS,
  horseTelemetryGapAlert,
  isHorseTelemetryGap,
  raiseHorseTelemetryGapAlert,
  type HorseTelemetryGap,
} from './horseTelemetryGapAlert.js';

let journal: MemoryAlertJournal;
const gap = (over: Partial<HorseTelemetryGap> = {}): HorseTelemetryGap => ({
  kind: 'rejected',
  batches: 1,
  day: '2026-11-14',
  workerId: '7b0c0f6e-1111-4222-8333-444455556666',
  thread: 'worker',
  ...over,
});
const events = () =>
  journal.state.pending.map((event) => ({
    status: event.alert.status,
    fingerprint: event.alert.fingerprint,
  }));

beforeEach(() => {
  journal = new MemoryAlertJournal(emptyAlertJournal());
  __setEngineAlertJournal(journal);
});

describe('Horse telemetry gap alerts', () => {
  it('raises one alert for two drops of the same kind on the same day', async () => {
    await raiseHorseTelemetryGapAlert(gap());
    await raiseHorseTelemetryGapAlert(gap({ workerId: 'another-worker', thread: 'main' }));
    await raiseHorseTelemetryGapAlert(gap({ batches: 3 }));
    expect(events()).toEqual([
      { status: 'firing', fingerprint: 'HorseTelemetryBatchRejected:horse-telemetry-2026-11-14' },
    ]);
  });

  it('raises a new alert on a new day and closes the earlier day, so one alert per kind stays open', async () => {
    await raiseHorseTelemetryGapAlert(gap());
    await raiseHorseTelemetryGapAlert(gap({ day: '2026-11-15' }));
    expect(events()).toEqual([
      { status: 'firing', fingerprint: 'HorseTelemetryBatchRejected:horse-telemetry-2026-11-14' },
      { status: 'firing', fingerprint: 'HorseTelemetryBatchRejected:horse-telemetry-2026-11-15' },
      { status: 'resolved', fingerprint: 'HorseTelemetryBatchRejected:horse-telemetry-2026-11-14' },
    ]);
    expect(firingFingerprints()).toEqual([
      'HorseTelemetryBatchRejected:horse-telemetry-2026-11-15',
    ]);
    // the new day is itself de-duplicated
    await raiseHorseTelemetryGapAlert(gap({ day: '2026-11-15' }));
    expect(events()).toHaveLength(3);
  });

  it('does not let a late drop for yesterday close the alert already open for today', async () => {
    await raiseHorseTelemetryGapAlert(gap({ kind: 'abandoned', day: '2026-11-15' }));
    await raiseHorseTelemetryGapAlert(gap({ kind: 'abandoned', day: '2026-11-14' }));
    expect(firingFingerprints()).toEqual([
      'HorseTelemetryBatchAbandoned:horse-telemetry-2026-11-14',
      'HorseTelemetryBatchAbandoned:horse-telemetry-2026-11-15',
    ]);
    expect(events().filter((event) => event.status === 'resolved')).toEqual([]);
  });

  it('alerts each kind separately and never closes another kind', async () => {
    for (const kind of HORSE_TELEMETRY_GAP_KINDS) await raiseHorseTelemetryGapAlert(gap({ kind }));
    await raiseHorseTelemetryGapAlert(gap({ kind: 'expired', day: '2026-11-15' }));
    expect(firingFingerprints()).toEqual([
      'HorseTelemetryBatchAbandoned:horse-telemetry-2026-11-14',
      'HorseTelemetryBatchExpired:horse-telemetry-2026-11-15',
      'HorseTelemetryBatchRejected:horse-telemetry-2026-11-14',
      'HorseTelemetryShutdownUnwritten:horse-telemetry-2026-11-14',
    ]);
  });

  it.each([
    ['rejected', 1, '1 batch refused by the database writer and dropped'],
    ['abandoned', 1, '1 batch unconfirmed for an hour and dropped'],
    ['expired', 2, '2 batches older than the retained receipt window and dropped'],
  ] as const)('says in plain words what a %s batch lost', async (kind, batches, lost) => {
    await raiseHorseTelemetryGapAlert(gap({ kind, batches }));
    const { alert } = journal.state.pending[0]!;
    expect(alert.annotations.summary).toBe(`Horse telemetry for 2026-11-14 is incomplete: ${lost}`);
    expect(alert.annotations.description).toContain('7b0c0f6e-1111-4222-8333-444455556666');
    expect(alert.annotations.description).toContain('worker thread');
    expect(alert.annotations.description).toContain('lower bound');
    expect(alert.annotations.description).toContain(`phase15_telemetry_batch_${kind}`);
    expect(alert.labels).toMatchObject({
      severity: 'warning',
      kind,
      day: '2026-11-14',
      batches: String(batches),
      worker_id: '7b0c0f6e-1111-4222-8333-444455556666',
      thread: 'worker',
      // operational, never a page: nothing here reaches a phone the alert policy would not send
      engine_alert_priority: 'normal',
    });
  });

  it('says what a shutdown left unwritten, why, and whether the last minute was captured', () => {
    const alert = horseTelemetryGapAlert(
      gap({
        kind: 'shutdown_unwritten',
        batches: 4,
        thread: 'main',
        reason: 'time budget',
        intervalUncaptured: true,
      })
    );
    expect(alert.summary).toBe(
      'Horse telemetry for 2026-11-14 is incomplete: 4 batches left unwritten when the engine stopped (time budget), and the last partial minute was never captured'
    );
    expect(alert.severity).toBe('warning');
    expect(alert.page).toBeUndefined();
    expect(alert.labels).toMatchObject({ reason: 'time budget', interval_uncaptured: 'true' });
  });

  it('raises nothing for a message that is not a valid gap, and never throws', async () => {
    for (const bad of [
      null,
      'rejected',
      [],
      gap({ kind: 'lost' as never }),
      gap({ day: '14 November' }),
      gap({ batches: -1 }),
      gap({ batches: 1.5 }),
      gap({ workerId: '' }),
      gap({ thread: 'equity' as never }),
      gap({ reason: 'x'.repeat(65) }),
    ]) {
      expect(isHorseTelemetryGap(bad)).toBe(false);
      await expect(raiseHorseTelemetryGapAlert(bad)).resolves.toBeUndefined();
    }
    expect(events()).toEqual([]);
    expect(isHorseTelemetryGap(gap())).toBe(true);
  });

  it('does not throw when the alert journal cannot be read', async () => {
    __setEngineAlertJournal({
      load: async () => {
        throw new Error('disk gone');
      },
      save: async () => undefined,
    });
    await expect(raiseHorseTelemetryGapAlert(gap())).resolves.toBeUndefined();
  });
});
