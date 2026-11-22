/**
 * omahaClassCapsRespectEquity (V40CAP lane 2026-11-19, default OFF). See HorseOmahaClassCapsRespectEquity.ts.
 *
 *  1. Scope: PLO4 and PLO5 cash only (table and Lightning), one board, high only, facing a bet. PLO6, PLO8,
 *     tournaments, multi-board, bomb pots and spots with nothing to call are out (owner 2026-11-19 8:26 PM:
 *     do not touch PLO6).
 *  2. Arithmetic: a cap lowers the equity only down to the measured equity, never below it, never above the
 *     equity that entered the cap.
 *  3. End to end on a constructed PLO5 turn spot (overpair with a wrap facing a pot bet, the V40 cap binding):
 *     with the option off the Horse folds on every seed; with it on it calls on every seed, the receipt fires,
 *     and the call is a valid signed receipt under the exact door the decision client uses
 *     (horseDecisionReceiptRefusalForGates, client.ts) — a refused receipt would become the liveness fold of
 *     ServerTableEngineTurns.ts (failureFallbackAction).
 *     A raise the floor would make is held to the call (the floor protects the call only).
 *  4. PLO6 (and a tournament) decisions are byte-identical with the option on; the default is off.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  classCapFloorKeepsTheCall,
  classCapRespectingEquity,
  OMAHA_CLASS_CAP_FLOOR_MIN_SAMPLES,
  omahaClassCapsRespectEquityInScope,
} from './HorseOmahaClassCapsRespectEquity.js';
import { horseDecisionReceiptRefusalForGates } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-0000000040ca';
const HELD = 'omaha_class_cap_held_at_measured_equity';
const CAP = 'v40_omaha_pressure_cap';
const ON = { omahaClassCapsRespectEquity: true };
/** Wall-clock measurements in the receipt; everything else must match byte for byte. */
const TIMING_KEYS = new Set(['latencyMs', 'elapsedMs', 'simulationMs', 'policyMs']);

/** Heads-up: villain raised preflop, bet the flop (hero called), hero checks the turn, villain bets `bet` into `pot`. */
function turn(variant: string, hole: string, board: string, mode: 'cash' | 'tournament' = 'cash') {
  const potStart = 60;
  const bet = 60;
  const pre = 15;
  const players = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: 400 - potStart / 2,
      bet: 0,
      totalInvested: potStart / 2,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    },
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: 400 - potStart / 2 - bet,
      bet,
      totalInvested: potStart / 2 + bet,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: false,
    },
  ] as SeatPlayer[];
  const history = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: pre },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: pre - 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: pre },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: pre },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'bet', amount: bet },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: potStart + bet,
      currentBet: bet,
      toCall: bet,
      minRaiseTo: bet * 2,
      maxRaiseTo: 400 - potStart / 2,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'turn',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      gameMode: mode,
      bigBlind: 2,
      dealerSeat: 2,
      actionHistory: history.map((a, k) => ({ ...a, timestamp: k })),
    },
  };
}

function decideMany(s: ReturnType<typeof turn>, opts: Record<string, unknown>, seeds = 12) {
  const out: Array<{
    d: { action: string; amount?: number };
    held: number;
    cap: number;
    json: string;
  }> = [];
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 40);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...opts,
    } as never) as { action: string; amount?: number };
    const fires = drainFires();
    out.push({
      d,
      held: fires.find((r) => r.feature === HELD)?.fires ?? 0,
      cap: fires.find((r) => r.feature === CAP)?.fires ?? 0,
      json: JSON.stringify(d, (k, v) => (TIMING_KEYS.has(k) ? 0 : v)),
    });
  }
  return out;
}

// Constructed spot: PLO5, KK overpair to the 7 with a 7-6-5 wrap on Qc 7d 3s 2h, facing a pot-size turn bet.
// The V40 class cap ('pair' 0.28 + 0.04 turn) binds far below the hand's measured equity.
const PLO5_HOLE = 'KhKd7c6s5d';
const BOARD = 'Qc7d3s2h';

