/**
 * V79 TOP PAIR, WEAK KICKER (2026-11-02, Burls via Dan: horses "stack off with
 * top pair, no weak kickers"). Measured: 443 calls of a bet the horse did not
 * start with top pair and a 9-or-lower kicker won 10.2% for -28,925bb in three
 * days. The guard may only ever do this:
 *
 *  1. Classify exactly: top pair, the other hole card 9 or lower and not
 *     pairing the board; a strong kicker, a pocket pair, second pair and a
 *     paired top board are not this class.
 *  2. Facing a big river bet it does not start, top pair weak kicker calls
 *     less than before; with the flag off it is exactly today.
 *  3. Top pair with a strong kicker in the same spot is answered exactly as
 *     before.
 *  4. A small wager (under 0.6 pot, not committing) is answered exactly as
 *     before.
 *  5. One policy for every opponent: label flips never change the answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic, v79TopPairWeakKicker, v79WeakKickerCap } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-000000000079';

/** Villain raised, hero called; flop and turn checked through; villain bets `bet` on the river into 36. */
function river(hole: string, board: string, bet: number, flip = false) {
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: 300,
      bet: 0,
      totalInvested: 18,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: 300 - bet,
      bet,
      totalInvested: 18 + bet,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: flip,
    } as SeatPlayer,
  ];
  const history = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 6, timestamp: 4 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 6, timestamp: 5 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0, timestamp: 7 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 8 },
    { stage: 'river', seat: 2, userId: VILLAIN, action: 'bet', amount: bet, timestamp: 9 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: 36 + bet,
      currentBet: bet,
      minRaise: Math.max(2, bet),
      stage: 'river',
      gameVariant: 'nlh',
      gameMode: 'cash',
      bigBlind: 2,
      dealerSeat: 1,
      actionHistory: history,
    },
  };
}

function many(s: ReturnType<typeof river>, opts: Record<string, unknown> = {}, seeds = 40) {
  const acts: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 79);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...opts,
    } as never) as { action: string; amount?: number };
    acts.push(`${d.action}|${d.amount ?? ''}`);
  }
  return acts;
}
const calls = (acts: string[]) => acts.filter((a) => a.startsWith('call')).length;
const OFF = { v79TopPairWeakKicker: false };
// Two pot-sized wagers into the same 36 pot: the guard engages at 0.6 pot+.
const BOARD = 'Kh9d3s7c2h';

describe('V79 top pair weak kicker', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('classifies exactly', () => {
    expect(v79TopPairWeakKicker(cards('Ks5d'), cards(BOARD))).toBe(true);
    expect(v79TopPairWeakKicker(cards('As4d'), cards('AhKdTs2c'))).toBe(true);
    expect(v79TopPairWeakKicker(cards('Ks8d'), cards(BOARD))).toBe(true);
    expect(v79TopPairWeakKicker(cards('KsTd'), cards(BOARD))).toBe(false); // T kicker: not weak
    expect(v79TopPairWeakKicker(cards('KsQd'), cards(BOARD))).toBe(false);
    expect(v79TopPairWeakKicker(cards('Ks7d'), cards(BOARD))).toBe(false); // kicker pairs the board: two pair
    expect(v79TopPairWeakKicker(cards('9s5d'), cards(BOARD))).toBe(false); // second pair
    expect(v79TopPairWeakKicker(cards('QsQd'), cards(BOARD))).toBe(false); // pocket pair
    expect(v79TopPairWeakKicker(cards('Ks5d'), cards('KhKd3s7c2h'))).toBe(false); // paired top board
    expect(v79WeakKickerCap(0.6)).toBeCloseTo(0.45, 9);
    expect(v79WeakKickerCap(0.8)).toBeCloseTo(0.375, 9);
    expect(v79WeakKickerCap(1)).toBeCloseTo(0.3, 9);
    expect(v79WeakKickerCap(3)).toBeCloseTo(0.3, 9);
    expect(v79WeakKickerCap(0.2)).toBeCloseTo(0.45, 9);
  });

  it('facing a pot-sized river bet it did not start, top pair weak kicker calls less; off is today', () => {
    const s = river('Ks5d', BOARD, 36);
    const on = many(s);
    const off = many(s, OFF);
    expect(calls(on)).toBeLessThan(calls(off));
  });

  it('top pair with a strong kicker is answered exactly as before', () => {
    for (const hole of ['KsQd', 'AsKd']) {
      const s = river(hole, BOARD, 36);
      expect(many(s)).toEqual(many(s, OFF));
    }
  });

  it('a small wager is answered exactly as before', () => {
    const s = river('Ks5d', BOARD, 12); // a third of the pot, 4% of the stack
    expect(many(s)).toEqual(many(s, OFF));
  });

  it('one policy: label flips never change the answer', () => {
    for (const hole of ['Ks5d', 'KsQd', '9s5d']) {
      expect(many(river(hole, BOARD, 36, true), {}, 20)).toEqual(
        many(river(hole, BOARD, 36, false), {}, 20)
      );
    }
  });
});
