/**
 * omahaAcesReraiseIsMeasured and omahaReraiseRangeIsMeasured (each default OFF; EMERG lane PREFLOP-2
 * 2026-11-20).
 * Law: in PLO4/PLO5 cash, preflop, a final call becomes the pot-size re-raise only in the cells where
 * the re-raise was measured to earn more REAL chips (chips to and from persons) than the call on fit
 * and on held-out data, each by more than one standard error: aces facing a 3-bet at 250 bb or less
 * (there a fold of aces too), and kings facing a 3-bet in position. The re-raise survives the
 * response validator; every other call, every raise and every other fold are untouched; a decision
 * the three-way pricing judged stands; PLO6, tournaments and the options off are byte-identical.
 * Synthetic public states and seeded random cards only: no recorded hand, no player id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { omahaColdCallClass } from './HorseOmahaColdCallMeasured.js';
import {
  OMAHA_ACES_RERAISE_CELLS,
  OMAHA_RERAISE_RANGE_CELLS,
  omahaAcesReraiseCell,
  omahaAcesReraiseMeasuredRule,
  omahaReraiseMeasuredPasses,
  omahaReraiseMeasuredSpot,
  omahaReraiseRangeCell,
  omahaReraiseRangeMeasuredRule,
} from './HorseOmahaReraiseMeasured.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const RANKS = '23456789TJQKA'.split('') as CardRank[];
const SUITS: CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const ACES_ON: HorseDecideOpts = { omahaAcesReraiseIsMeasured: true };
const RANGE_ON: HorseDecideOpts = { omahaReraiseRangeIsMeasured: true };

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
function randomHole(rnd: () => number, n: number, start: Card[] = []): Card[] {
  const taken = new Set(start.map((c) => c.rank + c.suit));
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))).filter(
    (c) => !taken.has(c.rank + c.suit)
  );
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return [...start, ...deck.slice(0, n - start.length)];
}

interface Shape {
  variant?: string;
  /** the Horse's seat: 4 = cutoff, 5 = button, 1 = small blind, 2 = big blind (dealer on 5) */
  heroSeat?: number;
  /** seat 4 re-raises the under-the-gun open to 24 before the Horse (the Horse then faces a 3-bet) */
  threeBet?: boolean;
  /** seat 3 then makes it 80 (the Horse then faces a 4-bet) */
  fourBet?: boolean;
  /** the Horse's chips at the start of the hand (default 400 = 200 big blinds) */
  stack?: number;
  lightning?: boolean;
  gameMode?: 'cash' | 'tournament';
}
const uid = (n: number) => `4400000${n}-0000-4000-8000-00000000000${n}`;
/** Six seats, blinds 1/2, dealer on 5: seat 1 small blind, seat 2 big blind, seat 3 opens to 7. */
function stateOf(hole: Card[], shape: Shape = {}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroSeat = shape.heroSeat ?? 5;
  const bet = new Map<number, number>([
    [1, 1],
    [2, 2],
  ]);
  const folded = new Set<number>([6]);
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
  rec(3, 'raise', 7, { isFullRaise: true });
  bet.set(3, 7);
  let currentBet = 7;
  if (shape.threeBet || shape.fourBet) {
    rec(4, 'raise', 24, { isFullRaise: true });
    bet.set(4, 24);
    currentBet = 24;
  }
  // everyone between the last seat that acted and the Horse has folded
  for (const s of shape.threeBet || shape.fourBet ? [5, 1, 2] : [4, 5, 1, 2]) {
    if (s === heroSeat) break;
    folded.add(s);
    rec(s, 'fold', 0);
  }
  if (shape.fourBet) {
    rec(3, 'raise', 80, { isFullRaise: true });
    bet.set(3, 80);
    currentBet = 80;
  }
  const start = shape.stack ?? 400;
  const players = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      ({
        seat: n,
        user_id: uid(n),
        username: `P${n}`,
        stack: (n === heroSeat ? start : 400) - (bet.get(n) ?? 0),
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
    minRaise: 5,
    minRaiseTo: currentBet + 5,
    maxRaiseTo: Math.min(hero.stack + hero.bet, currentBet + pot + toCall),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: shape.variant ?? 'plo5',
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 5,
    blindSeats: { smallBlind: 1, bigBlind: 2 },
    gameMode: shape.gameMode ?? 'cash',
    actionHistory: hist,
    ...(shape.lightning ? { publicMemoryDomain: { speed: 'lightning' } } : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

describe('the cells are the measured ones', () => {
  it('every shipped cell is positive in real chips on fit and held-out data by more than one standard error', () => {
    for (const g of [
      OMAHA_ACES_RERAISE_CELLS.facingThreeBet,
      OMAHA_ACES_RERAISE_CELLS.facingThreeBet.againstFold,
      OMAHA_RERAISE_RANGE_CELLS.kingsInPositionFourBet,
    ]) {
      expect(g.fitBB - g.fitSeBB).toBeGreaterThan(0);
      expect(g.heldOutBB - g.heldOutSeBB).toBeGreaterThan(0);
      expect(omahaReraiseMeasuredPasses(g)).toBe(true);
    }
    // measured, and not in the rule: the re-raise of aces facing one raise does not pass in real chips
    expect(omahaReraiseMeasuredPasses(OMAHA_ACES_RERAISE_CELLS.facingOneRaiseMultiway)).toBe(false);
    expect(OMAHA_ACES_RERAISE_CELLS.facingThreeBet.stackAtMostBB).toBe(250);
  });
});

describe('aces', () => {
  const aces = cards('AsAh7d4c2s');
  const c24 = { action: 'call', amount: 24, thinkTime: 900 };
  it('facing a 3-bet with 250 bb or less: the call becomes the pot raise; deeper keeps the call', () => {
    for (const stack of [400, 500]) {
      const { hero, gs } = stateOf(aces, { threeBet: true, stack });
      const spot = omahaReraiseMeasuredSpot(hero, gs)!;
      expect(spot.raises).toBe(2);
      expect(omahaAcesReraiseCell(spot)).toBe(true);
      expect(omahaAcesReraiseMeasuredRule(c24, hero, gs, true)).toEqual({
        action: 'raise',
        amount: gs.maxRaiseTo,
        thinkTime: 900,
      });
    }
    const deep = stateOf(aces, { threeBet: true, stack: 502 });
    expect(omahaAcesReraiseMeasuredRule(c24, deep.hero, deep.gs, true)).toBe(c24);
    const four = stateOf(cards('AsAh7d4c'), { variant: 'plo4', lightning: true, threeBet: true });
    expect(omahaAcesReraiseMeasuredRule(c24, four.hero, four.gs, true).action).toBe('raise');
  });
  it('the pot raise that is the whole stack is the all-in', () => {
    const { hero, gs } = stateOf(aces, { threeBet: true, stack: 60 });
    expect(omahaAcesReraiseMeasuredRule({ action: 'call', amount: 24 }, hero, gs, true)).toEqual({
      action: 'all_in',
    });
  });
  it('facing one raise (multiway or heads-up) and facing a 4-bet the call stands', () => {
    const c7 = { action: 'call', amount: 7 };
    for (const shape of [{}, { heroSeat: 2 }, { heroSeat: 1 }, { stack: 200 }]) {
      const s = stateOf(aces, shape);
      expect(omahaReraiseMeasuredSpot(s.hero, s.gs)!.raises).toBe(1);
      expect(omahaAcesReraiseMeasuredRule(c7, s.hero, s.gs, true)).toBe(c7);
    }
    const fourBet = stateOf(aces, { fourBet: true, heroSeat: 5 });
    expect(omahaReraiseMeasuredSpot(fourBet.hero, fourBet.gs)!.raises).toBe(3);
    const c80 = { action: 'call', amount: 80 };
    expect(omahaAcesReraiseMeasuredRule(c80, fourBet.hero, fourBet.gs, true)).toBe(c80);
  });
  it('a fold of aces becomes the re-raise in the same cell, and nowhere else', () => {
    const fold = { action: 'fold', thinkTime: 700 };
    const { hero, gs } = stateOf(aces, { threeBet: true });
    expect(omahaAcesReraiseCell(omahaReraiseMeasuredSpot(hero, gs)!, 'fold')).toBe(true);
    expect(omahaAcesReraiseMeasuredRule(fold, hero, gs, true)).toEqual({
      action: 'raise',
      amount: gs.maxRaiseTo,
      thinkTime: 700,
    });
    const priced = { ...fold, omahaPreflopThreeWay: { verdict: 'fold' } };
    expect(omahaAcesReraiseMeasuredRule(priced, hero, gs, true)).toBe(priced);
    for (const shape of [{}, { heroSeat: 2 }, { threeBet: true, stack: 502 }, { fourBet: true }]) {
      const s = stateOf(aces, shape);
      expect(omahaAcesReraiseMeasuredRule(fold, s.hero, s.gs, true)).toBe(fold);
    }
    const kings = stateOf(cards('KsKh7d4c2s'), { threeBet: true });
    expect(omahaAcesReraiseMeasuredRule(fold, kings.hero, kings.gs, true)).toBe(fold);
    expect(omahaReraiseRangeMeasuredRule(fold, kings.hero, kings.gs, true)).toBe(fold);
    expect(omahaAcesReraiseMeasuredRule(fold, hero, gs, false)).toBe(fold);
  });
  it('only aces, only with a raise legal, never a call the three-way pricing judged', () => {
    const { hero, gs } = stateOf(aces, { threeBet: true });
    const raise = { action: 'raise', amount: 77 };
    expect(omahaAcesReraiseMeasuredRule(raise, hero, gs, true)).toBe(raise);
    const queens = stateOf(cards('QsQh7d4c2s'), { threeBet: true });
    expect(omahaAcesReraiseMeasuredRule(c24, queens.hero, queens.gs, true)).toBe(c24);
    const priced = { ...c24, omahaPreflopThreeWay: { verdict: 'call' } };
    expect(omahaAcesReraiseMeasuredRule(priced, hero, gs, true)).toBe(priced);
    const noRaise = stateOf(aces, { threeBet: true });
    (noRaise.gs as { legalActions: string[] }).legalActions = ['fold', 'call'];
    expect(omahaAcesReraiseMeasuredRule(c24, noRaise.hero, noRaise.gs, true)).toBe(c24);
  });
  it('off, PLO6, PLO8, hold-em and a tournament return the same object', () => {
    const { hero, gs } = stateOf(aces, { threeBet: true });
    expect(omahaAcesReraiseMeasuredRule(c24, hero, gs, false)).toBe(c24);
    const not = (hole: Card[], shape: Shape) => {
      const s = stateOf(hole, { ...shape, threeBet: true });
      expect(omahaReraiseMeasuredSpot(s.hero, s.gs)).toBeNull();
      expect(omahaAcesReraiseMeasuredRule(c24, s.hero, s.gs, true)).toBe(c24);
      expect(omahaReraiseRangeMeasuredRule(c24, s.hero, s.gs, true)).toBe(c24);
    };
    not(cards('AsAh7d4c2s3d'), { variant: 'plo6' });
    not(cards('AsAh7d4c'), { variant: 'plo8' });
    not(cards('AsAh'), { variant: 'nlh' });
    not(aces, { gameMode: 'tournament' });
    not(cards('KsKh7d4c2s3d'), { variant: 'plo6' });
  });
});

describe('the re-raise range for hands that are not aces', () => {
  const kings = cards('KsKh7d4c2s');
  const c24 = { action: 'call', amount: 24, thinkTime: 900 };
  it('kings facing a 3-bet in position: the call becomes the pot 4-bet', () => {
    const { hero, gs } = stateOf(kings, { threeBet: true });
    const spot = omahaReraiseMeasuredSpot(hero, gs)!;
    expect(spot.inPosition).toBe(true);
    expect(omahaReraiseRangeCell(spot)).toBe(true);
    expect(omahaReraiseRangeMeasuredRule(c24, hero, gs, true)).toEqual({
      action: 'raise',
      amount: gs.maxRaiseTo,
      thinkTime: 900,
    });
    const light = stateOf(kings, { threeBet: true, lightning: true });
    expect(omahaReraiseRangeMeasuredRule(c24, light.hero, light.gs, true).action).toBe('raise');
  });
  it('out of position, facing one raise or a 4-bet, and every other class keep the call', () => {
    for (const heroSeat of [1, 2]) {
      const blind = stateOf(kings, { threeBet: true, heroSeat });
      expect(omahaReraiseMeasuredSpot(blind.hero, blind.gs)!.inPosition).toBe(false);
      expect(omahaReraiseRangeMeasuredRule(c24, blind.hero, blind.gs, true)).toBe(c24);
    }
    for (const shape of [{}, { heroSeat: 1 }, { fourBet: true }]) {
      const s = stateOf(kings, shape);
      expect(omahaReraiseRangeMeasuredRule(c24, s.hero, s.gs, true)).toBe(c24);
    }
    for (const hole of ['QsQhJdTc2s', '9s8s7h6h2d', 'AsKhQd7c2s', 'AsAh7d4c2s', 'Ks9s7h3h2d']) {
      const s = stateOf(cards(hole), { threeBet: true });
      expect(omahaReraiseRangeMeasuredRule(c24, s.hero, s.gs, true)).toBe(c24);
    }
    const { hero, gs } = stateOf(kings, { threeBet: true });
    const priced = { ...c24, omahaPreflopThreeWay: { verdict: 'call' } };
    expect(omahaReraiseRangeMeasuredRule(priced, hero, gs, true)).toBe(priced);
    expect(omahaReraiseRangeMeasuredRule(c24, hero, gs, false)).toBe(c24);
    const raise = { action: 'raise', amount: 77 };
    expect(omahaReraiseRangeMeasuredRule(raise, hero, gs, true)).toBe(raise);
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
/** The options that make the reference brain flat aces (the re-raise range rules of 2026-11-15). */
const FLATS: HorseDecideOpts = {
  omahaReraiseRangeOutOfPosition: true,
  omahaReraiseRangeEarlyPosition: true,
};
const SHAPES: Shape[] = [
  { heroSeat: 1 },
  { heroSeat: 5 },
  { heroSeat: 5, threeBet: true, stack: 300 },
  { heroSeat: 5, threeBet: true },
  { heroSeat: 1, threeBet: true },
  { heroSeat: 5, threeBet: true, stack: 1200 },
  { heroSeat: 4, stack: 160 },
  { heroSeat: 2, threeBet: true },
  { heroSeat: 1, threeBet: true, lightning: true },
];

describe('in the decision (seeded census)', () => {
  it('aces: every call or fold in the measured cell becomes a re-raise the validator admits; nothing else moves', () => {
    for (const [variant, n] of [
      ['plo5', 5],
      ['plo4', 4],
    ] as const) {
      const rnd = mulberry32(20261122 + n);
      let raised = 0;
      let kept = 0;
      for (let k = 0; k < 140; k++) {
        const hole = randomHole(rnd, n, k % 5 === 4 ? [] : cards('AsAh'));
        const shape: Shape = { ...SHAPES[k % SHAPES.length]!, variant, lightning: k % 4 === 3 };
        const off = decide(hole, shape, FLATS, 5500 + k);
        const on = decide(hole, shape, { ...FLATS, ...ACES_ON }, 5500 + k);
        const spot = omahaReraiseMeasuredSpot(off.hero, off.gs);
        if (
          (off.d.action === 'call' || off.d.action === 'fold') &&
          spot !== null &&
          omahaAcesReraiseCell(spot, off.d.action)
        ) {
          raised++;
          expect(['raise', 'all_in']).toContain(on.d.action);
          expect(on.fires).toContain('omaha_aces_measured_reraise');
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
          expect(on.fires).not.toContain('omaha_aces_measured_reraise');
        }
      }
      expect(raised).toBeGreaterThan(0);
      expect(kept).toBeGreaterThan(0);
    }
  });
  it('the range: every call of kings in the measured cell becomes a re-raise the validator admits; nothing else moves', () => {
    const rnd = mulberry32(20261123);
    let raised = 0;
    let kept = 0;
    for (let k = 0; k < 160; k++) {
      const hole = k % 4 === 3 ? randomHole(rnd, 5) : randomHole(rnd, 5, cards('KsKh'));
      const shape: Shape = { ...SHAPES[k % SHAPES.length]!, lightning: k % 5 === 4 };
      const off = decide(hole, shape, FLATS, 5700 + k);
      const on = decide(hole, shape, { ...FLATS, ...RANGE_ON }, 5700 + k);
      const spot = omahaReraiseMeasuredSpot(off.hero, off.gs);
      if (off.d.action === 'call' && spot !== null && omahaReraiseRangeCell(spot)) {
        raised++;
        expect(['raise', 'all_in']).toContain(on.d.action);
        expect(on.fires).toContain('omaha_range_measured_reraise');
        expect(
          horseDecisionReceiptRefusal(structuredClone(on.d), 'plo5', {
            player: on.hero,
            gameState: on.gs,
          })
        ).toBeNull();
      } else {
        kept++;
        expect(bytesOf(on.d)).toBe(bytesOf(off.d));
        expect(on.next).toBe(off.next);
        expect(on.fires).not.toContain('omaha_range_measured_reraise');
      }
    }
    expect(raised).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });
  it('PLO6 is byte-identical with both options on (owner 2026-11-19 8:27 PM: PLO6 is not touched)', () => {
    const rnd = mulberry32(626);
    for (let k = 0; k < 70; k++) {
      const hole = randomHole(rnd, 6, k % 2 ? cards('AsAh') : cards('KsKh'));
      const shape: Shape = { ...SHAPES[k % SHAPES.length]!, variant: 'plo6' };
      const off = decide(hole, shape, FLATS, 6500 + k);
      const on = decide(hole, shape, { ...FLATS, ...ACES_ON, ...RANGE_ON }, 6500 + k);
      expect(bytesOf(on.d)).toBe(bytesOf(off.d));
      expect(on.next).toBe(off.next);
      expect(on.fires).not.toContain('omaha_aces_measured_reraise');
      expect(on.fires).not.toContain('omaha_range_measured_reraise');
    }
  });
  it('a tournament is byte-identical with both options on', () => {
    const rnd = mulberry32(727);
    for (let k = 0; k < 42; k++) {
      const hole = randomHole(rnd, 5, k % 2 ? cards('AsAh') : cards('KsKh'));
      const shape: Shape = { ...SHAPES[k % SHAPES.length]!, gameMode: 'tournament' };
      const off = decide(hole, shape, FLATS, 7500 + k);
      const on = decide(hole, shape, { ...FLATS, ...ACES_ON, ...RANGE_ON }, 7500 + k);
      expect(bytesOf(on.d)).toBe(bytesOf(off.d));
      expect(on.next).toBe(off.next);
    }
  });
});
