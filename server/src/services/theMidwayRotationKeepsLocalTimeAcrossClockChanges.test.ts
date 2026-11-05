/**
 * The five Midway Free Buy slots (owner 2026-11-04) are local America/Chicago
 * times. Their schedule rows store those local times with time_zone
 * America/Chicago, so every slot keeps its wall-clock time across both
 * daylight-saving changes, and the 12:30 AM Midnight Free Buy belongs to the
 * calendar date it starts on (the night after the previous day's Prime Time).
 */
import { describe, expect, it } from 'vitest';
import { zonedStartUtc } from './scheduleWallClock.js';

const SLOTS = ['00:30', '08:30', '12:30', '16:30', '20:30'];

describe('the Midway rotation keeps local time across clock changes', () => {
  it('runs on Central Standard Time now (UTC-6)', () => {
    expect(
      SLOTS.map((t) => zonedStartUtc('2026-11-06', t, 'America/Chicago').toISOString())
    ).toEqual([
      '2026-11-06T06:30:00.000Z',
      '2026-11-06T14:30:00.000Z',
      '2026-11-06T18:30:00.000Z',
      '2026-11-06T22:30:00.000Z',
      '2026-11-07T02:30:00.000Z',
    ]);
  });

  it('on the spring change (2027-03-14) the 12:30 AM slot is still CST and the rest are CDT', () => {
    expect(
      SLOTS.map((t) => zonedStartUtc('2027-03-14', t, 'America/Chicago').toISOString())
    ).toEqual([
      '2027-03-14T06:30:00.000Z',
      '2027-03-14T13:30:00.000Z',
      '2027-03-14T17:30:00.000Z',
      '2027-03-14T21:30:00.000Z',
      '2027-03-15T01:30:00.000Z',
    ]);
  });

  it('on the fall change (2027-11-07) the 12:30 AM slot is still CDT and the rest are CST', () => {
    expect(
      SLOTS.map((t) => zonedStartUtc('2027-11-07', t, 'America/Chicago').toISOString())
    ).toEqual([
      '2027-11-07T05:30:00.000Z',
      '2027-11-07T14:30:00.000Z',
      '2027-11-07T18:30:00.000Z',
      '2027-11-07T22:30:00.000Z',
      '2027-11-08T02:30:00.000Z',
    ]);
  });
});
