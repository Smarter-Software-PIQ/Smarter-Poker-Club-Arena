import { describe, expect, it } from 'vitest';
import receipts from '../fixtures/diamond-spins/earned-choice-guarantee-postgres.json';
import { parseChoiceRound } from '../../src/services/DiamondChoiceService';
import { choiceRoundVerified, verifyChoiceRoundDetailed } from '../../src/utils/diamondChoiceMath';

describe('wheel guaranteed settlement on existing Choice games', () => {
  it.each(receipts)(
    'verifies PostgreSQL $game $status through the original draw and the guaranteed payout',
    async (receipt) => {
      const round = parseChoiceRound(receipt);
      expect(choiceRoundVerified(await verifyChoiceRoundDetailed(round))).toBe(true);
      expect(round.payout_chips).toBe(receipt.wheel_minimum_payout_chips);
      expect(() =>
        parseChoiceRound({ ...receipt, payout_chips: receipt.payout_chips - 0.01 })
      ).toThrow();
      expect(() =>
        parseChoiceRound({
          ...receipt,
          wheel_minimum_payout_chips: receipt.wheel_minimum_payout_chips - 0.01,
        })
      ).toThrow();
      expect(() =>
        parseChoiceRound({
          ...receipt,
          wheel_diamonds_per_chip: receipt.wheel_diamonds_per_chip + 1,
        })
      ).toThrow();
    }
  );
});
