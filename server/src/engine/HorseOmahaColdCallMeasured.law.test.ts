/**
 * omahaColdCallOutsideBigBlindIsMeasured (default OFF; EMERG lane PREFLOP-AUDIT 2026-11-20).
 * Narrowed by EMERG lane PREFLOP-2 the same day to the cell that costs real chips (the small blind,
 * nobody else has called, a hand below the strongest 20%).
 * Law: on a PLO4/PLO5 cash table, preflop, a final cold call of exactly one raise from the small
 * blind when nobody else has called, with a hand below the strongest 20%, with a hand class measured to lose against folding, becomes a fold; the
 * fold survives the response validator; a raise, a fold, the big blind, aces and the classes not
 * measured negative are untouched; Lightning, PLO6, tournaments and the option off are byte-identical.
 * Synthetic public states and seeded random cards only: no recorded hand, no player id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  OMAHA_COLD_CALL_CLASS_VALUE,
  OMAHA_COLD_CALL_REAL_CELL,
  OMAHA_COLD_CALL_STRENGTH_CUT,
  omahaColdCallRealCell,
  omahaColdCallClass,
  omahaColdCallClassFolds,
  omahaColdCallOutsideBigBlindRule,
  omahaColdCallOutsideBigBlindSpot,
  type OmahaColdCallClass,
} from './HorseOmahaColdCallMeasured.js';
import { OMAHA_OPEN_MEASURED_CUT } from './HorseOmahaOpenMeasured.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const RANKS = '23456789TJQKA'.split('') as CardRank[];
const SUITS: CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const ON: HorseDecideOpts = { omahaColdCallOutsideBigBlindIsMeasured: true };

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomHole(rnd: () => number, n: number): Card[] {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck.slice(0, n);
}

interface Shape {
  variant?: string;
  /** the Horse's seat: 4 = cutoff, 5 = button, 1 = small blind, 2 = big blind (dealer on 5, six seats) */
  heroSeat?: number;
  /** extra preflop actions before the Horse, after the under-the-gun open to 7 */
  more?: Array<{ seat: number; action: string; amount: number }>;
  lightning?: boolean;
  gameMode?: 'cash' | 'tournament';
  raiserAllIn?: boolean;
  heroLimped?: boolean;
}
const uid = (n: number) => `4200000${n}-0000-4000-8000-00000000000${n}`;
/** Six seats, blinds 1/2, dealer on 5: seat 1 small blind, seat 2 big blind, seat 3 opens to 7. */
function stateOf(hole: Card[], shape: Shape = {}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroSeat = shape.heroSeat ?? 5;
  const bet = new Map<number, number>([
    [1, 1],
    [2, 2],
  ]);
  const folded = new Set<number>();
  const hist: unknown[] = [];
  let ts = 1;
  const rec = (seat: number, action: string, amount: number, extra: object = {}) =>
    hist.push({
      stage: 'preflop',
      seat,
      userId: uid(seat),
      action,
      amount,
      timestamp: ts++,
      ...extra,
    });
  rec(1, 'sb', 1);
  rec(2, 'bb', 2);
  let currentBet = 2;
  if (shape.heroLimped) {
    rec(heroSeat, 'call', 2);
    bet.set(heroSeat, 2);
  }
  rec(3, shape.raiserAllIn ? 'all_in' : 'raise', 7, { isFullRaise: true });
  bet.set(3, 7);
  currentBet = 7;
  for (const m of shape.more ?? []) {
    if (m.action === 'fold') folded.add(m.seat);
    else {
      bet.set(m.seat, m.amount);
      if (m.action === 'raise') currentBet = m.amount;
    }
    rec(m.seat, m.action, m.amount, m.action === 'raise' ? { isFullRaise: true } : {});
  }
  // everyone between the opener and the Horse who has not acted has folded
  for (const s of [4, 5, 1, 2]) {
    if (s === heroSeat) break;
    if (!(shape.more ?? []).some((m) => m.seat === s)) {
      folded.add(s);
      rec(s, 'fold', 0);
    }
  }
  const players = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      ({
        seat: n,
        user_id: uid(n),
        username: `P${n}`,
        stack: 400 - (bet.get(n) ?? 0),
        bet: bet.get(n) ?? 0,
        totalInvested: bet.get(n) ?? 0,
        cards: n === heroSeat ? hole : [],
        is_folded: folded.has(n) || n === 6,
        is_all_in: n === 3 && shape.raiserAllIn === true,
        is_sitting_out: false,
        is_horse: n === heroSeat,
      }) as SeatPlayer
  );
  const hero = players.find((p) => p.seat === heroSeat)!;
  const pot = [...bet.values()].reduce((a, b) => a + b, 0);
  const toCall = currentBet - hero.bet;
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet,
    toCall,
    minRaise: 5,
    minRaiseTo: currentBet + 5,
    maxRaiseTo: Math.min(hero.stack + hero.bet, currentBet + pot + toCall),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: shape.variant ?? 'plo5',
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 5,
    gameMode: shape.gameMode ?? 'cash',
    actionHistory: hist,
    ...(shape.lightning ? { publicMemoryDomain: { speed: 'lightning' } } : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

describe('the class', () => {
  const cases: Array<[string, OmahaColdCallClass]> = [
    ['AsAh7d4c2s', 'aces'],
    ['KsKh7d4c2s', 'kings'],
    ['QsQhJdTc2s', 'queens_jacks_broadway'],
    ['JsJhKdTc2s', 'queens_jacks_broadway'],
    ['9s8s7h6h2d', 'rundown_double_suited'],
    ['9s8h7d6c2s', 'rundown'],
    ['Ks9s7h3h2d', 'double_suited'],
    ['AsKhQd7c2s', 'broadway'],
    ['AsKhQdTc2s', 'rundown'],
    ['9s9h7d4c2s', 'pair'],
    ['Ks9h7d4c2s', 'other'],
    ['9s8s7h6h', 'rundown_double_suited'],
    ['Ks9h7d4c', 'other'],
  ];
  it.each(cases)('%s is %s', (hole, cls) => {
    expect(omahaColdCallClass(cards(hole))).toBe(cls);
  });
  it('folds exactly the classes measured below zero by more than one standard error, never aces', () => {
    const folds = (Object.keys(OMAHA_COLD_CALL_CLASS_VALUE) as OmahaColdCallClass[]).filter(
      omahaColdCallClassFolds
    );
    expect(folds.sort()).toEqual(
      ['double_suited', 'kings', 'other', 'pair', 'rundown', 'rundown_double_suited'].sort()
    );
    for (const cls of folds) {
      const m = OMAHA_COLD_CALL_CLASS_VALUE[cls];
      expect(m.valueBB + m.seBB).toBeLessThan(0);
    }
    expect(omahaColdCallClassFolds('aces')).toBe(false);
  });
});

describe('the spot', () => {
  const weak = cards('Ks9h7d4c2s');
  it('covers the cold call of one open from the button, the cutoff and the small blind', () => {
    for (const heroSeat of [4, 5, 1]) {
      const { hero, gs } = stateOf(weak, { heroSeat });
      expect(omahaColdCallOutsideBigBlindSpot(hero, gs)?.cls).toBe('other');
    }
    const four = stateOf(cards('Ks9h7d4c'), { variant: 'plo4' });
    expect(omahaColdCallOutsideBigBlindSpot(four.hero, four.gs)?.cls).toBe('other');
  });
  it('does not cover the big blind, a limper, a 3-bet pot, an all-in opener', () => {
    const not = (shape: Shape) => {
      const { hero, gs } = stateOf(weak, shape);
      expect(omahaColdCallOutsideBigBlindSpot(hero, gs)).toBeNull();
    };
    not({ heroSeat: 2 });
    not({ heroSeat: 5, heroLimped: true });
    not({ heroSeat: 5, more: [{ seat: 4, action: 'raise', amount: 24 }] });
    not({ heroSeat: 5, raiserAllIn: true });
  });
  it('does not cover Lightning, a tournament, PLO6, PLO8 or hold-em', () => {
    const not = (hole: Card[], shape: Shape) => {
      const { hero, gs } = stateOf(hole, shape);
      expect(omahaColdCallOutsideBigBlindSpot(hero, gs)).toBeNull();
    };
    not(weak, { lightning: true });
    not(weak, { gameMode: 'tournament' });
    not(cards('Ks9h7d4c2s3d'), { variant: 'plo6' });
    not(cards('Ks9h7d4c'), { variant: 'plo8' });
    not(cards('Ks9h'), { variant: 'nlh' });
  });
});

describe('the rule', () => {
  const call = { action: 'call', amount: 6, thinkTime: 900 };
  const weak = cards('Ks9h7d4c2s');
  it('acts in the real-chip cell only: the small blind, nobody else has called, below the strongest 20%', () => {
    expect(OMAHA_COLD_CALL_REAL_CELL.fitBB + OMAHA_COLD_CALL_REAL_CELL.fitSeBB).toBeLessThan(0);
    expect(
      OMAHA_COLD_CALL_REAL_CELL.heldOutBB + OMAHA_COLD_CALL_REAL_CELL.heldOutSeBB
    ).toBeLessThan(0);
    expect(OMAHA_COLD_CALL_STRENGTH_CUT).toEqual(OMAHA_OPEN_MEASURED_CUT);
    const sb = stateOf(weak, { heroSeat: 1 });
    const spot = omahaColdCallOutsideBigBlindSpot(sb.hero, sb.gs)!;
    expect(spot.smallBlind).toBe(true);
    expect(spot.callers).toBe(0);
    expect(spot.strength!).toBeLessThan(spot.strengthCut);
    expect(omahaColdCallRealCell(spot)).toBe(true);
    expect(omahaColdCallOutsideBigBlindRule(call, sb.hero, sb.gs, true)).toEqual({
      action: 'fold',
      thinkTime: 900,
    });
    const raise = { action: 'raise', amount: 24 };
    expect(omahaColdCallOutsideBigBlindRule(raise, sb.hero, sb.gs, true)).toBe(raise);
    const fold = { action: 'fold' };
    expect(omahaColdCallOutsideBigBlindRule(fold, sb.hero, sb.gs, true)).toBe(fold);
  });
  it('the button, the cutoff, a pot somebody has called and a hand of the strongest 20% keep the call', () => {
    for (const heroSeat of [4, 5]) {
      const s = stateOf(weak, { heroSeat });
      expect(omahaColdCallOutsideBigBlindSpot(s.hero, s.gs)!.smallBlind).toBe(false);
      expect(omahaColdCallOutsideBigBlindRule(call, s.hero, s.gs, true)).toBe(call);
    }
    const called = stateOf(weak, { heroSeat: 1, more: [{ seat: 4, action: 'call', amount: 7 }] });
    expect(omahaColdCallOutsideBigBlindSpot(called.hero, called.gs)!.callers).toBe(1);
    expect(omahaColdCallOutsideBigBlindRule(call, called.hero, called.gs, true)).toBe(call);
    const strong = stateOf(cards('KsKhQsJh2d'), { heroSeat: 1 });
    const spot = omahaColdCallOutsideBigBlindSpot(strong.hero, strong.gs)!;
    expect(spot.cls).toBe('kings');
    expect(spot.strength!).toBeGreaterThanOrEqual(spot.strengthCut);
    expect(omahaColdCallOutsideBigBlindRule(call, strong.hero, strong.gs, true)).toBe(call);
  });
  it('keeps the call of aces and of the classes not measured negative', () => {
    for (const hole of ['AsAh7d4c2s', 'QsQhJd7c2s', 'AsKhQd7c2s']) {
      const { hero, gs } = stateOf(cards(hole), { heroSeat: 1 });
      expect(omahaColdCallOutsideBigBlindRule(call, hero, gs, true)).toBe(call);
    }
  });
  it('off, or out of scope, returns the same object', () => {
    const { hero, gs } = stateOf(weak, { heroSeat: 1 });
    expect(omahaColdCallOutsideBigBlindRule(call, hero, gs, false)).toBe(call);
    const bb = stateOf(weak, { heroSeat: 2 });
    expect(omahaColdCallOutsideBigBlindRule(call, bb.hero, bb.gs, true)).toBe(call);
    const six = stateOf(cards('Ks9h7d4c2s3d'), { variant: 'plo6', heroSeat: 1 });
    expect(omahaColdCallOutsideBigBlindRule(call, six.hero, six.gs, true)).toBe(call);
  });
});

const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
function decide(hole: Card[], shape: Shape, opts: HorseDecideOpts, seed: number) {
  enableBrainTelemetry();
  HorseMind.reset();
  const { hero, gs } = stateOf(hole, shape);
  drainFires();
  seedFastRandom(seed);
  const d = structuredClone(
    HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts } as never)
  );
  return { hero, gs, d, next: fastRandom(), fires: drainFires().map((f) => f.feature) };
}

