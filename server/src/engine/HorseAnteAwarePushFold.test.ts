/**
 * V71 ANTE-AWARE PUSH/FOLD (2026-10-31). The folded-to Hold'em jam at
 * <= 15bb in a tournament with an ante in the pot reads the chip-EV Nash
 * jam-or-fold table by dealt-in players behind and dead ante, with or
 * without the solver charts; an ante-free pot is untouched.
 * End-to-end numbers go through HorseLogic.decide on an unopened pot folded
 * to the seat, combo-weighted over the 169 classes (charts NOT hydrated, so
 * the off arm is the offline fallback this replaces). See
 * docs/changelog/2026-10-31-v71-ante-aware-push-fold.md.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import {
  V71_PUSH_FOLD_MAX_BB,
  nashJamProbability,
  nashJamUpTo,
  nashJamWidth,
  nashSolvedWidth,
} from './HorseAnteAwarePushFold.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
const SEEDS = 3;

type Ctx = { seats: number; stackBB: number; mode: 'cash' | 'tournament'; ante: boolean };

function holeFor(cls: string, s: number): Card[] {
  const su = (s * 3) % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}

function decideOpen(
  ctx: Ctx,
  posIdx: number,
  cls: string,
  seed: number,
  opts: Record<string, unknown>,
  humans = false
): string {
  const n = ctx.seats;
  const hu = n === 2;
  const sbSeat = hu ? 2 : 1;
  const bbSeat = hu ? 1 : 2;
  const order = hu ? [2] : [...Array(n - 2).keys()].map((k) => 3 + k).concat([1]);
  const heroSeat = order[posIdx];
  const hole = holeFor(cls, seed);
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const ante = ctx.ante ? 2 : 0;
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= n; seat++) {
    const bet = seat === sbSeat ? 1 : seat === bbSeat ? 2 : 0;
    players.push({
      seat,
      user_id: `pf-${seat}`,
      username: `Pf${seat}`,
      stack: ctx.stackBB * BB - bet - (seat === bbSeat ? ante : 0),
      bet,
      totalInvested: bet + (seat === bbSeat ? ante : 0),
      cards: seat === heroSeat ? hole : [deck[seat * 2], deck[seat * 2 + 1]],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: !humans,
    } as SeatPlayer);
  }
  const history: ActionRecord[] = [];
  let ts = 100;
  for (const seat of order.concat([bbSeat])) {
    if (seat === heroSeat) break;
    players[seat - 1].is_folded = true;
    history.push({
      seat,
      userId: `pf-${seat}`,
      action: 'fold',
      amount: 0,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord);
  }
  const gs = {
    players,
    communityCards: [],
    pot: 3 + ante,
    currentBet: 2,
    minRaise: 2,
    lastRaise: 2,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat: hu ? 2 : n,
    actionHistory: history,
    gameMode: ctx.mode,
    ante,
    bigBlindAnte: ctx.ante,
    format: ctx.mode === 'cash' ? 'cash' : hu ? 'hu_sng' : 'mtt',
    ...(ctx.mode === 'tournament'
      ? {
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: n <= 3 ? n : 180,
            spotsPaid: n <= 3 ? 1 : 30,
            entrants: n <= 3 ? n : 300,
            avgStackChips: ctx.stackBB * BB,
            medianStackChips: ctx.stackBB * BB,
            seatsPerTable: n,
            playersAtTable: n,
            nearBubble: false,
            inMoney: false,
            payoutPct: n <= 3 ? [100] : [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            currentSmallBlind: 1,
            currentBigBlind: 2,
            currentAnte: ante,
            anteType: ctx.ante ? 'big_blind' : 'none',
            nextSmallBlind: 2,
            nextBigBlind: 4,
            nextAnte: ante * 2,
            nextBlindInMin: 10,
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  seedFastRandom(seed * 7919 + posIdx * 104729 + cls.charCodeAt(0) * 31 + cls.length);
  const d = HorseLogic.decide(players[heroSeat - 1], gs, 'balanced', {}, {
    mind: false,
    telemetry: false,
    ...opts,
  } as never);
  return d.action === 'all_in' ? 'jam' : d.action;
}

const cache = new Map<string, Map<string, string[]>>();
function seat(ctx: Ctx, posIdx: number, opts: Record<string, unknown> = {}, humans = false) {
  const key = JSON.stringify([ctx, posIdx, opts, humans]);
  const hit = cache.get(key);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  for (const h of HAND_CLASSES) {
    const acts: string[] = [];
    for (let s = 0; s < SEEDS; s++) acts.push(decideOpen(ctx, posIdx, h.cls, s + 1, opts, humans));
    out.set(h.cls, acts);
  }
  cache.set(key, out);
  return out;
}

function jamShare(cells: Map<string, string[]>): number {
  let w = 0;
  for (const h of HAND_CLASSES) {
    const a = cells.get(h.cls)!;
    w += (a.filter((x) => x === 'jam').length / a.length) * h.combos;
  }
  return (100 * w) / 1326;
}

const OFF = { v71AnteAwarePushFold: false };
const MTT9_15A: Ctx = { seats: 9, stackBB: 15, mode: 'tournament', ante: true };
const MTT9_15N: Ctx = { seats: 9, stackBB: 15, mode: 'tournament', ante: false };
const HU10A: Ctx = { seats: 2, stackBB: 10, mode: 'tournament', ante: true };
const HU10N: Ctx = { seats: 2, stackBB: 10, mode: 'tournament', ante: false };

describe('the Nash push/fold table', () => {
  it('reproduces the no-ante solver charts it replaces', () => {
    // memory_charts_gold (2026-10-31): BTN 15bb 26.6, CO 15bb 18.6, SB 10bb 58.3, SB 15bb 45.6.
    expect(nashSolvedWidth(2, 15, 0)).toBeGreaterThan(25.5);
    expect(nashSolvedWidth(2, 15, 0)).toBeLessThan(28.5);
    expect(nashSolvedWidth(3, 15, 0)).toBeGreaterThan(17);
    expect(nashSolvedWidth(3, 15, 0)).toBeLessThan(20);
    expect(nashSolvedWidth(1, 10, 0)).toBeGreaterThan(57);
    expect(nashSolvedWidth(1, 10, 0)).toBeLessThan(60);
    expect(nashSolvedWidth(1, 15, 0)).toBeGreaterThan(44.5);
    expect(nashSolvedWidth(1, 15, 0)).toBeLessThan(47);
  });

  it('the ante widens every seat at every push/fold depth, and fewer behind jams wider', () => {
    for (const depth of [5, 8, 10, 12, 15]) {
      let prevNa = Infinity;
      let prevA = Infinity;
      for (let behind = 1; behind <= 8; behind++) {
        const na = nashJamWidth(behind, depth, 0);
        const a = nashJamWidth(behind, depth, 1);
        expect(a, `behind ${behind} at ${depth}bb`).toBeGreaterThan(na + 2);
        expect(na, `no ante behind ${behind} at ${depth}bb`).toBeLessThan(prevNa);
        expect(a, `ante behind ${behind} at ${depth}bb`).toBeLessThan(prevA);
        prevNa = na;
        prevA = a;
      }
    }
  });

  it('jams premium hands at every depth and seat, never 72o first in with eight behind', () => {
    for (const ante of [0, 1, 2])
      for (let behind = 1; behind <= 8; behind++) {
        expect(nashJamUpTo('AA', behind, ante)).toBeGreaterThanOrEqual(V71_PUSH_FOLD_MAX_BB);
        expect(nashJamUpTo('AKs', behind, ante)).toBeGreaterThanOrEqual(V71_PUSH_FOLD_MAX_BB);
      }
    expect(nashJamProbability({ hand: '72o', behind: 8, depthBB: 10, anteBB: 1 })).toBe(0);
    expect(nashJamProbability({ hand: 'XYo', behind: 2, depthBB: 10, anteBB: 1 })).toBeNull();
  });

  it('interpolates the ante and mixes inside the half-blind grid gap', () => {
    const w0 = nashJamWidth(2, 12, 0);
    const w1 = nashJamWidth(2, 12, 1);
    const wHalf = nashJamWidth(2, 12, 0.5);
    expect(wHalf).toBeGreaterThan(w0);
    expect(wHalf).toBeLessThan(w1);
    const t = nashJamUpTo('K9o', 2, 1)!;
    expect(nashJamProbability({ hand: 'K9o', behind: 2, depthBB: t, anteBB: 1 })).toBe(1);
    expect(nashJamProbability({ hand: 'K9o', behind: 2, depthBB: t + 0.25, anteBB: 1 })).toBe(0.5);
    expect(nashJamProbability({ hand: 'K9o', behind: 2, depthBB: t + 0.5, anteBB: 1 })).toBe(0);
  });
});

describe('V71 end to end (HorseLogic.decide, charts not hydrated)', () => {
  // posIdx for 9-handed: 0 UTG, 1 UTG+1, 2 UTG+2, 3 LJ, 4 HJ, 5 CO, 6 BTN, 7 SB.
  const BANDS_15A: [number, number, number][] = [
    [0, 7, 10.5],
    [3, 14.5, 18.5],
    [4, 20.5, 25],
    [5, 26.5, 31],
    [6, 33.5, 38.5],
    [7, 58, 68],
  ];
  it.each(BANDS_15A)('9-handed 15bb with a BB ante: seat %i jams %f-%f%%', (pos, lo, hi) => {
    const w = jamShare(seat(MTT9_15A, pos));
    expect(w).toBeGreaterThanOrEqual(lo);
    expect(w).toBeLessThanOrEqual(hi);
  });

  it('without an ante nothing changes: the no-ante charts and fallback still decide', () => {
    // Against the human-calibrated field the no-ante Nash answer ran
    // -3.56 +/- 1.63 bb/100 at 15bb (V71 changelog), and the charts already
    // are the no-ante game, so V71 stays out of an ante-free pot.
    for (const pos of [0, 4, 6, 7]) {
      const on = seat(MTT9_15N, pos);
      const off = seat(MTT9_15N, pos, OFF);
      for (const h of HAND_CLASSES)
        expect(on.get(h.cls), `${pos} ${h.cls}`).toEqual(off.get(h.cls));
    }
    expect(jamShare(seat(MTT9_15A, 6))).toBeGreaterThan(nashJamWidth(2, 15, 0) + 6);
  });

  it('the off arm keeps the old fallback: the BTN and SB jam the same narrow range with a BB ante', () => {
    const btnOff = jamShare(seat(MTT9_15A, 6, OFF));
    const sbOff = jamShare(seat(MTT9_15A, 7, OFF));
    expect(btnOff).toBeLessThan(25);
    expect(sbOff).toBeLessThan(25);
    expect(jamShare(seat(MTT9_15A, 7))).toBeGreaterThan(sbOff + 30);
  });

  it('heads-up 10bb with a BB ante: the small blind jams ~71-75% (the old fallback 37%)', () => {
    const a = jamShare(seat(HU10A, 0));
    expect(a).toBeGreaterThan(69);
    expect(a).toBeLessThan(77);
    expect(jamShare(seat(HU10A, 0, OFF))).toBeLessThan(45);
    const on = seat(HU10N, 0);
    const off = seat(HU10N, 0, OFF);
    for (const h of HAND_CLASSES) expect(on.get(h.cls), h.cls).toEqual(off.get(h.cls));
  });

  it('a 16bb stack and a no-ante cash stack decide exactly as before', () => {
    const deeper: Ctx = { seats: 9, stackBB: 16, mode: 'tournament', ante: true };
    const cash: Ctx = { seats: 6, stackBB: 12, mode: 'cash', ante: false };
    for (const [ctx, pos] of [
      [deeper, 6],
      [deeper, 0],
      [cash, 3],
    ] as const) {
      const on = seat(ctx, pos);
      const off = seat(ctx, pos, OFF);
      for (const h of HAND_CLASSES) expect(on.get(h.cls), `${h.cls}`).toEqual(off.get(h.cls));
    }
  });

  it('reads no identity: an all-human table gets the same jams as an all-horse table', () => {
    const horses = seat(MTT9_15A, 5);
    const humans = seat(MTT9_15A, 5, {}, true);
    for (const h of HAND_CLASSES) expect(humans.get(h.cls), h.cls).toEqual(horses.get(h.cls));
  });
});
