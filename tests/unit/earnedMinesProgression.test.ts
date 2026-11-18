import { describe, expect, it } from 'vitest';
import receipts from '../fixtures/diamond-spins/earned-mines-v9-postgres.json';
import { parseChoiceRound } from '../../src/services/DiamondChoiceService';
import { verifyChoiceRoundDetailed } from '../../src/utils/diamondChoiceMath';
import { minePrizeV5 } from '../../src/utils/choiceProgressiveGuarantee';

const prize = (stake: number, picks: number, floor: number, wheelFloor: number) => {
  const p = minePrizeV5(stake, 6, picks, floor, wheelFloor);
  return Number(p.numerator) / Number(p.denominator) / 100;
};

describe('earned Mines prizes grow above their wheel guarantee', () => {
  it('increases every safe pick above the reported 37.50 guarantee', () => {
    const values = Array.from({ length: 19 }, (_, i) => prize(25, i + 1, 12.5, 37.5));
    expect(values[0]).toBe(38.75);
    expect(values[3]).toBeGreaterThan(40);
    expect(values.every((value, i) => value > (i ? values[i - 1] : 37.5))).toBe(true);
  });

  it.each([0.25, 1, 25, 26000])('preserves the stopping value at stake %s', (stake) => {
    const floor = Math.ceil(stake * 50) / 100;
    const wheel = Math.ceil(stake * 150) / 100;
    for (let n = 1; n < 19; n++) {
      const before = prize(stake, n, floor, wheel);
      const after = prize(stake, n + 1, floor, wheel);
      const loss = Math.max(wheel, floor, Math.ceil(before * 50 - 1e-9) / 100);
      const survival = (25 - n - 6) / (25 - n);
      expect(survival * after + (1 - survival) * loss).toBeCloseTo(before, 8);
    }
  });

  it('leaves the original standalone ladder intact and rejects invalid guarantees', () => {
    expect(prize(25, 1, 12.5, 0)).toBe(20);
    expect(prize(25, 4, 12.5, 0)).toBeCloseTo(30.907941176470587);
    for (const floor of [-1, NaN, Infinity]) expect(() => prize(25, 1, 12.5, floor)).toThrow();
  });
});

it.each(receipts)(
  'verifies the native contract-9 $status receipt through the shipping parser',
  async (receipt) => {
    const round = parseChoiceRound(receipt);
    expect(await verifyChoiceRoundDetailed(round)).toEqual({
      seal: true,
      draw: true,
      prizes: true,
      payout: true,
    });
    expect(round.prizes[3]).toBeGreaterThan(round.wheel_minimum_payout_chips!);
    expect(() => parseChoiceRound({ ...receipt, game: 'crossing' })).toThrow();
  }
);