describe('in the decision (seeded census of random hands, the button facing one open)', () => {
  it('PLO4 and PLO5 tables: every losing-class call becomes a fold the validator admits; nothing else moves', () => {
    for (const [variant, n] of [
      ['plo5', 5],
      ['plo4', 4],
    ] as const) {
      const rnd = mulberry32(20261120 + n);
      let folded = 0;
      let kept = 0;
      for (let k = 0; k < 120; k++) {
        const hole = randomHole(rnd, n);
        const shape: Shape = { variant, heroSeat: k % 3 === 0 ? 1 : k % 3 === 1 ? 4 : 5 };
        const off = decide(hole, shape, {}, 5100 + k);
        const on = decide(hole, shape, ON, 5100 + k);
        const cls = omahaColdCallClass(hole);
        const spot = omahaColdCallOutsideBigBlindSpot(off.hero, off.gs);
        if (
          off.d.action === 'call' &&
          omahaColdCallClassFolds(cls) &&
          spot !== null &&
          omahaColdCallRealCell(spot)
        ) {
          folded++;
          expect(on.d.action).toBe('fold');
          expect(on.fires).toContain('omaha_cold_call_measured_fold');
          expect(
            horseDecisionReceiptRefusal(structuredClone(on.d), variant, {
              player: on.hero,
              gameState: on.gs,
            })
          ).toBeNull();
        } else {
          kept++;
          expect(bytesOf(on.d)).toBe(bytesOf(off.d));
          expect(on.next).toBe(off.next);
          expect(on.fires).not.toContain('omaha_cold_call_measured_fold');
        }
      }
      expect(folded).toBeGreaterThan(0);
      expect(kept).toBeGreaterThan(0);
    }
  });
  it('PLO6 is byte-identical with the option on (owner 2026-11-19 8:27 PM: PLO6 is not touched)', () => {
    const rnd = mulberry32(606);
    for (let k = 0; k < 60; k++) {
      const hole = randomHole(rnd, 6);
      const shape: Shape = { variant: 'plo6', heroSeat: k % 2 ? 1 : 5 };
      const off = decide(hole, shape, {}, 6100 + k);
      const on = decide(hole, shape, ON, 6100 + k);
      expect(bytesOf(on.d)).toBe(bytesOf(off.d));
      expect(on.next).toBe(off.next);
      expect(on.fires).not.toContain('omaha_cold_call_measured_fold');
    }
  });
  it('Lightning, the big blind and a tournament are byte-identical with the option on', () => {
    const rnd = mulberry32(707);
    for (let k = 0; k < 60; k++) {
      const hole = randomHole(rnd, 5);
      const shape: Shape =
        k % 3 === 0
          ? { lightning: true, heroSeat: 5 }
          : k % 3 === 1
            ? { heroSeat: 2 }
            : { gameMode: 'tournament', heroSeat: 5 };
      const off = decide(hole, shape, {}, 7100 + k);
      const on = decide(hole, shape, ON, 7100 + k);
      expect(bytesOf(on.d)).toBe(bytesOf(off.d));
      expect(on.next).toBe(off.next);
      expect(on.fires).not.toContain('omaha_cold_call_measured_fold');
    }
  });
});
