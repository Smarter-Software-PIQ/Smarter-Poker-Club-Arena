import { describe, expect, it } from 'vitest';
import { mapRosterRow } from '../../src/services/ClubRosterService';
import { sanitizeRosterMemberForCache } from '../../src/lib/rosterCache';
import { rakebackFigure } from '../../src/utils/rosterRakeback';

describe('Player Management effective rakeback', () => {
  it('prints actual fractional rates, including zero and fractional percentages', () => {
    expect(rakebackFigure(0.7)).toBe('70%');
    expect(rakebackFigure(0)).toBe('0%');
    expect(rakebackFigure(0.325)).toBe('32.5%');
    expect(rakebackFigure(1)).toBe('100%');
  });
  it('never invents zero for missing, invalid or out-of-range terms', () => {
    for (const value of [undefined, null, '', 'bad', -1, 2, NaN, Infinity]) {
      const row = mapRosterRow({ can_view_financials: true, effective_rakeback_rate: value });
      expect(row.effective_rakeback_rate).toBeNull();
      expect(rakebackFigure(row.effective_rakeback_rate)).toBe('Unavailable');
    }
  });
  it('accepts Postgres numeric strings but never caches or exposes unauthorized rates', () => {
    const row = mapRosterRow({ can_view_financials: true, effective_rakeback_rate: '0.7000' });
    expect(row.effective_rakeback_rate).toBe(0.7);
    expect(sanitizeRosterMemberForCache(row).effective_rakeback_rate).toBeNull();
    expect(
      mapRosterRow({ can_view_financials: false, effective_rakeback_rate: '0.7' })
        .effective_rakeback_rate
    ).toBeNull();
  });
});
