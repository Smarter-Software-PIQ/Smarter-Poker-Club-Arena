/**
 * V80 TOP PAIR, ANY KICKER, CELL A (2026-11-02, Phase 2 of the Burls/Dan
 * top-pair program). V79 capped top pair with a 9-or-lower kicker in its
 * measured cells; V80 extends the same cap to a T-or-better kicker in cell A
 * only, where the decision EV of the horses' calls was below zero on two
 * independent days (see HorseLogic v80InMeasuredCell):
 *
 *  1. Exact classification (T+ kicker not pairing the board; the weak band
 *     stays V79's) and exactly cell A.
 *  2. In cell A (pot-sized river bet, deep, K-high, ring table) a T+ kicker
 *     calls less and records v80_top_pair_strong_kicker; the off arm is today.
 *  3. Outside cell A the answer is exactly today: cell B (0.75 pot on an
 *     ace-high board), a J-high board, 50bb effective, a smaller wager.
 *  4. A weak kicker is still V79's, untouched by V80's arm.
 *  5. Label flips never change the answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HorseLogic,
  v79InMeasuredCell,
  v80InMeasuredCell,
  v80TopPairStrongKicker,
} from './HorseLogic.js';
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
const VILLAIN = '10000000-0000-4000-8000-000000000080';

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
    seedFastRandom(seed * 7919 + 80);
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
const OFF = { v80TopPairStrongKicker: false };
const BOARD = 'Kh9d3s7c2h';

function fires(s: ReturnType<typeof river>, opts: Record<string, unknown> = {}) {
  let n = 0;
  for (let seed = 1; seed <= 20; seed++) {
    seedFastRandom(seed * 7919 + 80);
    HorseMind.reset();
    drainFires();
    HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...opts,
    } as never);
    n += drainFires().find((r) => r.feature === 'v80_top_pair_strong_kicker')?.fires ?? 0;
  }
  return n;
}

describe('V80 top pair any kicker, cell A', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('classifies exactly and admits cell A only', () => {
    expect(v80TopPairStrongKicker(cards('KsTd'), cards(BOARD))).toBe(true);
    expect(v80TopPairStrongKicker(cards('KsQd'), cards(BOARD))).toBe(true);
    expect(v80TopPairStrongKicker(cards('AsKd'), cards('AhJd3s7c2h'))).toBe(true);
    expect(v80TopPairStrongKicker(cards('Ks9d'), cards(BOARD))).toBe(false); // weak: V79's
    expect(v80TopPairStrongKicker(cards('Ks9d'), cards('Kh8d3s7c2h'))).toBe(false); // 9 kicker
    expect(v80TopPairStrongKicker(cards('KsTd'), cards('KhTd3s7c2h'))).toBe(false); // two pair
    expect(v80TopPairStrongKicker(cards('QsJd'), cards(BOARD))).toBe(false); // no pair
    expect(v80TopPairStrongKicker(cards('AsAd'), cards(BOARD))).toBe(false); // overpair
    expect(v80TopPairStrongKicker(cards('KsQd'), cards('KhKd3s7c2h'))).toBe(false); // paired top
    expect(v80TopPairStrongKicker(cards('KsQd'), cards('Kh9d'))).toBe(false); // no flop
    const cell = (
      potFrac: number,
      boardTopRank: number,
      tournament = false,
      effectiveBB = 150,
      extra: Partial<{ headsUp: boolean; headsUpTable: boolean; bountyEvent: boolean }> = {}
    ) => {
      const o = {
        potFrac,
        boardTopRank,
        tournament,
        effectiveBB,
        headsUp: true,
        headsUpTable: false,
        bountyEvent: false,
        ...extra,
      };
      return v80InMeasuredCell(o);
    };
    expect(cell(1, 13)).toBe(true);
    expect(cell(0.9, 12)).toBe(true);
    expect(cell(1, 13, true)).toBe(true); // tournament, not a bounty event
    expect(cell(1, 13, false, 150, { headsUp: false })).toBe(true); // multiway
    expect(cell(0.89, 14)).toBe(false); // cell B is not admitted for a T+ kicker
    expect(cell(0.75, 14)).toBe(false);
    expect(cell(1, 11)).toBe(false); // J-high board
    expect(cell(1, 13, false, 60)).toBe(false); // 60bb effective
    expect(cell(1, 13, false, 150, { headsUpTable: true })).toBe(false);
    expect(cell(1, 13, true, 150, { bountyEvent: true })).toBe(false);
    // Cell A is exactly V79's cell A: V80 never reaches beyond it.
    for (const pf of [0.5, 0.6, 0.75, 0.89, 0.9, 1, 2])
      for (const top of [10, 11, 12, 13, 14])
        for (const eff of [40, 60, 61, 200])
          for (const t of [false, true]) {
            const o = {
              potFrac: pf,
              boardTopRank: top,
              tournament: t,
              effectiveBB: eff,
              headsUp: true,
              headsUpTable: false,
              bountyEvent: false,
            };
            if (v80InMeasuredCell(o)) expect(v79InMeasuredCell(o)).toBe(true);
          }
  });

  it('in cell A a T+ kicker calls less and records the receipt; off is today', () => {
    for (const hole of ['KsTd', 'KsQd', 'AsKd']) {
      const s = hole === 'AsKd' ? river(hole, 'Ah9d3s7c2h', 36) : river(hole, BOARD, 36);
      const on = many(s);
      const off = many(s, OFF);
      // AK on an ace-high board already folds a pot-sized river bet today;
      // V80 can only remove calls, never add one.
      if (hole === 'AsKd') expect(calls(on), hole).toBeLessThanOrEqual(calls(off));
      else expect(calls(on), hole).toBeLessThan(calls(off));
      expect(fires(s), hole).toBeGreaterThan(0);
      expect(fires(s, OFF), hole).toBe(0);
    }
  });

  it('outside cell A the answer is exactly today and nothing is recorded', () => {
    const cases: Array<[string, ReturnType<typeof river>]> = [
      ['cell B: 0.75 pot, ace-high, cash', river('AsQd', 'Ah9d3s7c2h', 27)],
      ['0.75 pot, K-high', river('KsQd', BOARD, 27)],
      ['pot-sized, J-high board', river('JsTd', 'Jh9d3s7c2h', 36)],
      ['pot-sized, 50bb effective', river('KsQd', BOARD, 36, false, { heroStack: 100 })],
      ['a third of the pot', river('KsQd', BOARD, 12)],
    ];
    for (const [label, s] of cases) {
      expect(many(s), label).toEqual(many(s, OFF));
      expect(fires(s), label).toBe(0);
    }
  });

  it("a weak kicker stays V79's: V80's arm never changes it", () => {
    const s = river('Ks5d', BOARD, 36);
    expect(many(s)).toEqual(many(s, OFF));
  });

  it('one policy: label flips never change the answer', () => {
    for (const hole of ['KsTd', 'KsQd', 'Ks5d']) {
      expect(many(river(hole, BOARD, 36, true), {}, 20)).toEqual(
        many(river(hole, BOARD, 36, false), {}, 20)
      );
    }
  });
});
