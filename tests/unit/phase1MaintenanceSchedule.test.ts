import { describe, expect, it } from 'vitest';
import {
  nextMaintenanceAnnouncement,
  scheduledMaintenanceAt,
  maintenanceFrequency,
} from '../../server/src/maintenance/maintenanceSchedule';

// The v1 Phase1 policy shape, retained so reverting stays a one-field change.
const policy = {
  schema: 'engine-maintenance-schedule/v1',
  policyId: 'phase1-hourly-01a1944f',
  timeZone: 'America/Chicago',
  phase1Status: 'off',
  ownerMessageId: '01a1944f-7131-7f11-8dcc-873d576e781c',
  completionEvidence: 'Owner instruction 2026-11-06 retained daily baseline fixture',
};

describe('temporary Phase1 hourly top-of-hour maintenance', () => {
  it('announces the next ordinary hour at58 with an unchanged120second lead', () => {
    expect(nextMaintenanceAnnouncement(Date.parse('2026-10-31T23:30:00Z'), 'phase1-hourly')).toBe(
      Date.parse('2026-10-31T23:58:00Z')
    );
  });
  it('freezes only the existing five minutes at00', () => {
    expect(scheduledMaintenanceAt(Date.parse('2026-11-01T00:00:00Z'), 'phase1-hourly')).toEqual({
      announcedAt: Date.parse('2026-10-31T23:58:00Z'),
      startsAt: Date.parse('2026-11-01T00:00:00Z'),
      endsAt: Date.parse('2026-11-01T00:05:00Z'),
    });
    expect(scheduledMaintenanceAt(Date.parse('2026-11-01T00:05:00Z'), 'phase1-hourly')).toBeNull();
  });
});

describe('daily restoration and real Chicago DST hours', () => {
  it('restores the original04:00 baseline only through explicit off/completed source', () => {
    for (const phase1Status of ['off', 'complete']) {
      const frequency = maintenanceFrequency({
        ...policy,
        phase1Status,
        completionEvidence: 'Verified Phase1 source evidence fixture',
      });
      expect(frequency).toBe('daily');
      expect(nextMaintenanceAnnouncement(Date.parse('2026-10-31T23:30:00Z'), frequency)).toBe(
        Date.parse('2026-11-01T09:58:00Z')
      );
      expect(scheduledMaintenanceAt(Date.parse('2026-11-01T00:00:00Z'), frequency)).toBeNull();
    }
    expect(() =>
      maintenanceFrequency({ ...policy, phase1Status: 'complete', completionEvidence: null })
    ).toThrow();
  });
  it.each([
    ['2026-11-01T05:59:00Z', '2026-11-01T06:58:00Z'],
    ['2026-11-01T06:59:00Z', '2026-11-01T07:58:00Z'],
    ['2026-03-08T07:59:00Z', '2026-03-08T08:58:00Z'],
  ])('keeps distinct actual epoch hours across DST at%s', (at, expected) => {
    expect(nextMaintenanceAnnouncement(Date.parse(at), 'phase1-hourly')).toBe(Date.parse(expected));
  });
});

it.each([
  ['2026-11-01T07:54:00Z', '2026-11-01T09:58:00Z'],
  ['2026-10-25T01:54:00Z', '2026-10-25T08:58:00Z'],
  ['2026-09-10T00:52:00Z', '2026-09-10T08:58:00Z'],
  ['2026-12-31T23:54:00Z', '2027-01-01T09:58:00Z'],
  ['2026-03-08T07:59:00Z', '2026-03-08T08:58:00Z'],
  ['2026-03-07T09:59:00Z', '2026-03-08T08:58:00Z'],
  ['2026-10-31T08:59:00Z', '2026-11-01T09:58:00Z'],
  ['2026-10-20T08:58:00Z', '2026-10-21T08:58:00Z'],
])('retains the original daily IANA boundary at%s', (at, expected) => {
  expect(nextMaintenanceAnnouncement(Date.parse(at), 'daily')).toBe(Date.parse(expected));
});
it.each([{ phase1Status: ['active'] }, { phase1Status: true }, { phase1Status: 'unknown' }])(
  'refuses malformed policy status%j',
  ({ phase1Status }) => {
    expect(() => maintenanceFrequency({ ...policy, phase1Status })).toThrow(
      'maintenance_schedule_policy_invalid'
    );
  }
);

it('the current protected policy schedules the three-hourly cycles (owner order 2026-11-21)', () => {
  expect(maintenanceFrequency()).toBe('three-hourly');
  // 14:00 Chicago (CST) -> the 16:00 cycle, announced 15:58.
  expect(nextMaintenanceAnnouncement(Date.parse('2026-11-06T20:00:00Z'))).toBe(
    Date.parse('2026-11-06T21:58:00Z')
  );
});
