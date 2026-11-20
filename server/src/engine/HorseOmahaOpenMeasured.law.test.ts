/**
 * omahaOpenNeedsMeasuredStrength (default OFF; EMERG lane PREFLOP-AUDIT 2026-11-20; narrowed by EMERG
 * lane PREFLOP-2 the same day to the one cell that passes in real chips on fit and held-out data).
 * Law: in PLO5 cash on a table, preflop, three or more dealt in, a final first-in raise from a seat
 * that is not the button with a hand below the measured strength cut becomes a fold; PLO4 and the
 * PLO5 Lightning pools are untouched; the fold survives the response validator; aces and rundowns keep the open; the button, a
 * limped or raised pot, a call and a fold are untouched; PLO6, tournaments and the option off are
 * byte-identical. Synthetic public states and seeded random cards only: no recorded hand, no id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { omahaColdCallClass } from './HorseOmahaColdCallMeasured.js';
import {
  OMAHA_OPEN_MEASURED_CUT,
  OMAHA_OPEN_MEASURED_KEPT,
  omahaOpenMeasuredCell,
  omahaOpenMeasuredRule,
  omahaOpenMeasuredSpot,
} from './HorseOmahaOpenMeasured.js';
import { cardToInt } from './omahaMathCore/OmahaMathCoreEval.js';
import { preflopStrength } from './omahaMathCore/OmahaMathCorePreflop.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const RANKS = '23456789TJQKA'.split('') as CardRank[];
const SUITS: CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const ON: HorseDecideOpts = { omahaOpenNeedsMeasuredStrength: true };

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
  /** the Horse's seat: 3 = under the gun, 4 = cutoff, 5 = button, 1 = small blind (dealer on 5) */
  heroSeat?: number;
  /** a limper (seat 3 calls 2) or an opener (seat 3 raises to 7) before the Horse */
  before?: 'limp' | 'raise';
  lightning?: boolean;
  gameMode?: 'cash' | 'tournament';
  /** seats dealt in (default 6; 2 = heads-up with seats 1 and 2, dealer on 1) */
  dealt?: number;
}
const uid = (n: number) => `4300000${n}-0000-4000-8000-00000000000${n}`;
/** Six seats, blinds 1/2, dealer on 5: seat 1 small blind, seat 2 big blind, seat 3 first to act. */
function stateOf(hole: Card[], shape: Shape = {}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const headsUp = shape.dealt === 2;
  const heroSeat = headsUp ? 1 : (shape.heroSeat ?? 4);
  const seats = headsUp ? [1, 2] : [1, 2, 3, 4, 5, 6];
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
  if (!headsUp) {
    for (const s of [3, 4, 5, 6, 1]) {
      if (s === heroSeat) break;
      if (s === 3 && shape.before === 'limp') {
        bet.set(3, 2);
        rec(3, 'call', 2);
      } else if (s === 3 && shape.before === 'raise') {
        bet.set(3, 7);
        currentBet = 7;
        rec(3, 'raise', 7, { isFullRaise: true });
      } else {
        folded.add(s);
        rec(s, 'fold', 0);
      }
    }
  }
  const players = seats.map(
    (n) =>
      ({
        seat: n,
        user_id: uid(n),
        username: `P${n}`,
        stack: 400 - (bet.get(n) ?? 0),
        bet: bet.get(n) ?? 0,
        totalInvested: bet.get(n) ?? 0,
        cards: n === heroSeat ? hole : [],
        is_folded: folded.has(n),
        is_all_in: false,
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
    minRaise: 2,
    minRaiseTo: currentBet + Math.max(2, currentBet - 2),
    maxRaiseTo: Math.min(hero.stack + hero.bet, currentBet + pot + toCall),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: shape.variant ?? 'plo5',
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: headsUp ? 1 : 5,
    gameMode: shape.gameMode ?? 'cash',
    actionHistory: hist,
    ...(shape.lightning ? { publicMemoryDomain: { speed: 'lightning' } } : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

describe('the strength the rule reads is the strength the measurement was graded on', () => {
  // values of the offline grader (emerg/preflop-audit/work/thr.py), the same model file
  const cases: Array<[string, string, number]> = [
    ['plo5', 'AsAhKsKh2d', 0.648738],
    ['plo5', '9s8s7h6h2d', 0.479554],
    ['plo5', 'Ks9h7d4c2s', 0.450226],
    ['plo5', 'QsQhJdTc2s', 0.540947],
    ['plo5', '7s7h2d3c9s', 0.423331],
    ['plo4', 'AsAhKsKh', 0.808544],
    ['plo4', '9s8s7h6h', 0.53422],
    ['plo4', 'Ks9h7d4c', 0.453174],
    ['plo4', 'QsQhJdTc', 0.606401],
  ];
  it.each(cases)('%s %s', (variant, hole, value) => {
    expect(preflopStrength(variant, cards(hole).map(cardToInt))).toBeCloseTo(value, 5);
  });
  it('the cut is the 80th percentile of random holdings (seeded sample inside 1.5 points)', () => {
    for (const [variant, n] of [
      ['plo4', 4],
      ['plo5', 5],
    ] as const) {
      const rnd = mulberry32(80 + n);
      let below = 0;
      const N = 4000;
      for (let k = 0; k < N; k++)
        if (
          preflopStrength(variant, randomHole(rnd, n).map(cardToInt))! <
          OMAHA_OPEN_MEASURED_CUT[variant]!
        )
          below++;
      expect(below / N).toBeGreaterThan(0.785);
      expect(below / N).toBeLessThan(0.815);
    }
  });
});

describe('the spot', () => {
  const weak = cards('Ks9h7d4c2s');
  it('covers the first-in open from under the gun, the cutoff and the small blind', () => {
    for (const heroSeat of [3, 4, 1]) {
      const { hero, gs } = stateOf(weak, { heroSeat });
      const spot = omahaOpenMeasuredSpot(hero, gs);
      expect(spot?.cls).toBe('other');
      expect(spot!.strength).toBeLessThan(spot!.cut);
    }
  });
  it('covers only the measured cell: PLO5 on a table', () => {
    expect(omahaOpenMeasuredCell('plo5', false)).toBe(true);
    expect(omahaOpenMeasuredCell('plo5', true)).toBe(false);
    expect(omahaOpenMeasuredCell('plo4', false)).toBe(false);
    expect(omahaOpenMeasuredCell('plo6', false)).toBe(false);
    const light = stateOf(weak, { lightning: true });
    expect(omahaOpenMeasuredSpot(light.hero, light.gs)).toBeNull();
    for (const heroSeat of [3, 4, 1]) {
      const four = stateOf(cards('Ks9h7d4c'), { variant: 'plo4', heroSeat });
      expect(omahaOpenMeasuredSpot(four.hero, four.gs)).toBeNull();
    }
  });
  it('does not cover the button, a limped pot, a raised pot or heads-up', () => {
    const not = (shape: Shape) => {
      const { hero, gs } = stateOf(weak, shape);
      expect(omahaOpenMeasuredSpot(hero, gs)).toBeNull();
    };
    not({ heroSeat: 5 });
    not({ heroSeat: 4, before: 'limp' });
    not({ heroSeat: 4, before: 'raise' });
    not({ dealt: 2 });
  });
  it('does not cover a tournament, PLO6, PLO8 or hold-em', () => {
    const not = (hole: Card[], shape: Shape) => {
      const { hero, gs } = stateOf(hole, shape);
      expect(omahaOpenMeasuredSpot(hero, gs)).toBeNull();
    };
    not(weak, { gameMode: 'tournament' });
    not(cards('Ks9h7d4c2s3d'), { variant: 'plo6' });
    not(cards('Ks9h7d4c'), { variant: 'plo8' });
    not(cards('Ks9h'), { variant: 'nlh' });
  });
});

describe('the rule', () => {
  const raise = { action: 'raise', amount: 7, thinkTime: 900 };
  it('folds a first-in raise below the cut, and only a raise', () => {
    const { hero, gs } = stateOf(cards('Ks9h7d4c2s'));
    expect(omahaOpenMeasuredRule(raise, hero, gs, true)).toEqual({
      action: 'fold',
      thinkTime: 900,
    });
    const call = { action: 'call', amount: 2 };
    expect(omahaOpenMeasuredRule(call, hero, gs, true)).toBe(call);
    const fold = { action: 'fold' };
    expect(omahaOpenMeasuredRule(fold, hero, gs, true)).toBe(fold);
  });
  it('keeps the open of a hand at or above the cut, of aces and of a rundown', () => {
    for (const hole of ['AsAhKsKh2d', 'AsAh7d4c2s', '9s8h7d6c2s', '9s8s7h6h2d']) {
      const { hero, gs } = stateOf(cards(hole));
      expect(omahaOpenMeasuredRule(raise, hero, gs, true)).toBe(raise);
    }
    expect([...OMAHA_OPEN_MEASURED_KEPT].sort()).toEqual(
      ['aces', 'rundown', 'rundown_double_suited'].sort()
    );
  });
  it('off, or out of scope, returns the same object', () => {
    const { hero, gs } = stateOf(cards('Ks9h7d4c2s'));
    expect(omahaOpenMeasuredRule(raise, hero, gs, false)).toBe(raise);
    const button = stateOf(cards('Ks9h7d4c2s'), { heroSeat: 5 });
    expect(omahaOpenMeasuredRule(raise, button.hero, button.gs, true)).toBe(raise);
    const six = stateOf(cards('Ks9h7d4c2s3d'), { variant: 'plo6' });
    expect(omahaOpenMeasuredRule(raise, six.hero, six.gs, true)).toBe(raise);
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

describe('in the decision (seeded census of random hands, first in)', () => {
  it('PLO5 tables: every open below the cut becomes a fold the validator admits; PLO4 and Lightning do not move', () => {
    for (const [variant, n] of [
      ['plo5', 5],
      ['plo4', 4],
    ] as const) {
      const rnd = mulberry32(20261121 + n);
      let folded = 0;
      let kept = 0;
      for (let k = 0; k < 160; k++) {
        const hole = randomHole(rnd, n);
        const shape: Shape = {
          variant,
          heroSeat: k % 3 === 0 ? 1 : k % 3 === 1 ? 3 : 4,
          lightning: k % 2 === 0,
        };
        const off = decide(hole, shape, {}, 5300 + k);
        const on = decide(hole, shape, ON, 5300 + k);
        const strength = preflopStrength(variant, hole.map(cardToInt))!;
        const acts =
          off.d.action === 'raise' &&
          omahaOpenMeasuredCell(variant, shape.lightning === true) &&
          strength < OMAHA_OPEN_MEASURED_CUT[variant]! &&
          !OMAHA_OPEN_MEASURED_KEPT.has(omahaColdCallClass(hole));
        if (acts) {
          folded++;
          expect(on.d.action).toBe('fold');
          expect(on.fires).toContain('omaha_open_measured_fold');
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
          expect(on.fires).not.toContain('omaha_open_measured_fold');
        }
      }
      if (variant === 'plo5') expect(folded).toBeGreaterThan(0);
      else expect(folded).toBe(0);
      expect(kept).toBeGreaterThan(0);
    }
  });
  it('PLO6 is byte-identical with the option on (owner 2026-11-19 8:27 PM: PLO6 is not touched)', () => {
    const rnd = mulberry32(616);
    for (let k = 0; k < 60; k++) {
      const hole = randomHole(rnd, 6);
      const shape: Shape = { variant: 'plo6', heroSeat: k % 2 ? 1 : 4 };
      const off = decide(hole, shape, {}, 6300 + k);
      const on = decide(hole, shape, ON, 6300 + k);
      expect(bytesOf(on.d)).toBe(bytesOf(off.d));
      expect(on.next).toBe(off.next);
      expect(on.fires).not.toContain('omaha_open_measured_fold');
    }
  });
  it('the button, a limped pot and a tournament are byte-identical with the option on', () => {
    const rnd = mulberry32(717);
    for (let k = 0; k < 60; k++) {
      const hole = randomHole(rnd, 5);
      const shape: Shape =
        k % 3 === 0
          ? { heroSeat: 5 }
          : k % 3 === 1
            ? { heroSeat: 4, before: 'limp' }
            : { gameMode: 'tournament', heroSeat: 4 };
      const off = decide(hole, shape, {}, 7300 + k);
      const on = decide(hole, shape, ON, 7300 + k);
      expect(bytesOf(on.d)).toBe(bytesOf(off.d));
      expect(on.next).toBe(off.next);
      expect(on.fires).not.toContain('omaha_open_measured_fold');
    }
  });
});
