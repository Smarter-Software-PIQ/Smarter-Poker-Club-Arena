/**
 * THE RESTART GATE NAMES ITS TABLES, AND SAYS BEFORE A BREAK WHAT NO BREAK
 * CAN CLEAR (2026-11-06).
 *
 * /health published how many tables held the restart certificate shut and
 * why, but never which: the release gate could only prove "no hand is in the
 * air anywhere", never "this table's hand never started". And a release whose
 * certificate could not open still announced its Deployment Recovery break
 * and paused every table for five minutes (42139090188-1, 01:22Z).
 *
 * Pinned here, on the real census:
 *  1. maintenance.unparkedTableIds names every counted table with its reason,
 *     bounded, and a held original that never started carries its permit and
 *     hand number; it is empty outside a break.
 *  2. maintenance.restartPrecheck names only what no break can clear: a
 *     started hand frozen past FROZEN_HAND_PRECHECK_MS and stopped custody
 *     past its bound. A hand in progress and a held original are never named.
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

function breakWith(engines: Array<[string, Engine]>, active = true): MaintenanceBreak {
  const mb = new MaintenanceBreak({
    engines: () => new Map(engines) as never,
    isRunning: () => true,
  } as never);
  if (active) Object.assign(mb as never, { phase: 'counting_down', durableConfirmed: true });
  return mb;
}
type Snap = {
  unparkedTables: number;
  unparkedTableIds: Array<Record<string, unknown>>;
  restartPrecheck: { persistent: Record<string, number>; tables: Array<Record<string, unknown>> };
};
const snap = (mb: MaintenanceBreak) => mb.snapshot() as unknown as Snap;

const T1 = '72417d9c-f9ff-417b-b902-26016d4a2571';
const T2 = 'aed78e3f-850b-4929-bb1d-1503449b41ce';

describe('1. the census names its tables', () => {
  it('names a cards_in_air table and a held original with its permit and hand', () => {
    const mb = breakWith([
      [
        T1,
        table({
          isBetweenHands: () => false,
          isPreparedOriginalHeldForMaintenance: () => false,
          describeHeldOriginalAtPauseGate: () => ({
            permitId: 'b7c07f7c-0000-4000-8000-000000000001',
            handNumber: '55620681',
          }),
        }),
      ],
      [T2, table({ isBetweenHands: () => false })],
      ['quiet', table()],
    ]);
    const s = snap(mb);
    expect(s.unparkedTables).toBe(2);
    expect(s.unparkedTableIds).toEqual([
      {
        tableId: T1,
        reason: 'cards_in_air',
        permitId: 'b7c07f7c-0000-4000-8000-000000000001',
        handNumber: '55620681',
      },
      { tableId: T2, reason: 'cards_in_air' },
    ]);
  });
  it('names a durability refusal under its own reason', () => {
    const mb = breakWith([
      [
        T1,
        table({
          isMaintenanceStateDurable: () => false,
          maintenanceDurabilityReason: () => 'bank_park_write_incomplete',
        }),
      ],
    ]);
    expect(snap(mb).unparkedTableIds).toEqual([
      { tableId: T1, reason: 'bank_park_write_incomplete' },
    ]);
  });
  it('a parked held original is not named at all', () => {
    const mb = breakWith([
      [
        T1,
        table({ isBetweenHands: () => false, isPreparedOriginalHeldForMaintenance: () => true }),
      ],
    ]);
    expect(snap(mb).unparkedTableIds).toEqual([]);
  });
  it('the list is bounded and every name matches the count', () => {
    const engines: Array<[string, Engine]> = Array.from({ length: 80 }, (_, i) => [
      'f' + String(i).padStart(7, '0') + '-0000-4000-8000-000000000000',
      table({ isBetweenHands: () => false }),
    ]);
    const s = snap(breakWith(engines));
    expect(s.unparkedTables).toBe(80);
    expect(s.unparkedTableIds).toHaveLength(MaintenanceBreak.UNPARKED_TABLE_IDS_LIMIT);
  });
  it('is empty outside a break', () => {
    const mb = breakWith([[T1, table({ isBetweenHands: () => false })]], false);
    expect(snap(mb).unparkedTableIds).toEqual([]);
  });
});

describe('2. the precheck names only what no break can clear', () => {
  it('a started hand frozen past the bound is named', () => {
    const mb = breakWith(
      [
        [
          T1,
          table({
            isBetweenHands: () => false,
            msSinceProgress: () => MaintenanceBreak.FROZEN_HAND_PRECHECK_MS + 1,
          }),
        ],
      ],
      false
    );
    expect(snap(mb).restartPrecheck).toEqual({
      persistent: { frozen_hand: 1 },
      tables: [{ tableId: T1, reason: 'frozen_hand' }],
    });
  });
  it('a hand in progress is transient and not named', () => {
    const mb = breakWith(
      [[T1, table({ isBetweenHands: () => false, msSinceProgress: () => 4_000 })]],
      false
    );
    expect(snap(mb).restartPrecheck.persistent).toEqual({});
  });
  it('a held original that never started is admitted and not named, however long', () => {
    const mb = breakWith(
      [
        [
          T1,
          table({
            isBetweenHands: () => false,
            isPreparedOriginalHeldAtPauseGate: () => true,
            msSinceProgress: () => 9 * 3_600_000,
          }),
        ],
      ],
      false
    );
    expect(snap(mb).restartPrecheck.persistent).toEqual({});
  });
  it('stopped custody is named only past its bound', () => {
    const custody = table({
      hasUnretiredStoppedTimeBankCustody: () => true,
      isRunning: () => false,
    });
    const mb = breakWith([[T1, custody]], false);
    expect(snap(mb).restartPrecheck.persistent).toEqual({});
    (mb as unknown as { stoppedCustodySince: Map<string, number> }).stoppedCustodySince.set(
      T1,
      Date.now() - MaintenanceBreak.STOPPED_CUSTODY_GATE_MS - 1
    );
    expect(snap(mb).restartPrecheck.persistent).toEqual({ stopped_bank_custody_stuck: 1 });
  });
  it('an engine that does not report progress is not named', () => {
    const mb = breakWith([[T1, table({ isBetweenHands: () => false })]], false);
    expect(snap(mb).restartPrecheck.persistent).toEqual({});
  });
});
