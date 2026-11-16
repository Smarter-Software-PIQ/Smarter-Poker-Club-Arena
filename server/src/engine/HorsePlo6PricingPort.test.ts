/**
 * PLO6 six-card port of three pricing rules (SPEC-B 3.21, SPEC-A 3.12, 3.13):
 * omahaUnderpairFlopCell, omahaFacingBetEv (river only, M1 guard) and
 * omahaRiverMediumBetStrongHandCalls (M1 beaten bars). Every case is read
 * with the PLO6 game scope off (nothing acts) and on.
 */
import { describe, expect, it } from 'vitest';
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { withOmahaStrategyGameScope } from './HorseOmahaStrategyGame.js';
import { omahaUnderpairFlopCell, type OmahaUnderpairFlopInput } from './HorseOmahaUnderpair.js';
import {
  omahaRiverHoldsShare,
  omahaRiverMediumBetCall,
  omahaRiverMediumBetSpot,
} from './HorseOmahaRiverMediumBetCalls.js';
import {
  omahaEvHandCounts,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import {
  plo6BoardFlushPossible,
  plo6BoardPaired,
  plo6EvFoldStands,
  plo6MediumBetPriced,
  plo6PricingExcludes,
} from './HorsePlo6PricingPort.js';
import { PLO6_OMAHA_STRATEGY_CONSTANTS } from './HorsePlo6StrategyCalibration.js';

const SUIT: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const cs = (t: string): Card[] =>
  t.split(' ').map((x) => ({ rank: x[0], suit: SUIT[x[1]] }) as unknown as Card);
const gateOn = <T>(fn: () => T): T => withOmahaStrategyGameScope({ plo6: true }, fn);
const gateOff = <T>(fn: () => T): T => withOmahaStrategyGameScope({ plo6: false }, fn);

/** A heads-up river: the villain (seat 2) opens `bet` into `potBefore`; the Horse (seat 1) to act. */
function river(
  hole: string,
  board: string,
  o: { bet?: number; potBefore?: number; variant?: string; stage?: string; more?: object } = {}
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const bet = o.bet ?? 50;
  const potBefore = o.potBefore ?? 100;
  const stage = o.stage ?? 'river';
  const hero = {
    seat: 1,
    user_id: 'hero',
    cards: cs(hole),
    bet: 0,
    stack: 1000,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const villain = {
    seat: 2,
    user_id: 'villain',
    cards: [],
    bet,
    stack: 1000,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const gs = {
    gameVariant: o.variant ?? 'plo6',
    gameMode: 'cash',
    stage,
    communityCards: cs(board),
    pot: potBefore + bet,
    currentBet: bet,
    toCall: bet,
    bigBlind: 2,
    dealerSeat: 1,
    players: [hero, villain],
    actionHistory: [{ seat: 2, action: 'bet', amount: bet, stage }],
    legalActions: ['fold', 'call', 'raise'],
    ...(o.more ?? {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

// Exact beaten shares of these hands (omahaRiverHoldsShare): the comments give them.
const K_STRAIGHT = ['Kh 9d 7c 6s 2h 2d', 'Qs Jh Tc 4d 3s'] as const; // unpaired, no flush: 0.168
const TOP_SET_DRY = ['Kh Kd 7c 8s Jh Td', 'Ks 9h 5c 3d 2s'] as const; // unpaired, no flush: 0.342
const Q_FLUSH = ['Qh 9h 7c 6s 2c Kd', 'Ah Jh 4h 3s 8d'] as const; // flush possible: 0.094
const T_FLUSH = ['Th 9h 7c 6s 2c Kd', 'Ah Jh 4h 3s 8d'] as const; // flush possible: 0.169
const TRIPS_PAIRED = ['Jd 9s 7c 6s 2h Kd', 'Jh Jc 4d 3s 8h'] as const; // paired: 0.262
const BOAT_PAIRED = ['Jd 4s 7c 6s 2h Kd', 'Jh Jc 4d 3s 8h'] as const; // paired: 0.049
const beaten = (h: readonly [string, string]) => 1 - omahaRiverHoldsShare(cs(h[0]), cs(h[1]))!;

describe('PLO6 port: omahaUnderpairNoMultiwayFlopContinue (SPEC-B 3.21, H28)', () => {
  // One pocket pair under the top card, no flush draw, a gutshot at most.
  const cell = (over: Partial<OmahaUnderpairFlopInput> = {}): OmahaUnderpairFlopInput => ({
    variant: 'plo6',
    street: 'flop',
    hole: cs('7h 7d Ks 2c 3d Qc'),
    board: cs('Ah 9s 4c'),
    action: 'call',
    toCall: 50,
    stack: 1000,
    pot: 150,
    betAndCall: true,
    hiLo: false,
    multiBoard: false,
    bombPot: false,
    tournament: false,
    allInOrFold: false,
    ...over,
  });
  it('gate off: the cell is silent for six cards', () => {
    expect(gateOff(() => omahaUnderpairFlopCell(cell()))).toBeNull();
    expect(omahaUnderpairFlopCell(cell())).toBeNull();
  });
  it('gate on: folds at price 0.25, keeps the call under 0.10 (PLO5 values, kept)', () => {
    const fold = gateOn(() => omahaUnderpairFlopCell(cell()))!;
    expect(fold.fold).toBe(true);
    expect(fold.price).toBeCloseTo(0.25, 10);
    const kept = gateOn(() => omahaUnderpairFlopCell(cell({ toCall: 10, pot: 110 })))!;
    expect(kept.fold).toBe(false);
  });
  it('gate on: heads-up, a tournament, or five cards under a plo6 name stay untouched', () => {
    expect(gateOn(() => omahaUnderpairFlopCell(cell({ betAndCall: false })))).toBeNull();
    expect(gateOn(() => omahaUnderpairFlopCell(cell({ tournament: true })))).toBeNull();
    expect(gateOn(() => omahaUnderpairFlopCell(cell({ hole: cs('7h 7d Ks 2c 3d') })))).toBeNull();
  });
  it('PLO4 and PLO5 read the same with the gate on or off', () => {
    for (const [variant, hole] of [
      ['plo4', '7h 7d Ks 2c'],
      ['plo5', '7h 7d Ks 2c 3d'],
    ] as const) {
      const off = gateOff(() => omahaUnderpairFlopCell(cell({ variant, hole: cs(hole) })));
      const on = gateOn(() => omahaUnderpairFlopCell(cell({ variant, hole: cs(hole) })));
      expect(off).not.toBeNull();
      expect(on).toEqual(off);
    }
    // six cards under a plo5 name: refused as before
    expect(gateOn(() => omahaUnderpairFlopCell(cell({ variant: 'plo5' })))).toBeNull();
  });
});

describe('PLO6 port: the board reads and the calibration bars', () => {
  it('paired and flush-possible are read from the board alone', () => {
    expect(plo6BoardPaired(cs(BOAT_PAIRED[1]))).toBe(true);
    expect(plo6BoardPaired(cs(K_STRAIGHT[1]))).toBe(false);
    expect(plo6BoardFlushPossible(cs(Q_FLUSH[1]))).toBe(true);
    expect(plo6BoardFlushPossible(cs(K_STRAIGHT[1]))).toBe(false);
  });
  it('the bars are the calibration entries, not numbers of this file', () => {
    const bars = PLO6_OMAHA_STRATEGY_CONSTANTS.OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR.value as {
      pairedBeatenBelow: number;
      unpairedNoFlushBeatenBelow: number;
      unpairedFlushPossibleBeatenBelow: number;
    };
    const paired = cs(BOAT_PAIRED[1]);
    const dry = cs(K_STRAIGHT[1]);
    const suited = cs(Q_FLUSH[1]);
    const eps = 1e-9;
    expect(plo6MediumBetPriced(1 - (bars.pairedBeatenBelow - eps), paired, 0.25)).toBe(true);
    expect(plo6MediumBetPriced(1 - bars.pairedBeatenBelow, paired, 0.25)).toBe(false);
    expect(plo6MediumBetPriced(1 - (bars.unpairedNoFlushBeatenBelow - eps), dry, 0.25)).toBe(true);
    expect(plo6MediumBetPriced(1 - bars.unpairedNoFlushBeatenBelow, dry, 0.25)).toBe(false);
    expect(
      plo6MediumBetPriced(1 - (bars.unpairedFlushPossibleBeatenBelow - eps), suited, 0.25)
    ).toBe(true);
    expect(plo6MediumBetPriced(1 - bars.unpairedFlushPossibleBeatenBelow, suited, 0.25)).toBe(
      false
    );
    expect(plo6MediumBetPriced(Number.NaN, dry, 0.25)).toBe(false);
    expect(plo6MediumBetPriced(0.99, cs('Qs Jh Tc 4d'), 0.25)).toBe(false);
    const fold = PLO6_OMAHA_STRATEGY_CONSTANTS.PLO6_RIVER_FOLD_BEAT_PROB.value as number;
    const foldUnpaired = PLO6_OMAHA_STRATEGY_CONSTANTS.PLO6_RIVER_UNPAIRED_FOLD_BEAT_PROB
      .value as number;
    const cheap = PLO6_OMAHA_STRATEGY_CONSTANTS.PLO6_RIVER_CHEAP_PRICE.value as number;
    expect(plo6EvFoldStands(fold, paired, 0.25)).toBe(true);
    expect(plo6EvFoldStands(fold - eps, paired, 0.25)).toBe(false);
    expect(plo6EvFoldStands(fold, dry, 0.25)).toBe(false);
    expect(plo6EvFoldStands(foldUnpaired, dry, 0.25)).toBe(true);
    expect(plo6EvFoldStands(foldUnpaired, dry, cheap)).toBe(false);
    expect(plo6EvFoldStands(0.01, cs('Qs Jh Tc 4d'), 0.25)).toBe(true);
  });
  it('a tournament or a bomb pot is outside the PLO6 pricing port', () => {
    const { gs } = river(K_STRAIGHT[0], K_STRAIGHT[1]);
    expect(plo6PricingExcludes(gs)).toBe(false);
    expect(plo6PricingExcludes({ ...gs, gameMode: 'tournament' } as never)).toBe(true);
    expect(plo6PricingExcludes({ ...gs, bombPot: true } as never)).toBe(true);
  });
});

describe('PLO6 port: omahaRiverHoldsShare and omahaEvHandCounts count six cards', () => {
  it('the six-card share equals a brute count on a short deck', () => {
    const hole = cs(K_STRAIGHT[0]);
    const board = cs(K_STRAIGHT[1]);
    const deck: Card[] = [];
    for (const suit of Object.values(SUIT))
      for (const rank of '23456789TJQKA') deck.push({ rank, suit } as unknown as Card);
    const k = (c: Card) => `${c.rank}:${c.suit}`;
    const used = new Set([...hole, ...board].map(k));
    const free = deck.filter((c) => !used.has(k(c)));
    // 13 live cards (an ace-king among them, the hand that beats the straight); the rest dead.
    const live = [
      ...cs('As Ks Ad Kc'),
      ...free.filter((c) => !['A', 'K'].includes(String(c.rank))).slice(0, 9),
    ];
    const liveKeys = new Set(live.map(k));
    const dead = free.filter((c) => !liveKeys.has(k(c)));
    const share = omahaRiverHoldsShare(hole, board, dead)!;
    let total = 0;
    let clean = 0;
    // brute: a holding beats the hand when it holds an ace and a king
    const pick = (start: number, left: number, aces: number, kings: number): void => {
      if (left === 0) {
        total++;
        if (!(aces > 0 && kings > 0)) clean++;
        return;
      }
      for (let i = start; i <= live.length - left; i++)
        pick(
          i + 1,
          left - 1,
          aces + (live[i].rank === 'A' ? 1 : 0),
          kings + (live[i].rank === 'K' ? 1 : 0)
        );
    };
    pick(0, 6, 0, 0);
    expect(total).toBe(1716);
    expect(share).toBeCloseTo(clean / total, 12);
  });
  it('the EV count agrees with it on the river and refuses a six-card turn', () => {
    for (const h of [K_STRAIGHT, TOP_SET_DRY, Q_FLUSH, TRIPS_PAIRED, BOAT_PAIRED]) {
      const counts = omahaEvHandCounts(cs(h[0]), cs(h[1]), [], 0.3)!;
      expect(counts.all.win + counts.all.tie).toBeCloseTo(1 - beaten(h), 10);
    }
    expect(omahaEvHandCounts(cs(K_STRAIGHT[0]), cs('Qs Jh Tc 4d'), [], 0.3)).toBeNull();
    // five cards on the turn: counted as before
    expect(omahaEvHandCounts(cs('Kh 9d 7c 6s 2h'), cs('Qs Jh Tc 4d'), [], 0.3)).not.toBeNull();
  });
  it('the recorded beaten shares', () => {
    expect(beaten(K_STRAIGHT)).toBeCloseTo(0.1681, 3);
    expect(beaten(TOP_SET_DRY)).toBeCloseTo(0.3423, 3);
    expect(beaten(Q_FLUSH)).toBeCloseTo(0.0936, 3);
    expect(beaten(T_FLUSH)).toBeCloseTo(0.1688, 3);
    expect(beaten(TRIPS_PAIRED)).toBeCloseTo(0.2623, 3);
    expect(beaten(BOAT_PAIRED)).toBeCloseTo(0.0494, 3);
  });
});

describe('PLO6 port: omahaRiverMediumBetStrongHandCalls (SPEC-A 3.13)', () => {
  const spotOf = (h: readonly [string, string], o = {}) => {
    const { hero, gs } = river(h[0], h[1], o);
    return { hero, gs, on: gateOn(() => omahaRiverMediumBetSpot(hero, gs)) };
  };
  it('gate off: no spot, and a fold stays a fold', () => {
    const { hero, gs } = river(K_STRAIGHT[0], K_STRAIGHT[1]);
    expect(gateOff(() => omahaRiverMediumBetSpot(hero, gs))).toBeNull();
    expect(omahaRiverMediumBetSpot(hero, gs)).toBeNull();
    const fold = { action: 'fold' } as never;
    expect(omahaRiverMediumBetCall(fold, hero, gs, true)).toEqual({
      decision: fold,
      changed: null,
      spot: null,
    });
  });
  it('gate on: the M1 bars decide, by board class', () => {
    // unpaired, no flush possible: under 0.30
    expect(spotOf(K_STRAIGHT).on!.priced).toBe(true);
    expect(spotOf(TOP_SET_DRY).on!.priced).toBe(false);
    // unpaired, a flush possible: under 0.15 (0.169 would pass the 0.30 line)
    expect(spotOf(Q_FLUSH).on!.priced).toBe(true);
    expect(spotOf(T_FLUSH).on!.priced).toBe(false);
    // paired: under 0.15
    expect(spotOf(BOAT_PAIRED).on!.priced).toBe(true);
    expect(spotOf(TRIPS_PAIRED).on!.priced).toBe(false);
  });
  it('gate on: the PLO5 class (1.5 x the price) is not what decides', () => {
    // 0.262 beaten holds 0.738 >= 1.5 x 0.25: the PLO5 line would call; PLO6 does not.
    const s = spotOf(TRIPS_PAIRED).on!;
    expect(s.holds).toBeGreaterThan(1.5 * s.price);
    expect(s.priced).toBe(false);
    const { hero, gs } = river(TRIPS_PAIRED[0], TRIPS_PAIRED[1]);
    const r = gateOn(() => omahaRiverMediumBetCall({ action: 'fold' } as never, hero, gs, true));
    expect(r.changed).toBe('unpriced');
    expect(r.decision.action).toBe('fold');
  });
  it('gate on: a priced fold becomes the call; other sizes, a tournament, a bomb pot stay out', () => {
    const { hero, gs } = river(K_STRAIGHT[0], K_STRAIGHT[1]);
    const r = gateOn(() => omahaRiverMediumBetCall({ action: 'fold' } as never, hero, gs, true));
    expect(r.changed).toBe('called');
    expect(r.decision).toMatchObject({ action: 'call', amount: 50 });
    expect(spotOf(K_STRAIGHT, { bet: 80 }).on).toBeNull();
    expect(spotOf(K_STRAIGHT, { bet: 30 }).on).toBeNull();
    expect(spotOf(K_STRAIGHT, { more: { gameMode: 'tournament' } }).on).toBeNull();
    expect(spotOf(K_STRAIGHT, { more: { bombPot: true } }).on).toBeNull();
  });
  it('PLO5: the spot is the same with the gate on or off', () => {
    const { hero, gs } = river('Kh 9d 7c 6s 2h', K_STRAIGHT[1], { variant: 'plo5' });
    const off = gateOff(() => omahaRiverMediumBetSpot(hero, gs));
    expect(off).not.toBeNull();
    expect(gateOn(() => omahaRiverMediumBetSpot(hero, gs))).toEqual(off);
  });
});

describe('PLO6 port: omahaFacingBetEv (SPEC-A 3.12)', () => {
  const verdictOf = (h: readonly [string, string], o = {}) => {
    const { hero, gs } = river(h[0], h[1], o);
    const spot = gateOn(() => omahaFacingBetEvSpot(hero, gs));
    return spot ? omahaFacingBetEvVerdict(spot, cs(h[0]), cs(h[1]), [], null) : null;
  };
  it('gate off: no spot for six cards', () => {
    const { hero, gs } = river(K_STRAIGHT[0], K_STRAIGHT[1]);
    expect(gateOff(() => omahaFacingBetEvSpot(hero, gs))).toBeNull();
    expect(omahaFacingBetEvSpot(hero, gs)).toBeNull();
  });
  it('gate on: the river is covered; the six-card turn, a tournament and a bomb pot are not', () => {
    const { hero, gs } = river(K_STRAIGHT[0], K_STRAIGHT[1]);
    expect(gateOn(() => omahaFacingBetEvSpot(hero, gs))).not.toBeNull();
    const turn = river(K_STRAIGHT[0], 'Qs Jh Tc 4d', { stage: 'turn' });
    expect(gateOn(() => omahaFacingBetEvSpot(turn.hero, turn.gs))).toBeNull();
    const mtt = river(K_STRAIGHT[0], K_STRAIGHT[1], { more: { gameMode: 'tournament' } });
    expect(gateOn(() => omahaFacingBetEvSpot(mtt.hero, mtt.gs))).toBeNull();
    const bomb = river(K_STRAIGHT[0], K_STRAIGHT[1], { more: { bombPot: true } });
    expect(gateOn(() => omahaFacingBetEvSpot(bomb.hero, bomb.gs))).toBeNull();
  });
  it('gate on: a hand almost never beaten calls; no guard', () => {
    const v = verdictOf(BOAT_PAIRED)!;
    expect(v.call).toBe(true);
    expect(v.plo6FoldStands).toBeUndefined();
  });
  it('gate on: where the M1 fold test holds the verdict is never a call', () => {
    // paired board, beaten 0.262 >= 0.15, price 0.25 > 0.10
    const paired = verdictOf(TRIPS_PAIRED)!;
    expect(paired.plo6FoldStands).toBe(true);
    expect(paired.call).toBe(false);
    // unpaired, beaten 0.342 >= 0.30
    const dry = verdictOf(TOP_SET_DRY)!;
    expect(dry.plo6FoldStands).toBe(true);
    expect(dry.call).toBe(false);
    // unpaired, beaten 0.168 < 0.30: the EV decides
    expect(verdictOf(K_STRAIGHT)!.plo6FoldStands).toBeUndefined();
  });
  it('gate on: at a price of 0.10 or less the guard is off and the EV decides', () => {
    // 10 into 100: price 10 / 120
    const cheap = verdictOf(TRIPS_PAIRED, { bet: 10 })!;
    expect(cheap.price).toBeLessThanOrEqual(0.1);
    expect(cheap.plo6FoldStands).toBeUndefined();
    expect(cheap.call).toBe(cheap.ev > cheap.margin);
  });
  it('PLO5: the turn and river spots and verdicts are the same with the gate on or off', () => {
    for (const [board, stage] of [
      [K_STRAIGHT[1], 'river'],
      ['Qs Jh Tc 4d', 'turn'],
    ] as const) {
      const { hero, gs } = river('Kh 9d 7c 6s 2h', board, { variant: 'plo5', stage });
      const off = gateOff(() => omahaFacingBetEvSpot(hero, gs));
      expect(off).not.toBeNull();
      expect(gateOn(() => omahaFacingBetEvSpot(hero, gs))).toEqual(off);
      const v = omahaFacingBetEvVerdict(off!, hero.cards as Card[], cs(board), [], null)!;
      expect(v.plo6FoldStands).toBeUndefined();
      expect(v.call).toBe(v.ev > v.margin);
    }
  });
});
