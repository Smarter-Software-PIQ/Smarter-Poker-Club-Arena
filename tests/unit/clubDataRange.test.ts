import { describe, expect, it } from 'vitest';
import {
  clubDataRangeDays,
  clubDataRangeError,
  readClubDataRange,
} from '../../src/lib/clubDataRange';
describe('Club Data custom calendar range', () => {
  it('reads inclusive single days and weeks while preserving older exclusive links', () => {
    expect(
      readClubDataRange(
        new URLSearchParams('dataStart=2026-11-10&dataEnd=2026-11-10'),
        '2026-11-16'
      )
    ).toEqual({ start: '2026-11-10', end: '2026-11-10' });
    expect(
      readClubDataRange(
        new URLSearchParams('dataStart=2026-11-09&dataEnd=2026-11-15'),
        '2026-11-16'
      )
    ).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(
      readClubDataRange(
        new URLSearchParams('dataStart=2026-11-09&dataUntil=2026-11-16'),
        '2026-11-16'
      )
    ).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(
      readClubDataRange(
        new URLSearchParams('dataStart=2026-11-16&dataEnd=2026-11-16'),
        '2026-11-15'
      )
    ).toBeNull();
  });
  it('counts inclusive calendar days across both Chicago DST transitions', () => {
    expect(clubDataRangeDays('2026-03-07', '2026-03-09')).toBe(3);
    expect(clubDataRangeDays('2026-10-31', '2026-11-02')).toBe(3);
  });
  it('validates dates, order, future dates and the actual RPC limit', () => {
    expect(clubDataRangeError('', '2026-11-06', '2026-11-06')).not.toBeNull();
    expect(clubDataRangeError('2026-02-30', '2026-03-01', '2026-11-06')).not.toBeNull();
    expect(clubDataRangeError('2026-11-06', '2026-11-05', '2026-11-06')).not.toBeNull();
    expect(clubDataRangeError('2026-11-06', '2026-11-07', '2026-11-06')).not.toBeNull();
    expect(clubDataRangeError('2026-08-06', '2026-11-06', '2026-11-06')).toBeNull();
    expect(clubDataRangeError('2026-08-05', '2026-11-06', '2026-11-06')).not.toBeNull();
  });
});
