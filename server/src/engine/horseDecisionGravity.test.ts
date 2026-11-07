/**
 * THE SIZE OF THE DECISION (owner request 2026-11-07): horses take longer on
 * big decisions and act quickly on easy ones. Pinned on the pure gravity and on
 * the shipped generator (HorseLogic.decide), whose durations the engine still
 * caps at the action clock and the time bank a person has.
 */
import { describe, expect, it } from 'vitest';
import { decisionGravity } from './horseDecisionGravity.js';
import { HorseLogic } from './HorseLogic.js';
import type { HandStage } from '../types.js';

describe('decisionGravity', () => {
  const base = { toCall: 0, pot: 30, heroStack: 1000, opponentStack: 1000 };
  it('a preflop fold and a small-pot check are easy and weightless', () => {
    const fold = decisionGravity({ ...base, stage: 'preflop', action: 'fold', toCall: 2 });
    expect(fold.easy).toBe(true);
    expect(fold.gravity).toBeLessThan(0.1);
    const check = decisionGravity({ ...base, stage: 'flop', action: 'check' });
    expect(check.easy).toBe(true);
    expect(check.gravity).toBeLessThan(0.15);
  });

  it('grows with the street, the pot, the bet and the stack at risk', () => {
    const g = (o: Partial<Parameters<typeof decisionGravity>[0]>) =>
      decisionGravity({ ...base, stage: 'flop', action: 'call', ...o }).gravity;
    expect(g({ stage: 'river' })).toBeGreaterThan(g({ stage: 'turn' }));
    expect(g({ stage: 'turn' })).toBeGreaterThan(g({ stage: 'flop' }));
    expect(g({ pot: 600 })).toBeGreaterThan(g({ pot: 30 }));
    expect(g({ toCall: 30 })).toBeGreaterThan(g({ toCall: 8 }));
    expect(g({ toCall: 300, pot: 300 })).toBeGreaterThan(g({ toCall: 30, pot: 300 }));
  });

  it('an all-in, called or made, is the heaviest decision and never easy', () => {
    const called = decisionGravity({
      ...base,
      stage: 'river',
      action: 'call',
      toCall: 1000,
      pot: 1200,
    });
    expect(called.gravity).toBeGreaterThan(0.8);
    expect(called.easy).toBe(false);
    const shoved = decisionGravity({ ...base, stage: 'preflop', action: 'all_in' });
    expect(shoved.gravity).toBeGreaterThanOrEqual(0.6);
    expect(shoved.easy).toBe(false);
  });

  it('a small bet into a pot is not a big bet', () => {
    const third = decisionGravity({ ...base, stage: 'flop', action: 'call', toCall: 9, pot: 30 });
    const pot = decisionGravity({ ...base, stage: 'flop', action: 'call', toCall: 30, pot: 30 });
    expect(pot.gravity - third.gravity).toBeGreaterThan(0.3);
  });

  it('is bounded and total on junk input', () => {
    for (const v of [NaN, -1, 0, Infinity]) {
      const r = decisionGravity({
        stage: 'turn',
        action: 'call',
        toCall: v,
        pot: v,
        heroStack: v,
        opponentStack: v,
      });
      expect(r.gravity).toBeGreaterThanOrEqual(0);
      expect(r.gravity).toBeLessThanOrEqual(1);
    }
  });
});

/* The shipped generator, many horses, a big spot against an easy one. */
function sample(spot: {
  stage: HandStage;
  pot: number;
  currentBet: number;
  heroStack: number;
  villainStack: number;
}): { times: number[]; bank: number } {
  const times: number[] = [];
  let bank = 0;
  for (let h = 0; h < 30; h++) {
    const hero = {
      seat_number: 1,
      user_id: `horse-${h}-${(h * 7919) % 104729}`,
      stack: spot.heroStack,
      bet: 0,
      is_folded: false,
      is_sitting_out: false,
      cards: [
        { rank: 'A', suit: 'h' },
        { rank: 'Q', suit: 'd' },
      ],
    };
    const villain = {
      seat_number: 2,
      user_id: 'villain-0000',
      stack: spot.villainStack,
      bet: spot.currentBet,
      is_folded: false,
      is_sitting_out: false,
      cards: [
        { rank: '7', suit: 'c' },
        { rank: '2', suit: 's' },
      ],
    };
    for (let i = 0; i < 30; i++) {
      const gs = {
        players: [hero, villain],
        communityCards:
          spot.stage === 'preflop'
            ? []
            : [
                { rank: 'Q', suit: 'h' },
                { rank: 'J', suit: 'c' },
                { rank: '4', suit: 'd' },
                ...(spot.stage === 'river'
                  ? [
                      { rank: '9', suit: 's' },
                      { rank: '2', suit: 'h' },
                    ]
                  : []),
              ],
        pot: spot.pot,
        currentBet: spot.currentBet,
        minRaise: 50,
        stage: spot.stage,
        gameVariant: 'nlh',
        bigBlind: 50,
        dealerSeat: 1,
      };
      const d = HorseLogic.decide(hero as never, gs as never, 'balanced');
      if (typeof d.thinkTime !== 'number' || !Number.isFinite(d.thinkTime)) continue;
      if (d.thinkTime >= HorseLogic.THINK_TIMEBANK_SENTINEL) bank++;
      else times.push(d.thinkTime);
    }
  }
  return { times, bank };
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('the shipped generator takes longer on big decisions', () => {
  it('a river all-in for the stack takes far longer than a free check in a small pot', () => {
    const big = sample({
      stage: 'river',
      pot: 2000,
      currentBet: 3000,
      heroStack: 3000,
      villainStack: 0,
    });
    const easy = sample({
      stage: 'flop',
      pot: 150,
      currentBet: 0,
      heroStack: 10000,
      villainStack: 10000,
    });
    expect(median(big.times)).toBeGreaterThan(median(easy.times) * 1.8);
    // The bank is reached for on big decisions, not on easy ones.
    expect(big.bank).toBeGreaterThan(easy.bank);
  });
});
