import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
import { isoDate, lastDaysRange, nextMemberDay } from '../src/services/ClubRosterService';
import { readMemberRangeSearch } from '../src/utils/memberRangeLink';
afterEach(() => vi.useRealTimers());
describe('member reporting uses America/Chicago calendar dates', () => {
  it('waits for Chicago midnight rather than UTC midnight', () => {
    expect(isoDate(new Date('2026-11-01T04:59:59.999Z'))).toBe('2026-10-31');
    expect(isoDate(new Date('2026-11-01T05:00:00Z'))).toBe('2026-11-01');
    expect(isoDate(new Date('2026-11-02T05:59:59.999Z'))).toBe('2026-11-01');
    expect(isoDate(new Date('2026-11-02T06:00:00Z'))).toBe('2026-11-02');
  });
  it.each([
    ['2026-03-08T06:00:00Z', '2026-03-09T05:00:00Z', 23],
    ['2026-11-01T05:00:00Z', '2026-11-02T06:00:00Z', 25],
    ['2026-11-01T06:30:00Z', '2026-11-02T06:00:00Z', 23.5],
    ['2026-11-01T07:30:00Z', '2026-11-02T06:00:00Z', 22.5],
  ])('advances from %s at the next local midnight', (start, end, hours) => {
    const now = new Date(start);
    expect(nextMemberDay(now)).toBe(Date.parse(end));
    expect((nextMemberDay(now) - now.getTime()) / 3_600_000).toBe(hours);
  });
  it('subtracts calendar dates across DST without subtracting fixed elapsed hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T05:30:00Z'));
    expect(lastDaysRange(7)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(lastDaysRange(1)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });
  it('validates custom date-only links without converting them into instants', () => {
    expect(
      readMemberRangeSearch(new URLSearchParams('range=custom&from=2026-11-01&to=2026-11-01'))
    ).toEqual({ mode: 'custom', range: { from: '2026-11-01', to: '2026-11-01' } });
    expect(
      readMemberRangeSearch(new URLSearchParams('range=custom&from=2026-02-30&to=2026-11-01')).mode
    ).toBe('overall');
  });
});
