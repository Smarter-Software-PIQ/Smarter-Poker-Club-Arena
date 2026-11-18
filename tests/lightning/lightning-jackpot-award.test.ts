import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { lightningJackpotAward } from '../../src/lightning/lightningJackpotAward';
it('awards the original dealt-in recipients even after they leave the hand', () => {
  const payout = {
    loser: { userId: 'loser', share: 500 },
    winner: { userId: 'winner', share: 250 },
    tablePlayerIds: ['folded', 'other'],
    perPlayerShare: 125,
  };
  expect(lightningJackpotAward('folded', payout)).toBe(125);
  expect(lightningJackpotAward('loser', payout)).toBe(500);
  expect(lightningJackpotAward('winner', payout)).toBe(250);
  expect(lightningJackpotAward('new-opponent', payout)).toBe(0);
  expect(lightningJackpotAward(null, payout)).toBe(0);
  expect(lightningJackpotAward('folded', { ...payout, perPlayerShare: NaN })).toBe(0);
});
it('announces the paid amount and original hand without overwriting the new Lightning stack', () => {
  const source = readFileSync('src/pages/TablePage.tsx', 'utf8');
  expect(source).toContain('const award = lightningJackpotAward(userId,');
  expect(source).toContain('You Won ${money(award)} From Hand #${handState.hand_number}');
  expect(source).toContain('if (!lightningRoomRef.current && updatedStacks.length > 0)');
  expect(source).toContain('for (const su of lightningRoomRef.current ? [] : updatedStacks)');
});
