/**
 * LAW: the V15 Omaha equity cap and the V15 domination penalty price one line
 * once (EMERG CODESWEEP, 2026-11-19).
 *
 * Executed on the live build aec0d93b40cd: a PLO5 nine-high flush facing a
 * pot-sized river bet read 0.78, the V15 cap set it to 0.42 (above the 0.333
 * price), and the same V15 penalty (0.14) was then subtracted again, leaving
 * 0.277: the Horse folded 40 of 40 seeds. Both terms model the bigger flush
 * in the betting range; the cap alone is the class's ceiling.
 */
import { describe, it, expect } from 'vitest';
import { HorseLogic, omahaDominationPenaltyForCall, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITE_TIMEOUT_MS = 10_000 * (process.env.RUNNER_ENVIRONMENT === 'self-hosted' ? 3 : 1);
const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;
const H = 'hearts';
const D = 'diamonds';
const S = 'spades';
const C = 'clubs';

function seat(over: Partial<SeatPlayer> & { seat: number; user_id: string }): SeatPlayer {
  return {
    username: over.user_id,
    stack: 400,
    bet: 0,
    totalInvested: 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
    cards: [],
    ...over,
  } as SeatPlayer;
}

describe('omahaDominationPenaltyForCall', () => {
  it('drops only the V15 share, and only when the cap bound', () => {
    expect(omahaDominationPenaltyForCall(0.14, 0.14, true, true)).toBe(0);
    expect(omahaDominationPenaltyForCall(0.14, 0.14, false, true)).toBe(0.14);
    expect(omahaDominationPenaltyForCall(0.2, 0, true, true)).toBe(0.2);
    expect(omahaDominationPenaltyForCall(0.2, 0.05, true, true)).toBeCloseTo(0.15, 12);
  });
  it('outside PLO4/PLO5 high cash (PLO6, hi-lo, tournaments) the full penalty stands, as before', () => {
    expect(omahaDominationPenaltyForCall(0.14, 0.14, true, false)).toBe(0.14);
    expect(omahaDominationPenaltyForCall(0.2, 0.05, true, false)).toBe(0.2);
  });
});

describe('a capped non-nut flush is judged on the cap, not the cap minus the penalty', () => {
  const hole = [c('9', H), c('4', H), c('Q', D), c('J', S), c('3', C)];
  const board = [c('K', H), c('7', H), c('2', H), c('5', C), c('T', D)];
  function play(seed: number) {
    seedFastRandom(seed);
    const history = [
      { seat: 3, userId: 'p3', action: 'bet', amount: 100, timestamp: 1, stage: 'river' },
    ] as ActionRecord[];
    const hero = seat({ seat: 1, user_id: 'hero', cards: hole });
    const gs = {
      players: [hero, seat({ seat: 3, user_id: 'p3', is_horse: false, bet: 100, stack: 300 })],
      communityCards: board,
      pot: 200,
      currentBet: 100,
      minRaise: 100,
      lastRaise: 100,
      stage: 'river',
      gameVariant: 'plo5',
      bigBlind: 2,
      dealerSeat: 3,
      actionHistory: history,
      gameMode: 'cash',
      format: 'cash',
    } as HorseGameStateV2;
    return HorseLogic.decide(hero, gs, 'balanced', {}, { mind: false });
  }
  it(
    'PLO5 nine-high flush facing a pot-sized river bet is not folded below its capped equity',
    () => {
      let calls = 0;
      for (let s = 1; s <= 40; s++) {
        const d = play(s * 7919);
        expect(['fold', 'call', 'raise', 'all_in']).toContain(d.action);
        if (d.action !== 'fold') calls++;
      }
      expect(calls).toBeGreaterThanOrEqual(36);
    },
    SUITE_TIMEOUT_MS
  );
});
