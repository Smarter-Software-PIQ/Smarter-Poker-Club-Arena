import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import type { Card, SeatPlayer } from '../types.js';

/**
 * V74 (2026-10-31). Two live reviews replayed from their public state: the
 * horse re-raised top pair with no redraw through the V53 pressure semi-bluff
 * branch, whose Omaha draw test (omahaDrawMod) returned 0.7 for no draw at
 * all. plo_toppair_no_redraw_stackoff: -62.13 bb per hand over 234 hands.
 */
const suits: Record<string, Card['suit']> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  s.split(' ').map((c) => ({ rank: c[0] as Card['rank'], suit: suits[c[1]] }));
const V = '20000000-0000-4000-8000-000000000002';
function g2944297() {
  const hero = {
    seat: 6,
    user_id: 'hero',
    username: 'H',
    totalInvested: 10.5,
    stack: 149.4,
    bet: 0,
    is_folded: false,
    cards: cards('Jc 6s Ac Ks'),
  } as SeatPlayer;
  const gs = {
    players: [
      {
        seat: 1,
        user_id: 'p1',
        stack: 67.49,
        bet: 0,
        totalInvested: 0,
        is_folded: true,
        cards: [],
      },
      {
        seat: 2,
        user_id: V,
        stack: 253.68,
        bet: 21,
        totalInvested: 31.5,
        is_folded: false,
        cards: [],
      },
      {
        seat: 4,
        user_id: 'p4',
        stack: 300.33,
        bet: 0,
        totalInvested: 10.5,
        is_folded: true,
        cards: [],
      },
      hero,
    ],
    communityCards: cards('Jh 3c 4d 8h'),
    pot: 53,
    currentBet: 21,
    minRaise: 21,
    lastRaise: 21,
    minRaiseTo: 42,
    maxRaiseTo: 95,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'turn',
    gameVariant: 'plo4',
    bigBlind: 1,
    dealerSeat: 4,
    gameMode: 'cash',
    rakeConfig: { percent: 0.05, cap: 3, noFlopNoDrop: true },
    actionHistory: [
      { stage: 'preflop', seat: 2, userId: V, action: 'raise', amount: 3 },
      { stage: 'preflop', seat: 4, userId: 'p4', action: 'raise', amount: 10.5 },
      { stage: 'preflop', seat: 6, userId: 'hero', action: 'call', amount: 9.5 },
      { stage: 'preflop', seat: 2, userId: V, action: 'call', amount: 7.5 },
      { stage: 'flop', seat: 6, userId: 'hero', action: 'check', amount: 0 },
      { stage: 'flop', seat: 2, userId: V, action: 'check', amount: 0 },
      { stage: 'flop', seat: 4, userId: 'p4', action: 'check', amount: 0 },
      { stage: 'turn', seat: 6, userId: 'hero', action: 'check', amount: 0 },
      { stage: 'turn', seat: 2, userId: V, action: 'bet', amount: 21 },
      { stage: 'turn', seat: 4, userId: 'p4', action: 'fold', amount: 0 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}
function g2838834() {
  const hero = {
    seat: 4,
    user_id: 'hero',
    username: 'H',
    totalInvested: 32,
    stack: 367.3,
    bet: 0,
    is_folded: false,
    cards: cards('8s 7d Js 6d 9h'),
  } as SeatPlayer;
  const gs = {
    players: [
      {
        seat: 3,
        user_id: V,
        stack: 1511.08,
        bet: 52,
        totalInvested: 84,
        is_folded: false,
        cards: [],
      },
      hero,
    ],
    communityCards: cards('5s Jc 3h'),
    pot: 121,
    currentBet: 52,
    minRaise: 52,
    lastRaise: 52,
    minRaiseTo: 104,
    maxRaiseTo: 225,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'flop',
    gameVariant: 'plo5',
    bigBlind: 2,
    dealerSeat: 6,
    gameMode: 'cash',
    rakeConfig: { percent: 0.05, cap: 3, noFlopNoDrop: true },
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: V, action: 'raise', amount: 9 },
      { stage: 'preflop', seat: 4, userId: 'hero', action: 'raise', amount: 32 },
      { stage: 'preflop', seat: 3, userId: V, action: 'call', amount: 23 },
      { stage: 'flop', seat: 3, userId: V, action: 'bet', amount: 52 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}
function tally(f: typeof g2944297, opts: Record<string, unknown>) {
  const out: Record<string, number> = {};
  const fires: string[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    HorseMind.reset();
    enableBrainTelemetry();
    drainFires();
    seedFastRandom(seed);
    const s = f();
    const d = HorseLogic.decide(s.hero, s.gs, 'balanced', {}, { telemetry: true, ...opts });
    out[d.action] = (out[d.action] ?? 0) + 1;
    fires.push(...drainFires().map((x) => x.feature));
  }
  return { out, fires };
}

describe('V74: an Omaha semi-bluff raise needs a draw', () => {
  for (const [name, f] of [
    ['review 2944297 (PLO4 turn, top pair, no redraw)', g2944297],
    ['review 2838834 (PLO5 flop, top pair and a gutshot)', g2838834],
  ] as const) {
    it(`${name} never re-raises`, () => {
      const on = tally(f, {});
      expect(on.out.raise ?? 0).toBe(0);
      expect(on.out.all_in ?? 0).toBe(0);
      expect(on.fires).toContain('v74_omaha_semibluff_needs_draw');
    });
    it(`${name}: the league off arm reproduces the live raise`, () => {
      const off = tally(f, { v74OmahaSemiBluffNeedsDraw: false });
      expect((off.out.raise ?? 0) + (off.out.all_in ?? 0)).toBeGreaterThan(0);
      expect(off.fires).toContain('v53_pressure_semibluff_raise');
      expect(off.fires).not.toContain('v74_omaha_semibluff_needs_draw');
    });
  }
});