describe('omahaClassCapsRespectEquity', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('acts only in PLO4/PLO5 cash, one board, high only, facing a bet', () => {
    const base = {
      enabled: true,
      gameVariant: 'plo5',
      tournament: false,
      hiLo: false,
      extraBoards: 0,
      bombPot: false,
      toCall: 10,
    };
    expect(omahaClassCapsRespectEquityInScope(base)).toBe(true);
    expect(omahaClassCapsRespectEquityInScope({ ...base, gameVariant: 'plo4' })).toBe(true);
    expect(omahaClassCapsRespectEquityInScope({ ...base, gameVariant: 'PLO5' })).toBe(true);
    expect(omahaClassCapsRespectEquityInScope({ ...base, enabled: false })).toBe(false);
    expect(omahaClassCapsRespectEquityInScope({ ...base, gameVariant: 'plo6' })).toBe(false);
    expect(omahaClassCapsRespectEquityInScope({ ...base, gameVariant: 'plo8' })).toBe(false);
    expect(omahaClassCapsRespectEquityInScope({ ...base, gameVariant: 'nlh' })).toBe(false);
    expect(omahaClassCapsRespectEquityInScope({ ...base, tournament: true })).toBe(false);
    expect(omahaClassCapsRespectEquityInScope({ ...base, hiLo: true })).toBe(false);
    expect(omahaClassCapsRespectEquityInScope({ ...base, extraBoards: 1 })).toBe(false);
    expect(omahaClassCapsRespectEquityInScope({ ...base, bombPot: true })).toBe(false);
    expect(omahaClassCapsRespectEquityInScope({ ...base, toCall: 0 })).toBe(false);
    expect(OMAHA_CLASS_CAP_FLOOR_MIN_SAMPLES).toBeGreaterThanOrEqual(400);
  });

  it('a cap lowers the equity only down to the measured equity', () => {
    expect(classCapRespectingEquity(0.8, 0.32, 0.7)).toBeCloseTo(0.7, 12);
    expect(classCapRespectingEquity(0.8, 0.32, 0.9)).toBeCloseTo(0.8, 12); // never above what entered
    expect(classCapRespectingEquity(0.8, 0.32, 0.2)).toBeCloseTo(0.32, 12); // never below the cap
    expect(classCapRespectingEquity(0.8, 0.32, null)).toBeCloseTo(0.32, 12); // no floor: today
    expect(classCapRespectingEquity(0.8, 0.32, Number.NaN)).toBeCloseTo(0.32, 12);
    expect(classCapRespectingEquity(0.3, 0.3, 0.9)).toBeCloseTo(0.3, 12); // cap did not bind
  });

  it('the floor protects the call only: a raise it made is held to the call', () => {
    expect(
      classCapFloorKeepsTheCall({ action: 'raise', amount: 200, thinkTime: 5 }, 60, 400)
    ).toEqual({
      action: 'call',
      amount: 60,
      thinkTime: 5,
    });
    expect(classCapFloorKeepsTheCall({ action: 'all_in', amount: 400 }, 60, 400)).toEqual({
      action: 'call',
      amount: 60,
      thinkTime: 0,
    });
    // An all-in that is only the call stays; fold, check and call are untouched.
    const allInCall = { action: 'all_in', amount: 50 };
    expect(classCapFloorKeepsTheCall(allInCall, 60, 50)).toBe(allInCall);
    for (const d of [{ action: 'fold' }, { action: 'check' }, { action: 'call', amount: 60 }])
      expect(classCapFloorKeepsTheCall(d, 60, 400)).toBe(d);
  });

  it('end to end: the capped fold becomes a call, the receipt fires, the call passes the decision door', () => {
    const s = turn('plo5', PLO5_HOLE, BOARD);
    const off = decideMany(s, {});
    const on = decideMany(s, ON);
    expect(off.every((r) => r.d.action === 'fold')).toBe(true);
    expect(off.every((r) => r.held === 0)).toBe(true);
    expect(off.some((r) => r.cap > 0)).toBe(true); // the V40 cap is what binds today
    expect(on.every((r) => r.d.action === 'call' && r.d.amount === 60)).toBe(true);
    expect(on.every((r) => r.held > 0)).toBe(true);
    for (const r of on) {
      expect(
        horseDecisionReceiptRefusalForGates(
          r.d,
          'plo5',
          { player: s.hero, gameState: s.gs as never },
          [false],
          [false],
          [false],
          [false]
        )
      ).toBeNull();
    }
    // The same through the Lightning game mode flag does not matter to the scope; PLO4 takes the same path.
    const plo4 = decideMany(turn('plo4', 'KhKd6s5d', BOARD), ON, 4);
    for (const r of plo4)
      expect(
        horseDecisionReceiptRefusalForGates(
          r.d,
          'plo4',
          {
            player: turn('plo4', 'KhKd6s5d', BOARD).hero,
            gameState: turn('plo4', 'KhKd6s5d', BOARD).gs as never,
          },
          [false],
          [false],
          [false],
          [false]
        )
      ).toBeNull();
  });

  it('PLO6 decisions are byte-identical with the option on', () => {
    for (const [hole, board] of [
      ['KhKd7c6s5dJc', BOARD],
      ['AsJs9h8hTd4c', 'Jc7h6d2s'],
      ['QsQhJdTc9h3d', '8h7c2d4s'],
    ] as const) {
      const s = turn('plo6', hole, board);
      const off = decideMany(s, {});
      const on = decideMany(s, ON);
      expect(on.map((r) => r.json)).toEqual(off.map((r) => r.json));
      expect(on.every((r) => r.held === 0)).toBe(true);
    }
  });

  it('a tournament decision is byte-identical with the option on; the default is off', () => {
    const t = turn('plo5', PLO5_HOLE, BOARD, 'tournament');
    expect(decideMany(t, ON).map((r) => r.json)).toEqual(decideMany(t, {}).map((r) => r.json));
    const s = turn('plo5', PLO5_HOLE, BOARD);
    expect(decideMany(s, {}).map((r) => r.json)).toEqual(
      decideMany(s, { omahaClassCapsRespectEquity: false }).map((r) => r.json)
    );
  });
});
