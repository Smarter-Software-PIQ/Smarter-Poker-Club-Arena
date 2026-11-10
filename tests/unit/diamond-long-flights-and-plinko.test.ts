import { describe, expect, it } from 'vitest';
import {
  crashAverageMultiplier,
  crashCashoutFloorCents,
  crashFlightFromRoll,
  crashFlightReach,
  crashPointCentsForContract,
  crashPointFloorCents,
  crashSecondsToReach,
} from '../../src/utils/diamondGamesFairness';
import { PLINKO_TABLES, earnedWheelMinimum } from '../../src/utils/diamondBonusPayout';

describe('new Diamond game contracts', () => {
  const space = 1n << 48n;

  it('deals every band boundary as published, with a full window to bank before the minimum', () => {
    expect(crashPointFloorCents(6)).toBe(250);
    expect(crashCashoutFloorCents(6)).toBe(126);
    expect(crashFlightFromRoll(space - 1n)).toBe(250);
    expect(crashFlightFromRoll(0n)).toBe(2000);
    for (const [target, probability] of [
      [300, 0.85],
      [500, 0.65],
      [1000, 0.35],
      [1500, 0.15],
    ]) {
      const reach = crashFlightReach(target);
      expect(reach).toBeCloseTo(probability, 13);
      const rolls = BigInt(Math.round(reach * Number(space)));
      expect(crashFlightFromRoll(rolls - 1n)).toBeGreaterThanOrEqual(target);
      expect(crashFlightFromRoll(rolls)).toBeLessThan(target);
    }
    expect(crashAverageMultiplier(1, 0.5, 6, 2000)).toBeGreaterThan(8);
    expect(crashSecondsToReach(0.05, 250) - crashSecondsToReach(0.05, 126)).toBeGreaterThan(13);
    expect(crashPointCentsForContract(space - 1n, 1, 0.5, 5)).toBe(125);
  });

  it('computes expected standalone gross return including the actual stochastic cent threshold', () => {
    const weights = [
      1, 16, 120, 560, 1820, 4368, 8008, 11440, 12870, 11440, 8008, 4368, 1820, 560, 120, 16, 1,
    ];
    for (const stake of [1, 2, 5, 25, 100, 500, 2501, 2147483650]) {
      let paidRolls = 0n;
      PLINKO_TABLES[7].multipliersCents.forEach((mult, i) => {
        const hundredths = BigInt(stake) * BigInt(mult);
        const centRolls = (hundredths / 100n) * space + ((hundredths % 100n) * space) / 100n;
        expect(centRolls).toBeGreaterThanOrEqual(BigInt(stake) * space);
        paidRolls += BigInt(weights[i]) * centRolls;
      });
      expect(Number(paidRolls) / Number(65536n * BigInt(stake) * space)).toBeCloseTo(
        1.0594482421875,
        13
      );
    }
  });

  it('derives guaranteed cents from the original bridge and funded base, including a Super', () => {
    for (const [base, floor] of [
      [25, 0.38],
      [50, 0.75],
      [1, 0.02],
    ]) {
      const receipt = {
        payout_rules_version: 2,
        bonus: { base_diamonds: base },
        wheel_diamonds_per_chip: 100,
        wheel_minimum_payout_chips: floor,
      };
      expect(earnedWheelMinimum(receipt)).toBe(floor);
      expect(() =>
        earnedWheelMinimum({ ...receipt, wheel_minimum_payout_chips: floor - 0.01 })
      ).toThrow();
    }
    expect(earnedWheelMinimum({})).toBeNull();
  });
});
