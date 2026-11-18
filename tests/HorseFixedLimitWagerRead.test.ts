/**
 * The pure fixed-limit wager read (HorseFixedLimitWagerRead.ts) and the
 * identity its three opt-in options owe every other decision: no-limit and
 * pot-limit games answer the same with the options on, and fixed-limit games
 * answer the same when the options are passed as false.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionRecord } from '../types.js';
import { HorseMind } from '../server/src/engine/HorseMind.ts';
import { omahaAggressorTier, type OppPostflopRead } from '../server/src/engine/HorseEval.ts';
import {
  fixedLimitFullBetRead,
  noLowPossible,
  nutLowBlockersHeld,
  streetWagerSignal,
} from '../server/src/engine/HorseFixedLimitWagerRead.ts';
import { cards } from '../server/src/engine/HuVariantSpot.test-support.ts';
import { sweep } from '../server/src/engine/FixedLimitWagerRead.test-support.ts';
import type { ActionRecord } from '../types.ts';

afterEach(() => HorseMind.reset());
const act = (userId: string, action: string, amount: number, stage = 'river'): ActionRecord =>
  ({ seat: 1, userId, action, amount, timestamp: 0, stage }) as ActionRecord;

describe('streetWagerSignal', () => {
  it('counts a bet and each raise, and names who made which', () => {
    const h = [
      act('a', 'bet', 2, 'turn'),
      act('b', 'call', 2, 'turn'),
      act('a', 'check', 0),
      act('b', 'bet', 4),
      act('c', 'call', 4),
      act('a', 'raise', 8),
      act('b', 'call', 4),
    ];
    const river = streetWagerSignal(h, 'river');
    expect(river.wagers).toBe(2);
    expect([...river.byUser]).toEqual([
      ['b', 'bet'],
      ['a', 'raise'],
    ]);
    expect(streetWagerSignal(h, 'turn').wagers).toBe(1);
    expect(streetWagerSignal(h, 'flop').wagers).toBe(0);
    expect(streetWagerSignal(undefined, 'river').wagers).toBe(0);
  });
  it('an all-in is a wager only when it lifts the price', () => {
    const h = [act('a', 'bet', 4), act('b', 'all_in', 3), act('c', 'all_in', 7)];
    const s = streetWagerSignal(h, 'river');
    expect(s.wagers).toBe(2);
    expect(s.byUser.get('b')).toBeUndefined();
    expect(s.byUser.get('c')).toBe('raise');
  });
});

describe('fixedLimitFullBetRead and the board helpers', () => {
  it('marks a full bet without changing the input, and a raise as a raise', () => {
    const read: OppPostflopRead = { aggrW: 0.07, checked: 0, streets: 1, lastFrac: 0.13 };
    const bet = fixedLimitFullBetRead(read, 'bet', false, null);
    expect(bet).toEqual({ ...read, fullBet: true });
    expect(read).toEqual({ aggrW: 0.07, checked: 0, streets: 1, lastFrac: 0.13 });
    expect(fixedLimitFullBetRead(read, 'raise', true, null)).toEqual({
      ...read,
      fullBet: true,
      raised: true,
      highOnlyBoard: true,
      strictPressureRange: true,
    });
  });
  it('a full bet steps the Omaha aggressor tier exactly as a pot-sized bet does', () => {
    const one = { aggrW: 0.07, checked: 0, streets: 1, lastFrac: 0.13 };
    expect(omahaAggressorTier(one)).toBe(1);
    expect(omahaAggressorTier({ ...one, fullBet: true })).toBe(2);
    expect(omahaAggressorTier({ ...one, lastFrac: 1 })).toBe(2);
  });
  it('knows when no low is possible and how many nut-low cards hero holds', () => {
    expect(noLowPossible(cards('Ks Qd Jh 7c 2s'))).toBe(true);
    expect(noLowPossible(cards('Ks Qd 8h 5c 3s'))).toBe(false);
    expect(noLowPossible(cards('As Ad 8h 8c 3s'))).toBe(false);
    expect(noLowPossible(cards('Ks 8d 8h 3c 3s'))).toBe(true);
    // board 8 5 3: the nut low is A 2; board A 5 3: it is 2 4
    expect(nutLowBlockersHeld(cards('Ac 2d Jh Th'), cards('Ks Qd 8h 5c 3s'))).toBe(2);
    expect(nutLowBlockersHeld(cards('Ac 2d 2h Th'), cards('Ks Qd 8h 5c 3s'))).toBe(3);
    expect(nutLowBlockersHeld(cards('2c 4d Jh Th'), cards('As Qd 8h 5c 3s'))).toBe(2);
    expect(nutLowBlockersHeld(cards('Ac 2d Jh Th'), cards('Ks Qd Jh 7c 2s'))).toBe(0);
  });
});

const ALL_ON = {
  mind: true,
  fixedLimitRiverFullBetRead: true,
  fixedLimitHiLoNutLowRiverBet: true,
  fixedLimitRiverOneBetValueRaise: true,
} as const;
const ALL_FALSE = {
  mind: true,
  fixedLimitRiverFullBetRead: false,
  fixedLimitHiLoNutLowRiverBet: false,
  fixedLimitRiverOneBetValueRaise: false,
} as const;

describe('identity: the options touch fixed limit only, and only when on', () => {
  it.each(['nlh', 'plo4', 'plo8'])(
    '%s: every seeded decision is the same with all three options on',
    (variant) => {
      const rows = sweep(variant, 150, { mind: true }, ALL_ON);
      expect(rows.length).toBeGreaterThanOrEqual(400);
      expect(rows.filter((r) => r.base !== r.other)).toEqual([]);
    },
    240_000
  );
  it.each(['flh', 'flo8'])(
    '%s: every seeded decision is the same with the options passed as false',
    (variant) => {
      const rows = sweep(variant, 150, { mind: true }, ALL_FALSE);
      expect(rows.length).toBeGreaterThanOrEqual(400);
      expect(rows.filter((r) => r.base !== r.other)).toEqual([]);
    },
    240_000
  );
});
