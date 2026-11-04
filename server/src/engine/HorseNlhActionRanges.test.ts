import { describe, expect, it } from 'vitest';
import { gtoOpenBar, openTargetShare, scoreAtShare } from './HorseGtoOpeningRanges.js';
import { defenceTargets, gtoDefence, type DefenceSpot } from './HorseGtoDefenceRanges.js';
import { openWidth, styledOpenWidth } from './HorseGtoVs3BetRanges.js';
import { decidePreflopV7 } from './HorsePreflop.js';
import type { Card } from '../types.js';

describe('NLH action profile uses conditional ranges, not a VPIP quota', () => {
  it.each([6, 9])(
    'widens cash at %i seats and carries the same range into 3-bet defense',
    (dealt) => {
      for (let behind = 1; behind < dealt; behind++) {
        const width = openTargetShare(behind, false, dealt, true);
        expect(width).toBeGreaterThan(openTargetShare(behind, false, dealt, false));
        expect(gtoOpenBar(behind, false, dealt, true)).toBe(scoreAtShare(width / 100));
        expect(openWidth(behind, false, dealt, true)).toBe(width);
        expect(styledOpenWidth(behind, false, dealt, 1.1, true)).toBeLessThan(width);
      }
      expect(openWidth(2, false, dealt, true)).toBeLessThanOrEqual(48);
      expect(openWidth(dealt - 1, false, dealt, true)).toBeLessThan(20);
    }
  );

  it('does not widen no-ante tournaments, ante games or short-handed openings', () => {
    expect(openWidth(2, false, 6)).toBe(43);
    expect(openWidth(2, true, 9, true)).toBe(51);
    expect(openWidth(2, false, 3, true)).toBe(47);
    expect(openWidth(2, false, 5, true)).toBe(43);
  });

  it.each([false, true])(
    'adds strong re-raises without inflating the bluff budget, ante=%s',
    (ante) => {
      for (const dealt of [6, 9]) {
        const spot: DefenceSpot = {
          defender: 'bb',
          openerBehind: 2,
          defenderBehind: 0,
          ante,
          openToBB: ante ? 2.2 : 2.5,
          dealt,
        };
        const before = defenceTargets({ ...spot, dealt: undefined });
        const after = defenceTargets(spot);
        expect(after.bluff).toBe(before.bluff);
        expect(after.value).toBeGreaterThan(before.value);
        expect(after.cont).toBe(before.cont);
        expect(after.value + after.bluff).toBeLessThanOrEqual(13);
        for (const ranks of [
          ['7', '2'],
          ['3', '2'],
        ]) {
          const d = gtoDefence(
            { rank: ranks[0], suit: 'spades' } as Card,
            { rank: ranks[1], suit: 'hearts' } as Card,
            spot
          )!;
          expect(d.bluffProb).toBe(0);
        }
        const early = defenceTargets({ ...spot, openerBehind: dealt - 1 });
        expect(early.value + early.bluff).toBeLessThan(after.value + after.bluff);
        expect(defenceTargets({ ...spot, openToBB: 5 }).cont).toBeLessThan(after.cont);
      }
    }
  );

  it.each([6, 9])('keeps tournament survival pressure on the %i-handed re-steal', (tableSize) => {
    const ctx = {
      position: 'bb',
      raiserPosition: 'late',
      strength: 0.64,
      raises: 1,
      limpers: 0,
      callers: 0,
      oppsLeft: 1,
      toCall: 1.2,
      currentBet: 2.2,
      pot: 4.7,
      contestablePot: 4.7,
      bigBlind: 1,
      stack: 49,
      stackBB: 49,
      effectiveStackBB: 49,
      tightness: 1,
      bluffFreq: 0,
      aggression: 1,
      slowplayFreq: 0,
      sizingMultiplier: 1,
      isOmaha: false,
      isPotLimit: false,
      riskAdd: 0,
      mode: 'tournament',
      anteInPlay: true,
      tableSize,
      gtoDefend: { strength: 0.64, continueBar: 0.3, valueBar: 0.8, bluffProb: 0, defender: 'bb' },
      rand: () => 0.99,
    };
    expect(decidePreflopV7(ctx as never).a).toBe('raiseTo');
    expect(decidePreflopV7({ ...ctx, riskAdd: 0.15 } as never).a).not.toBe('raiseTo');
  });
});
