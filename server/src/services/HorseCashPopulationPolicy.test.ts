import { describe, expect, it } from 'vitest';
import { horseCashPopulationPolicyFingerprint } from './HorseCashPopulationPolicy.js';

describe('cash baseline cohorts follow the complete planned daily curve', () => {
  it('does not change between night and peak hours or successive days', () => {
    const fingerprint = horseCashPopulationPolicyFingerprint(Date.parse('2026-11-16T09:00Z'));
    expect(horseCashPopulationPolicyFingerprint(Date.parse('2026-11-17T01:00Z'))).toBe(fingerprint);
    expect(horseCashPopulationPolicyFingerprint(Date.parse('2026-11-17T09:00Z'))).toBe(fingerprint);
    expect(Number.isSafeInteger(fingerprint)).toBe(true);
    expect(fingerprint).toBeGreaterThanOrEqual(0);
    expect(fingerprint).toBeLessThan(2 ** 52);
  });
  it('separates the reduced population, relaunch and restored variant policies', () => {
    const dates = [
      '2026-11-01T12:00Z',
      '2026-11-03T12:00Z',
      '2026-11-13T12:00Z',
      '2026-11-16T12:00Z',
    ];
    expect(
      new Set(dates.map((date) => horseCashPopulationPolicyFingerprint(Date.parse(date)))).size
    ).toBe(4);
  });
});
