/**
 * THE BIG BLIND'S FOLD SHARE HAS NO UNEXPLAINED CLIFF AND NEVER DEFENDS MORE
 * AGAINST A BIGGER OPEN (2026-11-13, heads-up lane, HU-NLH-001 Phase 2).
 *
 * HU-NLH-001 was a step at exactly 50bb: heads-up, the cash big blind folds
 * 58.7% to a 2bb, 2.5bb, 3bb or 4bb open alike from 15bb to 50bb and 39.6% to
 * a 2bb open at 52bb, because V85 widens cash above V85_DEPTH_NONE_BB only and
 * a two-dealt table never reaches the per-seat defence. Nothing looked across
 * depth and price, so it shipped. This law sweeps the real HorseLogic.decide
 * (live cash Hybrid persona, live default flags, reads off) over 2, 3 and 6
 * dealt, 15-150bb and 2-4bb opens, and holds three things:
 *
 *  1. PRICE: at every depth the fold share does not fall as the open grows
 *     (equal is allowed; a tolerance covers mixed-strategy sampling).
 *  2. DEPTH: between neighbouring depths the fold share moves at most
 *     MAX_POINTS_PER_BB per big blind of depth, except at a boundary named in
 *     ATTRIBUTED_CLIFFS with the source constant that causes it.
 *  3. PRICE-BLIND CELLS: a depth where a 4bb open is folded to no more than a
 *     2bb open must be named in KNOWN_PRICE_BLIND.
 *
 * Both lists hold today's open defect (HU-NLH-001) and may only shrink: an
 * entry that no longer reproduces fails the law until it is removed, so the
 * fix deletes its own exemption. A new entry needs measured evidence in the
 * pull request; this law does not freeze any frequency.
 *
 * The candidate fix (huBbDefendsToPrice, default OFF, not promoted) is held
 * to its own contract: price-sensitive inside 20-50bb, identical to live
 * outside its stack band.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
function holeFor(cls: string, s: number): Card[] {
  const su = s % 4;
  const suited = cls.length === 3 && cls[2] === 's';
  const s2 = suited ? su : (su + 1 + (s % 3)) % 4;
  return [{ rank: cls[0], suit: SUITS[su] } as Card, { rank: cls[1], suit: SUITS[s2] } as Card];
}
type Spot = { seats: number; openBB: number; stackBB: number; mode: 'cash' | 'tournament' };
function stateFor(spot: Spot, hole: Card[]) {
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const n = spot.seats;
  const openTo = spot.openBB * BB;
  const opener = n === 2 ? 1 : n;
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= n; seat++) {
    const blind = seat === 1 ? 1 : seat === 2 ? 2 : 0;
    const bet = seat === opener ? openTo : blind;
    players.push({
      seat,
      user_id: `p-${seat}`,
      username: `P${seat}`,
      stack: spot.stackBB * BB - bet,
      bet,
      totalInvested: bet,
      cards: seat === 2 ? hole : [deck[seat * 2], deck[seat * 2 + 1]],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
  }
  const history: ActionRecord[] = [];
  let ts = 100;
  const order: number[] = [];
  for (let s = 3; s <= n; s++) order.push(s);
  order.push(1);
  for (const seat of n === 2 ? [1] : order) {
    const p = players[seat - 1];
    if (seat === opener) {
      history.push({
        seat,
        userId: p.user_id,
        action: 'raise',
        amount: openTo,
        timestamp: ts++,
        stage: 'preflop',
        isFullRaise: true,
      } as ActionRecord);
      continue;
    }
    p.is_folded = true;
    history.push({
      seat,
      userId: p.user_id,
      action: 'fold',
      amount: 0,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord);
  }
  const gs = {
    players,
    communityCards: [],
    pot: openTo + (opener === 1 ? 2 : 3),
    currentBet: openTo,
    minRaise: openTo - BB,
    lastRaise: openTo - BB,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat: n === 2 ? 1 : n,
    actionHistory: history,
    gameMode: spot.mode,
    ante: 0,
    format: spot.mode === 'cash' ? 'cash' : 'mtt',
    dealtSeatIds: players.map((p) => p.seat),
  } as unknown as HorseGameStateV2;
  return { hero: players[1], gs };
}
const SEEDS = 2;
const DEPTHS = [15, 20, 25, 30, 35, 40, 45, 50, 52, 55, 60, 70, 80, 100, 150];
const OPENS = [2, 2.5, 3, 4];
const TABLES = [2, 3, 6];
/** Sampling tolerance, percentage points of the 1,326 combos. */
const PRICE_TOLERANCE = 1.5;
const MAX_POINTS_PER_BB = 2.5;
const PRICE_BLIND_SPREAD = 3;

/** `${dealt}:${shallower}-${deeper}`: the depth step and the constant behind it. */
const ATTRIBUTED_CLIFFS: Readonly<Record<string, string>> = {
  '2:50-52':
    'V85_DEPTH_NONE_BB (HorseGtoOpeningRanges.ts): V85 widens the cash big blind above 50bb only; at 50bb or less two dealt in fall to the V11 bars. Open defect HU-NLH-001.',
};
/** `${dealt}:${depth}`: depths where the live big blind ignores the open size. HU-NLH-001. */
const KNOWN_PRICE_BLIND = new Set(['2:15', '2:20', '2:25', '2:30', '2:35', '2:40', '2:45', '2:50']);

