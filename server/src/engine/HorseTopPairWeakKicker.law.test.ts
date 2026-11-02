/**
 * V79 TOP PAIR, WEAK KICKER (2026-11-02, Burls via Dan: horses "stack off with
 * top pair, no weak kickers"), QUALIFIED CELLS. The cap applies only where the
 * decision EV of the horses' calls was measured below zero with a
 * hand-clustered 95% CI (see HorseLogic v79InMeasuredCell). It is not a
 * kicker rule:
 *
 *  1. Exact classification and exact cells (0.9 pot+; 0.6-0.9 pot only on an
 *     ace-high board, heads-up, outside tournaments; never at 60bb effective
 *     or less, on a J-high-or-lower board, under 0.6 pot, at a heads-up
 *     table or in a bounty / PKO / mystery-bounty event).
 *  2. In a measured cell (pot-sized river bet, deep, K-high) it calls less;
 *     the off arm is today.
 *  3. Outside the cells the answer is exactly today's: a 0.75-pot bet on a
 *     K-high board, the same in a tournament, a J-high board, a 50bb stack.
 *  4. A strong kicker and a small wager are answered exactly as before.
 *  5. Label flips never change the answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic, v79InMeasuredCell, v79TopPairWeakKicker } from './HorseLogic.js';
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
function river(
  hole: string,
  board: string,
  bet: number,
  flip = false,
  opt: { heroStack?: number; mode?: string } = {}
) {
  const heroStack = opt.heroStack ?? 300;
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: heroStack,
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
    // A third seat that folded preflop: a ring table, not a heads-up table
    // (heads-up tables are outside V79's measured cells).
    {
      seat: 3,
      user_id: 'folder',
      username: 'f',
      stack: 300,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
  ];
  const history = [
    { stage: 'preflop', seat: 3, userId: 'folder', action: 'fold', amount: 0, timestamp: 0 },
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
      gameMode: opt.mode ?? 'cash',
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
    const cell = (
      potFrac: number,
      boardTopRank: number,
      tournament = false,
      effectiveBB = 150,
      extra: Partial<{ headsUp: boolean; headsUpTable: boolean; bountyEvent: boolean }> = {}
    ) =>
      v79InMeasuredCell({
        potFrac,
        boardTopRank,
        tournament,
        effectiveBB,
        headsUp: true,
        headsUpTable: false,
        bountyEvent: false,
        ...extra,
      });
    expect(cell(0.75, 14, false, 150, { headsUp: false })).toBe(false); // cell B multiway
    expect(cell(1, 13, false, 150, { headsUp: false })).toBe(true); // cell A multiway stays
    expect(cell(1, 13, false, 150, { headsUpTable: true })).toBe(false); // heads-up table
    expect(cell(1, 13, true, 150, { bountyEvent: true })).toBe(false); // bounty event
    expect(cell(1, 13)).toBe(true); // pot-sized, K-high, cash
    expect(cell(1, 13, true)).toBe(true); // pot-sized tournament
    expect(cell(0.9, 12)).toBe(true); // Q-high, 0.9 pot
    expect(cell(0.75, 14)).toBe(true); // ace-high mid-sized, cash
    expect(cell(0.75, 14, true)).toBe(false); // tournament under 0.9 pot
    expect(cell(0.75, 13)).toBe(false); // K-high under 0.9 pot
    expect(cell(1, 11)).toBe(false); // J-high board
    expect(cell(1, 13, false, 60)).toBe(false); // 60bb effective
    expect(cell(0.5, 14)).toBe(false); // under 0.6 pot, commit-only dropped
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

  it('outside the measured cells the answer is exactly today', () => {
    const cases: Array<[string, ReturnType<typeof river>]> = [
      ['0.75 pot, K-high, cash', river('Ks5d', BOARD, 27)],
      ['pot-sized, J-high board', river('Js5d', 'Jh9d3s7c2h', 36)],
      ['pot-sized, 50bb effective', river('Ks5d', BOARD, 36, false, { heroStack: 100 })],
      [
        '0.75 pot, ace-high, tournament',
        river('As5d', 'Ah9d3s7c2h', 27, false, { mode: 'tournament' }),
      ],
    ];
    for (const [label, s] of cases) expect(many(s), label).toEqual(many(s, OFF));
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
