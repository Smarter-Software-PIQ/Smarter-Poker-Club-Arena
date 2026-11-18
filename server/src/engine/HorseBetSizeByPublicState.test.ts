/**
 * THE SIZE OF A HORSE BET IS PUBLIC INFORMATION ONLY (PLO Strategy lane
 * 2026-11-16, omahaBetSizeByPublicState, default OFF).
 *
 * Property: for a fixed public state, every own bet or raise a Horse makes has
 * the size horsePublicBetSizeTo draws for that public spot, the same for 200
 * different private hands, made hands and draws alike. The bet-or-check and
 * raise-or-call decisions are the engine's (the action is identical with the
 * option off). Unset and false are the shipped brain, byte for byte.
 *
 * The public states are recorded production nodes (PLO5 cash hand 59416584,
 * the fixture the public action time uses): a turn decision first to act and
 * a flop decision facing a bet.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import {
  HORSE_PUBLIC_COMMITMENT_SHARE,
  horsePublicBetFraction,
  horsePublicBetSizeTo,
  horsePublicBoardClass,
  seedHorseBetSizeRandom,
  type HorsePublicBetSizeSpot,
} from './horsePublicBetSize.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';

const FX = SET_LEADS as unknown as ComplaintFixture;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const RANKS = '23456789TJQKA'.split('') as CardRank[];
const SUITS: CardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const key = (c: Card) => `${c.rank}${c.suit[0]}`;

function spot(ord: number, hole?: Card[]) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  const node = fx.actions.find((a) => a.ord === ord)!;
  if (hole) fx.hole[String(node.seat)] = hole;
  return stateAt(fx, node);
}

/** 200 different five-card hands that do not use a board card. */
function hands(ord: number, n = 200): Card[][] {
  const board = new Set(spot(ord).gs.communityCards.map(key));
  const deck: Card[] = [];
  for (const rank of RANKS)
    for (const suit of SUITS) if (!board.has(`${rank}${suit[0]}`)) deck.push({ rank, suit });
  let s = 0x3c6ef372 ^ ord;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const out: Card[][] = [];
  for (let i = 0; i < n; i++) {
    const d = deck.slice();
    for (let j = 0; j < 5; j++) {
      const k = j + Math.floor(next() * (d.length - j));
      [d[j], d[k]] = [d[k], d[j]];
    }
    out.push(d.slice(0, 5));
  }
  return out;
}

const ON = { omahaBetSizeByPublicState: true };
const SIZE_SEEDS = [7, 77, 777, 7777, 77777, 777777];

function decide(s: ReturnType<typeof spot>, opts: Record<string, unknown>, strategySeed: number) {
  seedFastRandom(strategySeed);
  HorseMind.reset();
  return HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, { mind: false, ...opts } as never);
}

/** A decision without its wall-clock stamps (the policy graph times each step). */
const stable = (d: unknown): unknown =>
  JSON.parse(
    JSON.stringify(d, (k, v) => (/^(elapsed|latency|compute)Ms$/.test(k) ? undefined : v))
  );
const wager = (a: string) => a === 'bet' || a === 'raise';

