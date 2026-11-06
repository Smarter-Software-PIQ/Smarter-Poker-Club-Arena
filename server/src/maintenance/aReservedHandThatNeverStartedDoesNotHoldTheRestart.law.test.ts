/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW: A RESERVED HAND THAT NEVER STARTED DOES NOT HOLD THE RESTART (2026-11-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Release 42126015699-1 announced the 23:20 Deployment Recovery break at
 * 23:20:00.953Z. Spin 9139b7d2 had allocated hand 55574170 at 23:20:01.301Z
 * and was retaining its sequence-zero original when the break's park reached
 * it; the engine then held that original at the pause gate, unstarted, as it
 * must (an attempted retention can never become never_started, and a break
 * forbids starting it). The restart census asked only `isBetweenHands()`, so
 * it named the table `cards_in_air` for the whole break, the certificate
 * never opened, and the release backed out - as 42099609162-1 had at 20:27Z.
 *
 * Pinned here, at the census: a table whose engine positively names that
 * held, never-started original (`isPreparedOriginalHeldForMaintenance()`)
 * is not cards in the air; its durability is still asked; and every other
 * table without a free controller - including an engine that does not
 * answer, or answers anything but `true` - is still `cards_in_air`.
 */
import { describe, expect, it } from 'vitest';
import { MaintenanceBreak } from './MaintenanceBreak.js';

type Engine = Record<string, unknown>;
const table = (over: Engine = {}): Engine => ({
  isRunning: () => true,
  isBetweenHands: () => true,
  isParkedBetweenHands: () => true,
  pauseForMaintenance: () => {},
  resumeFromMaintenance: () => {},
  isMaintenanceStateDurable: () => true,
  maintenanceDurabilityReason: () => null,
  ...over,
});

function countingDown(engines: Array<[string, Engine]>): MaintenanceBreak {
  const mb = new MaintenanceBreak({
    engines: () => new Map(engines) as never,
    isRunning: () => true,
  } as never);
  Object.assign(mb as never, { phase: 'counting_down', durableConfirmed: true });
  return mb;
}
const reasons = (mb: MaintenanceBreak) =>
  (mb.snapshot().unparkedReasons ?? {}) as Record<string, number>;

describe('a reserved hand that never started does not hold the restart', () => {
  it('a held, never-started original is parked, not cards in the air', () => {
    const mb = countingDown([
      [
        '9139b7d2',
        table({
          isBetweenHands: () => false,
          isPreparedOriginalHeldForMaintenance: () => true,
        }),
      ],
      ['other', table()],
    ]);
    expect(mb.snapshot().unparkedTables).toBe(0);
    expect(reasons(mb)).not.toHaveProperty('cards_in_air');
  });

  it('its time banks are still asked: a held original with an unwritten park still refuses', () => {
    const mb = countingDown([
      [
        '9139b7d2',
        table({
          isBetweenHands: () => false,
          isPreparedOriginalHeldForMaintenance: () => true,
          isMaintenanceStateDurable: () => false,
          maintenanceDurabilityReason: () => 'bank_park_write_incomplete',
        }),
      ],
    ]);
    expect(mb.snapshot().unparkedTables).toBe(1);
    expect(reasons(mb)).toMatchObject({ bank_park_write_incomplete: 1 });
    expect(reasons(mb)).not.toHaveProperty('cards_in_air');
  });

  it.each([
    ['an engine that does not answer', undefined],
    ['an engine that answers false', () => false],
    ['an engine that answers a non-boolean', () => 'yes'],
  ])('%s with a controller is still cards_in_air', (_label, answer) => {
    const mb = countingDown([
      [
        'a',
        table({
          isBetweenHands: () => false,
          ...(answer ? { isPreparedOriginalHeldForMaintenance: answer } : {}),
        }),
      ],
    ]);
    expect(mb.snapshot().unparkedTables).toBe(1);
    expect(reasons(mb)).toMatchObject({ cards_in_air: 1 });
  });
});
