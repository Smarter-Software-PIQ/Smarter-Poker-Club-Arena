/**
 * V15 river raise gate (2026-11-07). A non-nut flush or straight facing a
 * river wager in Omaha calls; it never raises, whatever the equity estimate
 * says. Hand 3374459 (plo4 lightning, K-high flush on Ts3c7hJs2s with the As
 * live) raised a pot-sized river bet on 43 of 60 seeds because the gate's
 * near-lock escape (`eq15 - dominationPenalty >= 0.85`) read the Monte Carlo
 * against the bettor's range as 0.91-1.00. See
 * docs/changelog/2026-11-07-the-river-has-no-near-lock.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SU: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(t: string): Card[] {
  const o: Card[] = [];
  for (let i = 0; i + 1 < t.length; i += 2) o.push({ rank: t[i] as CardRank, suit: SU[t[i + 1]] });
  return o;
}
function seat(
  n: number,
  id: string,
  stack: number,
  bet: number,
  invested: number,
  folded: boolean,
  hole = ''
): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: invested,
    cards: cards(hole),
    is_folded: folded,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as SeatPlayer;
}

/**
 * The river node of hand 3374459 as the engine captured it: six seats, three
 * folded, a pot-sized 21.8 bet into 21.8 from seat 3, seat 5 folded behind
 * it, hero (seat 6) to act with 222.03 behind at a 0.5 big blind.
 */
function node3374459(hole: string, board: string, stage: 'river' | 'turn' = 'river') {
  const hero = seat(6, 'hero', 222.03, 0, 6.1, false, hole);
  const players = [
    seat(1, 'p1', 110.21, 0, 0.25, true),
    seat(2, 'p2', 95.75, 0, 1, true),
    seat(3, 'bettor', 214, 21.8, 27.9, false),
    seat(4, 'p4', 134.69, 0, 2.25, true),
    seat(5, 'p5', 69.96, 0, 6.1, true),
    hero,
  ];
  const a = (st: string, s: number, userId: string, action: string, amount: number) => ({
    stage: st,
    seat: s,
    userId,
    action,
    amount,
    timestamp: 0,
  });
  const actionHistory = [
    a('preflop', 3, 'bettor', 'raise', 2.25),
    a('preflop', 4, 'p4', 'call', 2.25),
    a('preflop', 5, 'p5', 'call', 2.25),
    a('preflop', 6, 'hero', 'call', 2.25),
    a('preflop', 1, 'p1', 'fold', 0),
    a('preflop', 2, 'p2', 'fold', 0),
    a('flop', 3, 'bettor', 'check', 0),
    a('flop', 4, 'p4', 'check', 0),
    a('flop', 5, 'p5', 'check', 0),
    a('flop', 6, 'hero', 'check', 0),
    a('turn', 3, 'bettor', 'check', 0),
    a('turn', 4, 'p4', 'check', 0),
    a('turn', 5, 'p5', 'bet', 3.85),
    a('turn', 6, 'hero', 'call', 3.85),
    a('turn', 3, 'bettor', 'call', 3.85),
    a('turn', 4, 'p4', 'fold', 0),
    a(stage, 3, 'bettor', 'bet', 21.8),
    a(stage, 5, 'p5', 'fold', 0),
  ];
  return {
    hero,
    gs: {
      players,
      communityCards: cards(board),
      pot: 43.6,
      currentBet: 21.8,
      toCall: 21.8,
      minRaiseTo: 43.6,
      maxRaiseTo: 87.2,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage,
      gameVariant: 'plo4',
      bettingStructure: 'pot_limit',
      gameMode: 'cash',
      bigBlind: 0.5,
      dealerSeat: 2,
      actionHistory,
    },
  };
}

function decideMany(
  s: ReturnType<typeof node3374459>,
  seeds = 60,
  extra: Record<string, unknown> = {}
) {
  const acts: string[] = [];
  let gateFires = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 15);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...extra,
    } as never) as { action: string };
    gateFires += drainFires().find((r) => r.feature === 'v15_raise_gate')?.fires ?? 0;
    acts.push(d.action);
  }
  return { acts, gateFires };
}
const raises = (acts: string[]) => acts.filter((x) => x === 'raise' || x === 'all_in').length;

// Ts 3c 7h Js 2s: three spades, unpaired, no straight flush possible.
const BOARD = 'Ts3c7hJs2s';

describe('V15 river raise gate: the river has no near-lock', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('hand 3374459: the K-high flush with the As live never raises the river bet', () => {
    const { acts, gateFires } = decideMany(node3374459('4d7sQdKs', BOARD));
    expect(raises(acts)).toBe(0);
    expect(acts.every((x) => x === 'call')).toBe(true);
    expect(gateFires).toBe(acts.length);
  });

  it('a third-nut flush never raises the river bet either', () => {
    const { acts } = decideMany(node3374459('4d7sQs9d', BOARD));
    expect(raises(acts)).toBe(0);
  });

  it('the nut flush is outside the gate and still raises for value', () => {
    const { acts, gateFires } = decideMany(node3374459('4d7sAsQd', BOARD));
    expect(gateFires).toBe(0);
    expect(raises(acts)).toBeGreaterThan(0);
  });

  it('the explicit off arm restores the river near-lock escape', () => {
    const { acts } = decideMany(node3374459('4d7sQdKs', BOARD), 60, { v15RiverNoNearLock: false });
    expect(raises(acts)).toBeGreaterThan(0);
  });
});