describe.each([
  { name: 'turn, first to act', ord: 18 },
  { name: 'flop, facing a bet', ord: 16 },
])('public-only bet size: $name', ({ ord }) => {
  const HANDS = hands(ord);

  it('the public spot handed to the size is the same for every private hand', () => {
    const first = JSON.stringify(
      HorseLogic.publicBetSizeSpot(spot(ord, HANDS[0]).gs, spot(ord).hero.user_id, 'bet', true)
    );
    for (const hole of HANDS) {
      const s = spot(ord, hole);
      expect(JSON.stringify(HorseLogic.publicBetSizeSpot(s.gs, s.hero.user_id, 'bet', true))).toBe(
        first
      );
    }
  });

  it('200 private hands: one size per public draw; the action is the engine own', () => {
    const bySeed = new Map<string, Set<number>>();
    const offSizes = new Set<number>();
    let wagers = 0;
    HANDS.forEach((hole, i) => {
      const s = spot(ord, hole);
      const seed = SIZE_SEEDS[i % SIZE_SEEDS.length];
      seedHorseBetSizeRandom(seed);
      const on = decide(s, ON, 1000 + i);
      const off = decide(s, {}, 1000 + i);
      // Never turns a check into a bet, a call into a raise, or back; a wager
      // whose public size is every chip is the all-in.
      if (wager(off.action) && on.action === 'all_in') {
        expect(s.hero.bet + s.hero.stack).toBeLessThanOrEqual((s.gs.maxRaiseTo as number) + 0.005);
        const k = `all_in|${seed}`;
        if (!bySeed.has(k)) bySeed.set(k, new Set());
        bySeed.get(k)!.add(-1);
        wagers++;
        return;
      }
      expect(on.action, `hand ${hole.map(key).join('')}`).toBe(off.action);
      if (!wager(on.action)) {
        expect(on.amount).toBe(off.amount);
        return;
      }
      wagers++;
      offSizes.add(off.amount as number);
      const k = `${on.action}|${seed}`;
      if (!bySeed.has(k)) bySeed.set(k, new Set());
      bySeed.get(k)!.add(on.amount as number);
      // The size is the public draw for this spot (a commitment spot keeps the engine's size).
      seedHorseBetSizeRandom(seed);
      const want = horsePublicBetSizeTo(
        HorseLogic.publicBetSizeSpot(s.gs, s.hero.user_id, on.action as 'bet' | 'raise', false)!
      );
      expect(want).not.toBeNull();
      expect(on.amount).toBeGreaterThanOrEqual(s.gs.minRaiseTo as number);
      expect(on.amount).toBeLessThanOrEqual(s.gs.maxRaiseTo as number);
      expect(Math.abs((on.amount as number) - (want as number))).toBeLessThanOrEqual(
        Math.max(0.01, 0.1 * (s.gs.pot as number))
      );
    });
    expect(wagers, 'the property is not vacuous').toBeGreaterThan(0);
    for (const [k, sizes] of bySeed) expect([...sizes], k).toHaveLength(1);
    // Off, the engine's own sizes in the same spot differ by hand (the tell).
    expect(offSizes.size).toBeGreaterThan(1);
  });

  it('the size distribution over the public stream is identical for every hand that wagers', () => {
    const dist = new Map<string, string>();
    HANDS.slice(0, 40).forEach((hole, i) => {
      const s = spot(ord, hole);
      const first = decide(s, {}, 2000 + i);
      if (!wager(first.action)) return;
      const sizes: number[] = [];
      for (let t = 0; t < 30; t++) {
        seedHorseBetSizeRandom(90_000 + t);
        const d = decide(s, ON, 2000 + i);
        sizes.push(d.action === 'all_in' ? -1 : (d.amount as number));
      }
      const k = first.action;
      const v = JSON.stringify(sizes);
      if (!dist.has(k)) dist.set(k, v);
      expect(v, `hand ${hole.map(key).join('')}`).toBe(dist.get(k));
    });
  });

  it('unset and false are the shipped brain, byte for byte', () => {
    HANDS.slice(0, 50).forEach((hole, i) => {
      const s = spot(ord, hole);
      const unset = stable(decide(s, {}, 3000 + i));
      const off = stable(decide(s, { omahaBetSizeByPublicState: false }, 3000 + i));
      const truthy = stable(decide(s, { omahaBetSizeByPublicState: 1 }, 3000 + i));
      expect(off).toEqual(unset);
      expect(truthy).toEqual(unset);
    });
  });

  it('with omahaNutClassValueSize on, a nut-class wager keeps that option size', () => {
    HANDS.forEach((hole, i) => {
      const s = spot(ord, hole);
      if (!omahaNutClassNow(s.hero, s.gs)) return;
      seedHorseBetSizeRandom(5);
      const both = decide(s, { ...ON, omahaNutClassValueSize: true }, 4000 + i);
      const owner = decide(s, { omahaNutClassValueSize: true }, 4000 + i);
      expect(both.action).toBe(owner.action);
      expect(both.amount).toBe(owner.amount);
    });
  });
});