function foldShare(spot: Spot, extra: Record<string, unknown>): number {
  const hybrid = HORSE_HYBRID_PROFILES.cash;
  let fold = 0;
  let total = 0;
  for (const h of HAND_CLASSES)
    for (let s = 0; s < SEEDS; s++) {
      const { hero, gs } = stateFor(spot, holeFor(h.cls, s));
      seedFastRandom(1 + s * 7919 + h.cls.charCodeAt(0) * 31 + h.cls.charCodeAt(1));
      const d = HorseLogic.decide(
        hero,
        gs,
        hybrid.style,
        { ...hybrid.mods },
        {
          mind: false,
          decisionTimeMs: Date.UTC(2026, 10, 13, 12, 0, 0),
          ...extra,
        }
      );
      if (d.action === 'fold') fold += h.combos;
      total += h.combos;
    }
  return (100 * fold) / total;
}

type Grid = Map<string, number>;
const key = (seats: number, stackBB: number, openBB: number) => `${seats}:${stackBB}:${openBB}`;
function sweep(extra: Record<string, unknown>, tables: readonly number[]): Grid {
  const g: Grid = new Map();
  for (const seats of tables)
    for (const stackBB of DEPTHS)
      for (const openBB of OPENS)
        g.set(
          key(seats, stackBB, openBB),
          foldShare({ seats, stackBB, openBB, mode: 'cash' }, extra)
        );
  return g;
}

describe('the cash big blind across depth and price (live defaults)', () => {
  const live = sweep({}, TABLES);

  it('never folds less to a bigger open', () => {
    const broken: string[] = [];
    for (const seats of TABLES)
      for (const d of DEPTHS)
        for (let i = 1; i < OPENS.length; i++) {
          const small = live.get(key(seats, d, OPENS[i - 1]))!;
          const big = live.get(key(seats, d, OPENS[i]))!;
          if (big < small - PRICE_TOLERANCE)
            broken.push(
              `${seats} dealt ${d}bb: ${OPENS[i - 1]}bb ${small.toFixed(1)}% > ${OPENS[i]}bb ${big.toFixed(1)}%`
            );
        }
    expect(broken).toEqual([]);
  });

  it('has no depth cliff except the ones attributed to a named constant', () => {
    const cliffs = new Set<string>();
    for (const seats of TABLES)
      for (let i = 1; i < DEPTHS.length; i++)
        for (const o of OPENS) {
          const a = live.get(key(seats, DEPTHS[i - 1], o))!;
          const b = live.get(key(seats, DEPTHS[i], o))!;
          if (Math.abs(a - b) / (DEPTHS[i] - DEPTHS[i - 1]) > MAX_POINTS_PER_BB)
            cliffs.add(`${seats}:${DEPTHS[i - 1]}-${DEPTHS[i]}`);
        }
    // Every cliff is attributed, and every attribution still reproduces.
    expect([...cliffs].sort()).toEqual(Object.keys(ATTRIBUTED_CLIFFS).sort());
  });

  it('reads the price everywhere except the cells named as the open defect', () => {
    const blind = new Set<string>();
    for (const seats of TABLES)
      for (const d of DEPTHS)
        if (live.get(key(seats, d, 4))! - live.get(key(seats, d, 2))! < PRICE_BLIND_SPREAD)
          blind.add(`${seats}:${d}`);
    expect([...blind].sort()).toEqual([...KNOWN_PRICE_BLIND].sort());
  });

  it('three and six dealt give the big blind a price at every depth', () => {
    for (const seats of [3, 6])
      for (const d of DEPTHS)
        expect(live.get(key(seats, d, 4))! - live.get(key(seats, d, 2))!).toBeGreaterThan(
          PRICE_BLIND_SPREAD
        );
  });
});

describe('the candidate huBbDefendsToPrice (default OFF) keeps its contract', () => {
  const live = sweep({}, [2]);
  const on = sweep({ huBbDefendsToPrice: true }, [2]);

  it('is price-sensitive from 20bb to 50bb, where the live big blind is not', () => {
    for (const d of [20, 25, 30, 35, 40, 45, 50]) {
      expect(on.get(key(2, d, 3))! - on.get(key(2, d, 2))!).toBeGreaterThan(10);
      expect(on.get(key(2, d, 4))!).toBeGreaterThan(on.get(key(2, d, 3))!);
    }
  });

  it('only ever turns a fold into a continue, and leaves 15bb (below its band) alone', () => {
    for (const d of DEPTHS)
      for (const o of OPENS)
        expect(on.get(key(2, d, o))!).toBeLessThanOrEqual(live.get(key(2, d, o))! + 1e-9);
    for (const o of OPENS) expect(on.get(key(2, 15, o))).toBe(live.get(key(2, 15, o)));
  });
});
