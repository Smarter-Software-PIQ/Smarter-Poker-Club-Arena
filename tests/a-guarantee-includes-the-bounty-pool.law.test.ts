import { describe, expect, it } from 'vitest';
import { mttGuaranteeEntryAmount } from '../server/src/services/mttHorseArrivalPlan';

describe('the advertised guarantee includes the bounty pool', () => {
  it.each([
    [40_000, 180, 20, 0, 200],
    [10_000, 45, 5, 20, 200],
    [10_000, 45, 5, 25, 200],
    [5_000, 45, 5, 45, 100],
  ])(
    'prices %s at the full entry charge without deducting bounties',
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
