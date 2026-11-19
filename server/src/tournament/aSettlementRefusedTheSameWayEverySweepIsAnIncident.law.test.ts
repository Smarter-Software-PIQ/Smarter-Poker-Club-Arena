/**
 * A SETTLEMENT THAT IS REFUSED THE SAME WAY EVERY SWEEP IS A FINANCIAL
 * INCIDENT, NOT A LOG LINE (2026-10-08).
 *
 * Satellite 32190e8c "Sunday Deep Stack Satellite $25" was refused with
 * `has missing or extra obligation evidence` ~500 times between 2026-10-07
 * 17:38Z and 2026-10-08 11:05Z, three qualifiers unpaid, its one table parked
 * at the qualifier boundary for 17 hours, and nothing but an error-reporter
 * line per sweep said so. The refusal counter raises one CRITICAL financial
 * alert on the first repeat, keyed on the tournament, refreshes it every
 * SATELLITE_REFUSAL_ALERT_EVERY_MS while the refusals continue, and clears
 * when a settlement goes through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const alerts = vi.hoisted(() => ({
  raise: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true })),
}));
vi.mock('../services/financialAlerts.js', () => ({ raiseFinancialAlert: alerts.raise }));
vi.mock('../services/errorReporter.js', () => ({
  reportError: vi.fn(),
  describeError: (value: unknown) => String(value),
}));

import { TournamentManager } from './TournamentManager.js';
import { TournamentManagerEliminations } from './TournamentManagerEliminations.js';
import { SatelliteSettlementRefusedError } from './satelliteSettlementRpc.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = id(1);

function manager() {
  const m: any = new TournamentManager(EVENT, {} as any, id(9), performance.now() + 60000);
  return m;
}

afterEach(() => {
  vi.useRealTimers();
  alerts.raise.mockClear();
});

describe('a settlement refused the same way every sweep is an incident', () => {
  it('raises one critical alert on the first repeat, keyed on the tournament', async () => {
    const m = manager();
    const refusal = new SatelliteSettlementRefusedError(
      `satellite ${EVENT} has missing or extra obligation evidence`
    );
    await m.recordSatelliteSettlementRefusal(refusal, 3);
    expect(alerts.raise).not.toHaveBeenCalled();
    await m.recordSatelliteSettlementRefusal(refusal, 3);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    const [severity, source, message, context, dedupeKey, entityId] = alerts.raise.mock.calls[0];
    expect(severity).toBe('critical');
    expect(source).toBe('Tournament.satellite_qualifiers_refused_repeatedly');
    expect(message).toContain('refused 2 times');
    expect(context).toMatchObject({
      tournament_id: EVENT,
      qualifier_count: 3,
      refusal_count: 2,
      refusal: refusal.message,
    });
    expect(dedupeKey).toBe(`satellite-qualifiers-refused:${EVENT}`);
    expect(entityId).toBe(EVENT);
  });

  it('refreshes the alert only every SATELLITE_REFUSAL_ALERT_EVERY_MS while refusals continue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    const m = manager();
    const refusal = new SatelliteSettlementRefusedError('refused');
    for (let i = 0; i < 20; i += 1) await m.recordSatelliteSettlementRefusal(refusal, 3);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    vi.setSystemTime(
      new Date(Date.now() + TournamentManagerEliminations.SATELLITE_REFUSAL_ALERT_EVERY_MS + 1)
    );
    await m.recordSatelliteSettlementRefusal(refusal, 3);
    expect(alerts.raise).toHaveBeenCalledTimes(2);
    expect(alerts.raise.mock.calls[1][3]).toMatchObject({ refusal_count: 21 });
  });

  it('starts a new count when the refusal changes, and clears when a settlement goes through', async () => {
    const m = manager();
    await m.recordSatelliteSettlementRefusal(new SatelliteSettlementRefusedError('one'), 3);
    await m.recordSatelliteSettlementRefusal(new SatelliteSettlementRefusedError('two'), 3);
    expect(alerts.raise).not.toHaveBeenCalled();
    expect(m.satelliteRefusals).toMatchObject({ count: 1, message: 'two' });
    m.satelliteRefusals = null;
    await m.recordSatelliteSettlementRefusal(new SatelliteSettlementRefusedError('two'), 3);
    expect(m.satelliteRefusals).toMatchObject({ count: 1 });
  });
  // Production 2026-11-18 19:22Z, satellite 3f9f1ff2 (incident a30d27f9): two
  // 57014 cancellations ten seconds apart paged critical, and the third sweep
  // settled all 20 qualifiers eleven seconds later.
  it('a busy-database refusal pages only once it has persisted for the grace period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T19:22:17Z'));
    const m = manager();
    const busy = new SatelliteSettlementRefusedError('canceling statement due to statement timeout');
    await m.recordSatelliteSettlementRefusal(busy, 20);
    vi.setSystemTime(new Date(Date.now() + 10_000));
    await m.recordSatelliteSettlementRefusal(busy, 20);
    expect(alerts.raise).not.toHaveBeenCalled();
    m.satelliteRefusals = null; // the next sweep settled
    for (let i = 0; i < 4; i += 1) {
      await m.recordSatelliteSettlementRefusal(busy, 20);
      vi.setSystemTime(new Date(Date.now() + 60_000));
    }
    expect(alerts.raise).not.toHaveBeenCalled();
    vi.setSystemTime(
      new Date(Date.now() + TournamentManagerEliminations.SATELLITE_CONTENTION_GRACE_MS)
    );
    await m.recordSatelliteSettlementRefusal(busy, 20);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    expect(alerts.raise.mock.calls[0][1]).toBe('Tournament.satellite_qualifiers_refused_repeatedly');
  });

  it('classifies only busy-database refusals as contention', () => {
    const busy = TournamentManagerEliminations.isContentionRefusal;
    expect(busy('canceling statement due to statement timeout')).toBe(true);
    expect(busy('canceling statement due to lock timeout (55P03)')).toBe(true);
    expect(busy('deadlock detected (40P01)')).toBe(true);
    expect(busy('could not serialize access due to concurrent update')).toBe(true);
    expect(busy(`satellite ${EVENT} has missing or extra obligation evidence`)).toBe(false);
    expect(busy('IDEMPOTENCY_RECEIPT_UNBOUND (55000)')).toBe(false);
  });
});
