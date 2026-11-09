import { describe, expect, it } from 'vitest';
import { mttGuaranteeEntryAmount } from '../server/src/services/mttHorseArrivalPlan';

describe('the advertised guarantee includes the bounty pool', () => {
  it.each([
    [40_000, 180, 20, 0, 223],
    [10_000, 45, 5, 20, 223],
    [10_000, 45, 5, 25, 223],
    [5_000, 45, 5, 45, 112],
  ])(
    'prices %s at the net entry amount without deducting bounties',
    (guarantee, buyIn, fee, bounty, entries) => {
      const charge = mttGuaranteeEntryAmount({
        buy_in_amount: buyIn,
        buy_in_fee: fee,
        bounty_amount: bounty,
      });
      expect(Math.ceil(guarantee / charge)).toBe(entries);
      expect((entries - 1) * charge).toBeLessThan(guarantee);
      expect(entries * charge).toBeGreaterThanOrEqual(guarantee);
    }
  );
});
