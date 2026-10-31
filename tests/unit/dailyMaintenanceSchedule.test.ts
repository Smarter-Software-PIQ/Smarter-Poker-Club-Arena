import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isRoutineMaintenanceUpcoming,
  observedMaintenanceSchedule,
  PHASE1_MAINTENANCE_POLICY_ID,
} from '../../src/utils/maintenanceSchedule';

describe('the lobby advertises only the daily Chicago maintenance window', () => {
  it.each([
    ['2026-10-20T08:54:59Z', false],
    ['2026-10-20T08:55:00Z', true],
    ['2026-10-20T08:57:59Z', true],
    ['2026-10-20T08:58:00Z', false],
    ['2026-11-01T09:55:00Z', true],
    ['2026-11-01T08:55:00Z', false],
    ['2026-03-08T08:55:00Z', true],
    ['2026-03-08T09:55:00Z', false],
  ])('uses IANA Chicago time at %s', (iso, expected) => {
    expect(isRoutineMaintenanceUpcoming(Date.parse(iso))).toBe(expected);
  });
  it('never advertises a cash freeze at ordinary hourly tournament breaks', () => {
    for (let hour = 0; hour < 24; hour++) {
      const at = Date.UTC(2026, 9, 20, hour, 50);
      expect(isRoutineMaintenanceUpcoming(at)).toBe(false);
    }
  });
});

const daily = {
  timeZone: 'America/Chicago',
  startHour: 4,
  startMinute: 0,
  durationMs: 300000,
  nextAnnouncementAt: 1793491080000,
  hourlyCashFreeze: false,
};
const hourly = {
  ...daily,
  startHour: null,
  frequency: 'phase1-hourly',
  policyId: 'phase1-hourly-01a1944f',
  hourlyCashFreeze: true,
};
describe('serving schedule, independent of desired source mode', () => {
  it('recognizes old daily and actual hourly then adopted daily', () => {
    expect(observedMaintenanceSchedule(daily)).toBe('daily');
    expect(observedMaintenanceSchedule(hourly)).toBe('phase1-hourly');
    expect(
      observedMaintenanceSchedule({ ...daily, frequency: 'daily', policyId: hourly.policyId })
    ).toBe('daily');
  });
  it.each([
    undefined,
    null,
    {},
    { ...hourly, policyId: 'unknown' },
    { ...hourly, startHour: 4 },
    { ...hourly, hourlyCashFreeze: false },
    { ...hourly, durationMs: 299999 },
    { ...hourly, startMinute: 58 },
    { ...hourly, timeZone: 'UTC' },
    { ...hourly, nextAnnouncementAt: NaN },
    { ...daily, frequency: 'phase1-hourly' },
    { ...daily, policyId: hourly.policyId },
  ])('refuses malformed tuples %j', (value) => {
    expect(observedMaintenanceSchedule(value)).toBe('unknown');
  });
  it.each([
    ['2026-10-20T12:54:59Z', false],
    ['2026-10-20T12:55:00Z', true],
    ['2026-10-20T12:57:59Z', true],
    ['2026-10-20T12:58:00Z', false],
    ['2026-11-01T06:55:00Z', true],
    ['2026-11-01T07:55:00Z', true],
    ['2026-03-08T07:55:00Z', true],
    ['2026-03-08T08:55:00Z', true],
  ])('uses actual hourly Chicago lead-in through DST %s', (iso, expected) => {
    expect(isRoutineMaintenanceUpcoming(Date.parse(iso), 'phase1-hourly')).toBe(expected);
  });
  it('makes no routine promise for unknown mode or invalid clock', () => {
    expect(isRoutineMaintenanceUpcoming(Date.parse('2026-10-20T08:56:00Z'), 'unknown')).toBe(false);
    expect(isRoutineMaintenanceUpcoming(NaN, 'daily')).toBe(false);
  });
});

it('cross-pins the client protocol identity to the maintained producer policy without importing desired mode', () => {
  const policy = JSON.parse(
    readFileSync('server/src/maintenance/maintenanceSchedulePolicy.json', 'utf8')
  );
  expect(policy.schema).toBe('engine-maintenance-schedule/v1');
  expect(PHASE1_MAINTENANCE_POLICY_ID).toBe(policy.policyId);
  expect(policy.timeZone).toBe('America/Chicago');
  // Desired complete/off cannot change the meaning of an already serving hourly tuple.
  for (const phase1Status of ['active', 'complete', 'off']) {
    expect(observedMaintenanceSchedule({ ...hourly, phase1Status })).toBe('phase1-hourly');
  }
});
