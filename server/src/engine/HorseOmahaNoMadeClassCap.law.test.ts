/**
 * omahaNoMadeClassCap (lane HIDDEN-ON 2026-11-20, default OFF). See HorseOmahaClassCapsRespectEquity.ts and
 * EMERG/HIDDEN-ON.md (leave-one-out exact journal replay; hands 60037338, 60117866, 60167023).
 *
 *  1. Scope: PLO4 and PLO5 cash only (table and Lightning). PLO6, PLO8, hold'em and every tournament are out
 *     (owner 2026-11-19 8:27 PM: do not touch PLO6).
 *  2. End to end on a constructed PLO5 turn spot (overpair with a wrap facing a pot bet, the V40 cap binding):
 *     with the option off the cap fires and the Horse folds on every seed; with it on the cap never fires, the
 *     receipt fires on every seed, the Horse continues, and the action is a valid signed receipt under the door
 *     the decision client uses. PLO4 takes the same path.
 *  3. PLO6 decisions are byte-identical with the option on.
 *  4. A tournament decision is byte-identical with the option on; unset equals false.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { omahaNoMadeClassCapInScope } from './HorseOmahaClassCapsRespectEquity.js';
import { horseDecisionReceiptRefusalForGates } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-0000000040cb';
const NOT_APPLIED = 'omaha_made_class_cap_not_applied';
const CAP = 'v40_omaha_pressure_cap';
const ON = { omahaNoMadeClassCap: true };
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
    notApplied: number;
    cap: number;
    json: string;
  }> = [];
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 41);
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
      notApplied: fires.find((r) => r.feature === NOT_APPLIED)?.fires ?? 0,
      cap: fires.find((r) => r.feature === CAP)?.fires ?? 0,
      json: JSON.stringify(d, (k, v) => (TIMING_KEYS.has(k) ? 0 : v)),
    });
  }
  return out;
}

// Constructed spot (no production hand): PLO5, KK overpair to the 7 with a 7-6-5 wrap on Qc 7d 3s 2h, facing a
// pot-size turn bet. The V40 class cap ('pair' 0.28 + 0.04 turn) binds far below the hand's sampled equity.
const PLO5_HOLE = 'KhKd7c6s5d';
const BOARD = 'Qc7d3s2h';

describe('omahaNoMadeClassCap', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('acts only in PLO4/PLO5 cash', () => {
    const base = { enabled: true, gameVariant: 'plo5', tournament: false };
    expect(omahaNoMadeClassCapInScope(base)).toBe(true);
    expect(omahaNoMadeClassCapInScope({ ...base, gameVariant: 'plo4' })).toBe(true);
    expect(omahaNoMadeClassCapInScope({ ...base, gameVariant: 'PLO5' })).toBe(true);
    expect(omahaNoMadeClassCapInScope({ ...base, enabled: false })).toBe(false);
    expect(omahaNoMadeClassCapInScope({ ...base, gameVariant: 'plo6' })).toBe(false);
    expect(omahaNoMadeClassCapInScope({ ...base, gameVariant: 'plo8' })).toBe(false);
    expect(omahaNoMadeClassCapInScope({ ...base, gameVariant: 'nlh' })).toBe(false);
    expect(omahaNoMadeClassCapInScope({ ...base, gameVariant: undefined })).toBe(false);
    expect(omahaNoMadeClassCapInScope({ ...base, tournament: true })).toBe(false);
  });

  it('end to end: the cap does not run, the receipt fires, the capped fold is gone and the action passes the decision door', () => {
    const s = turn('plo5', PLO5_HOLE, BOARD);
    const off = decideMany(s, {});
    const on = decideMany(s, ON);
    expect(off.every((r) => r.d.action === 'fold')).toBe(true);
    expect(off.some((r) => r.cap > 0)).toBe(true); // the V40 cap is what binds today
    expect(off.every((r) => r.notApplied === 0)).toBe(true);
    expect(on.every((r) => r.cap === 0)).toBe(true);
    expect(on.every((r) => r.notApplied > 0)).toBe(true);
    expect(on.every((r) => r.d.action !== 'fold')).toBe(true);
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
    const s4 = turn('plo4', 'KhKd6s5d', BOARD);
    const on4 = decideMany(s4, ON, 4);
    expect(on4.every((r) => r.cap === 0)).toBe(true);
    for (const r of on4)
      expect(
        horseDecisionReceiptRefusalForGates(
          r.d,
          'plo4',
          { player: s4.hero, gameState: s4.gs as never },
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
      expect(on.every((r) => r.notApplied === 0)).toBe(true);
    }
  });

  it('a tournament decision is byte-identical with the option on; unset equals false', () => {
    const t = turn('plo5', PLO5_HOLE, BOARD, 'tournament');
    expect(decideMany(t, ON).map((r) => r.json)).toEqual(decideMany(t, {}).map((r) => r.json));
    const s = turn('plo5', PLO5_HOLE, BOARD);
    expect(decideMany(s, {}).map((r) => r.json)).toEqual(
      decideMany(s, { omahaNoMadeClassCap: false }).map((r) => r.json)
    );
  });
});