describe('horsePublicBetSizeTo on random public spots', () => {
  it('never an illegal size: inside the bounds, whole cents, short of a commitment', () => {
    let s = 0x1234567;
    const r = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
    const deck: Card[] = [];
    for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
    let sized = 0;
    for (let i = 0; i < 2000; i++) {
      const street = (['flop', 'turn', 'river'] as const)[Math.floor(r() * 3)];
      const board = deck
        .slice()
        .sort(() => r() - 0.5)
        .slice(0, { flop: 3, turn: 4, river: 5 }[street]);
      const pot = Math.round((1 + r() * 400) * 100) / 100;
      const raise = r() < 0.4;
      const currentBet = raise ? Math.round(pot * (0.2 + r() * 0.5) * 100) / 100 : 0;
      const seatBet = raise && r() < 0.3 ? Math.round(currentBet * r() * 50) / 100 : 0;
      const seatStack = Math.round((1 + r() * 1000) * 100) / 100;
      const toCall = currentBet - seatBet;
      const maxTo =
        Math.floor(Math.min(seatBet + seatStack, currentBet + pot + toCall) * 100) / 100;
      const minTo = Math.min(maxTo, Math.round((raise ? currentBet * 2 : 0.02) * 100) / 100);
      const spot: HorsePublicBetSizeSpot = {
        street,
        kind: raise ? 'raise' : 'bet',
        board,
        pot,
        currentBet,
        seatBet,
        seatStack,
        minTo,
        maxTo,
        opponents: 1 + Math.floor(r() * 4),
        inPosition: r() < 0.5,
        opponentFoldToBet: ([null, 'high', 'low'] as const)[Math.floor(r() * 3)],
      };
      const to = horsePublicBetSizeTo(spot, r);
      if (to === null) continue;
      sized++;
      expect(to).toBeGreaterThanOrEqual(minTo);
      expect(to).toBeLessThanOrEqual(maxTo);
      expect(Math.round(to * 100) / 100).toBe(to);
      expect(to).toBeLessThanOrEqual(seatBet + seatStack + 0.005);
      // Short of a commitment, or the largest legal wager.
      if (to !== maxTo)
        expect(to - seatBet).toBeLessThan(HORSE_PUBLIC_COMMITMENT_SHARE * seatStack);
      if (to > minTo + 0.01 && to < maxTo - 0.01) {
        const f = (to - (raise ? currentBet : seatBet)) / (raise ? pot + toCall : pot);
        expect(f).toBeGreaterThanOrEqual(0.25 - 0.01);
        expect(f).toBeLessThanOrEqual(1 + 0.01);
      }
    }
    expect(sized).toBeGreaterThan(500);
  });

  it('the menu: one base size per street and board class, a fixed public mix around it', () => {
    const c = (s: string) =>
      s.match(/../g)!.map((x) => ({
        rank: x[0] as CardRank,
        suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[
          x[1] as 'c' | 'd' | 'h' | 's'
        ],
      }));
    expect(horsePublicBoardClass(c('Kc7d2h'))).toBe('dry');
    expect(horsePublicBoardClass(c('9c8d6h'))).toBe('wet');
    expect(horsePublicBoardClass(c('9c8d2h'))).toBe('dry');
    expect(horsePublicBoardClass(c('Kc7c2h'))).toBe('wet');
    expect(horsePublicBoardClass(c('Kc7c2c'))).toBe('flush');
    expect(horsePublicBoardClass(c('KcKd2h'))).toBe('paired');
    const base: HorsePublicBetSizeSpot = {
      street: 'flop',
      kind: 'bet',
      board: c('Kc7d2h'),
      pot: 10,
      currentBet: 0,
      seatBet: 0,
      seatStack: 100,
      minTo: 0.1,
      maxTo: 10,
      opponents: 1,
      inPosition: true,
      opponentFoldToBet: null,
    };
    expect(horsePublicBetFraction(base, 0.5)).toBeCloseTo(0.4, 6);
    expect(horsePublicBetFraction(base, 0.1)).toBeCloseTo(0.3, 6);
    expect(horsePublicBetFraction(base, 0.9)).toBeCloseTo(0.52, 6);
    expect(horsePublicBetFraction({ ...base, opponentFoldToBet: 'low' }, 0.5)).toBeCloseTo(0.46, 6);
    expect(horsePublicBetFraction({ ...base, kind: 'raise' }, 0.5)).toBe(0.8);
  });
});
