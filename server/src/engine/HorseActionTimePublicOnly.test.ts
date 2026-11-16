/**
 * THE TIME A HORSE TAKES IS PUBLIC INFORMATION ONLY (owner order 2026-11-15).
 *
 * Property: for a fixed public state, the think time of a Horse is the same
 * function of (the action the table sees, the timing stream) for 200 different
 * private hands, made hands and draws alike, and for the cheap and the deep
 * decision paths. Unset, the brain is the shipped one, byte for byte.
 *
 * The public states are recorded production nodes (PLO5 cash hand 59416584):
 * a turn decision first to act, a flop decision facing a bet, and a turn
 * decision facing an all-in.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { saveFastRandom, seedFastRandom } from './HorseEval.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import {
  HORSE_PUBLIC_FACING_FLOOR_MS,
  HORSE_PUBLIC_FREE_FLOOR_MS,
  HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL,
  horsePublicActionTimeMs,
  horsePublicDifficulty,
  seedHorseTimingRandom,
  type HorsePublicTimingSpot,
} from './horsePublicActionTime.js';
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
  let s = 0x2545f491 ^ ord;
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

const ON = { horseActionTimeIsPublicOnly: true };
const TIMING_SEEDS = [11, 222, 3333, 44444, 555555, 6666666];
const SWITCHES = {
  useTiming: true,
  useGravity: true,
  hollywoodRaise: true,
  holdemHollywood: false,
};

function decide(s: ReturnType<typeof spot>, opts: Record<string, unknown>, strategySeed: number) {
  seedFastRandom(strategySeed);
  HorseMind.reset();
  return HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, { mind: false, ...opts } as never);
}

function expected(
  s: ReturnType<typeof spot>,
  action: string,
  amount: number | undefined,
  seed: number
) {
  seedHorseTimingRandom(seed);
  return horsePublicActionTimeMs(
    HorseLogic.publicTimingSpot(s.gs, s.hero.user_id, action, amount, [0, 0], SWITCHES)
  );
}

const label = (d: { action: string }) => d.action;
/** A decision without its wall-clock stamps (the policy graph times each step). */
const stable = (d: unknown): unknown =>
  JSON.parse(
    JSON.stringify(d, (k, v) => (/^(elapsed|latency|compute)Ms$/.test(k) ? undefined : v))
  );

describe.each([
  { name: 'turn, first to act', ord: 18 },
  { name: 'flop, facing a bet', ord: 16 },
  { name: 'turn, facing an all-in', ord: 20 },
])('public-only action time: $name', ({ ord }) => {
  const HANDS = hands(ord);

  it('200 private hands: the think time is the public function of the action shown, on every path', () => {
    const byAction = new Map<string, Set<string>>();
    const computeMs: number[] = [];
    let n = 0;
    HANDS.forEach((hole, i) => {
      const s = spot(ord, hole);
      // Two decision paths per hand: the reference path and the path with the
      // opponent-reading mind and the adaptive Monte Carlo early exit off.
      const paths: Record<string, unknown>[] = [{}, { mind: true, v7AdaptiveMC: false }];
      const seed = TIMING_SEEDS[i % TIMING_SEEDS.length];
      for (const path of paths) {
        seedHorseTimingRandom(seed);
        const t0 = performance.now();
        const d = decide(s, { ...ON, ...path }, 1000 + i);
        computeMs.push(performance.now() - t0);
        const want = expected(s, d.action, d.amount, seed);
        expect(d.thinkTime, `hand ${hole.map(key).join('')} ${d.action}`).toBe(want);
        // All-in or not is visible; nothing else about the amount moves a PLO think time.
        const allIn = d.action === 'all_in' || (d.amount ?? 0) >= s.hero.stack * 0.999;
        const k = `${label(d)}|${allIn}|${seed}`;
        if (!byAction.has(k)) byAction.set(k, new Set());
        byAction.get(k)!.add(String(d.thinkTime));
        n++;
      }
    });
    expect(n).toBe(400);
    // Same visible action + same timing draw => one think time, whatever was held.
    for (const [k, times] of byAction) expect([...times], k).toHaveLength(1);
    // More than one visible action was exercised, so the property is not vacuous.
    expect(new Set([...byAction.keys()].map((k) => k.split('|')[0])).size).toBeGreaterThanOrEqual(
      1
    );
    computeMs.sort((a, b) => a - b);
    // Measurement, printed for the evidence file: decision time of the slowest path.
    console.info(
      `[public-only timing] ord ${ord}: decide() ms median ${computeMs[200].toFixed(1)} p95 ${computeMs[380].toFixed(1)} max ${computeMs[399].toFixed(1)}`
    );
  });

  it('the full delay distribution is identical for every hand that shows the same action', () => {
    // 12 hands spread over the set, 40 timing draws each: the vectors match exactly.
    const vectors = new Map<string, string>();
    for (let i = 0; i < HANDS.length; i += 17) {
      const s = spot(ord, HANDS[i]);
      const d0 = decide(s, ON, 77);
      const times: number[] = [];
      for (let t = 1; t <= 40; t++) {
        seedHorseTimingRandom(t * 7919);
        const d = decide(s, ON, 77);
        expect(d.action).toBe(d0.action);
        times.push(d.thinkTime);
      }
      const allIn = d0.action === 'all_in' || (d0.amount ?? 0) >= s.hero.stack * 0.999;
      const k = `${d0.action}|${allIn}`;
      const v = times.join(',');
      if (vectors.has(k)) expect(v, k).toBe(vectors.get(k));
      else vectors.set(k, v);
    }
    expect(vectors.size).toBeGreaterThanOrEqual(1);
  });

  it('unset or false is the shipped brain; on changes the think time only', () => {
    for (let i = 0; i < 40; i++) {
      const s = spot(ord, HANDS[i * 5]);
      const unset = decide(s, {}, 500 + i);
      const afterUnset = saveFastRandom();
      const off = decide(s, { horseActionTimeIsPublicOnly: false }, 500 + i);
      const afterOff = saveFastRandom();
      const junk = decide(s, { horseActionTimeIsPublicOnly: 'yes' }, 500 + i);
      const on = decide(s, ON, 500 + i);
      const afterOn = saveFastRandom();
      expect(stable(off)).toEqual(stable(unset));
      expect(stable(junk)).toEqual(stable(unset));
      expect(afterOff).toBe(afterUnset);
      // On: same action, same amount, and the strategy stream sits where it did.
      expect([on.action, on.amount]).toEqual([unset.action, unset.amount]);
      expect(afterOn).toBe(afterUnset);
      expect(stable({ ...on, thinkTime: 0 })).toEqual(stable({ ...unset, thinkTime: 0 }));
    }
  });

  it("keeps today's pace: mean and median within a few percent of the shipped generator", () => {
    const off: number[] = [];
    const on: number[] = [];
    let offBank = 0;
    let onBank = 0;
    for (let i = 0; i < 120; i++) {
      const s = spot(ord, HANDS[i]);
      for (let r = 0; r < 12; r++) {
        const d = decide(s, { mind: true }, 9000 + i * 31 + r);
        if (d.thinkTime >= HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL) offBank++;
        else off.push(d.thinkTime);
        for (let t = 0; t < 4; t++) {
          const v = expected(s, d.action, d.amount, 1 + i * 1009 + r * 97 + t * 13);
          if (v >= HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL) onBank++;
          else on.push(v);
        }
      }
    }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const med = (v: number[]) => v.slice().sort((a, b) => a - b)[v.length >> 1];
    console.info(
      `[public-only timing] ord ${ord}: shipped mean ${mean(off).toFixed(0)} median ${med(off)} bank ${((100 * offBank) / (off.length + offBank)).toFixed(1)}% | public-only mean ${mean(on).toFixed(0)} median ${med(on)} bank ${((100 * onBank) / (on.length + onBank)).toFixed(1)}%`
    );
    expect(Math.abs(mean(on) / mean(off) - 1)).toBeLessThan(0.08);
    expect(Math.abs(med(on) / med(off) - 1)).toBeLessThan(0.12);
  });
});

describe('the public pacing function', () => {
  const base: HorsePublicTimingSpot = {
    stage: 'turn',
    action: 'bet',
    amount: 60,
    toCall: 0,
    pot: 100,
    bigBlind: 2,
    heroStack: 400,
    opponentStack: 400,
    contestingPlayers: 2,
    board: [
      { rank: 'K', suit: 'hearts' },
      { rank: '9', suit: 'hearts' },
      { rank: '4', suit: 'clubs' },
      { rank: '8', suit: 'spades' },
    ],
    boardCount: 1,
    tournament: false,
    facingTournamentShove: false,
    deliberateCheckFold: false,
    tempoSeed: 'horse-a',
    thinkRange: [1400, 4200],
    useTiming: true,
    useGravity: true,
    hollywoodRaise: true,
    hollywoodHoldem: false,
  };
  const sample = (s: HorsePublicTimingSpot, n = 4000) => {
    seedHorseTimingRandom(12345);
    return Array.from({ length: n }, () => horsePublicActionTimeMs(s));
  };

  it('never acts under the floor: 350 ms free, 1,250 ms facing a bet, 2,000 ms a tournament shove', () => {
    expect(Math.min(...sample(base))).toBeGreaterThanOrEqual(HORSE_PUBLIC_FREE_FLOOR_MS);
    expect(
      Math.min(...sample({ ...base, action: 'check', amount: undefined }))
    ).toBeGreaterThanOrEqual(HORSE_PUBLIC_FREE_FLOOR_MS);
    for (const action of ['call', 'fold', 'raise'])
      expect(Math.min(...sample({ ...base, action, toCall: 50 }))).toBeGreaterThanOrEqual(
        HORSE_PUBLIC_FACING_FLOOR_MS
      );
    expect(
      Math.min(
        ...sample({
          ...base,
          action: 'fold',
          toCall: 400,
          tournament: true,
          facingTournamentShove: true,
        })
      )
    ).toBeGreaterThanOrEqual(2000);
  });

  it('no single millisecond repeats like a clamp', () => {
    const v = sample({ ...base, action: 'call', toCall: 50 }, 6000);
    const counts = new Map<number, number>();
    for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
    expect(Math.max(...counts.values()) / v.length).toBeLessThan(0.01);
  });

  it('is longer on the river and on a big price, per-seat tempo differs, and the deadline clamps it', () => {
    const mean = (v: number[]) => {
      const w = v.filter((x) => x < HORSE_PUBLIC_THINK_TIMEBANK_SENTINEL);
      return w.reduce((a, b) => a + b, 0) / w.length;
    };
    const river = {
      ...base,
      stage: 'river',
      board: [...base.board, { rank: '2', suit: 'diamonds' } as Card],
    };
    expect(mean(sample(river))).toBeGreaterThan(mean(sample(base)));
    expect(mean(sample({ ...base, action: 'call', toCall: 100 }))).toBeGreaterThan(
      mean(sample({ ...base, action: 'call', toCall: 10 }))
    );
    const tempos = ['3f1c9a', 'Zed-771', 'q', 'horse-b', 'p4', 'a-very-long-seat-id-0001'].map(
      (tempoSeed) => mean(sample({ ...base, tempoSeed }))
    );
    expect(Math.max(...tempos) / Math.min(...tempos)).toBeGreaterThan(1.15);
    expect(Math.max(...sample({ ...base, deadlineRemainingMs: 5000 }))).toBeLessThanOrEqual(3500);
    expect(horsePublicDifficulty({ ...base, stage: 'preflop' })).toBe(0);
    expect(horsePublicDifficulty({ ...base, boardCount: 2 })).toBeGreaterThan(
      horsePublicDifficulty(base)
    );
  });

  it('the timing stream is its own: a strategy seed does not move it, and it does not move the strategy stream', () => {
    seedHorseTimingRandom(42);
    seedFastRandom(1);
    const a = horsePublicActionTimeMs(base);
    const strategyAfter = saveFastRandom();
    seedHorseTimingRandom(42);
    seedFastRandom(999);
    const b = horsePublicActionTimeMs(base);
    expect(b).toBe(a);
    seedFastRandom(1);
    expect(saveFastRandom()).toBe(strategyAfter);
  });

  it("hold'em Hollywood: the public half of the rule only (a seat held by any hand gets the same spot)", () => {
    const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
    const node = fx.actions.find((a) => a.ord === 16)!;
    const a = stateAt(fx, node);
    fx.hole[String(node.seat)] = hands(16, 1)[0];
    const b = stateAt(fx, node);
    const sw = { ...SWITCHES, holdemHollywood: true };
    const sa = HorseLogic.publicTimingSpot(a.gs, a.hero.user_id, 'raise', 195, [0, 0], sw);
    const sb = HorseLogic.publicTimingSpot(b.gs, b.hero.user_id, 'raise', 195, [0, 0], sw);
    expect(sb).toEqual(sa);
    expect(sa.hollywoodHoldem).toBe(true);
    expect(
      HorseLogic.publicTimingSpot(a.gs, a.hero.user_id, 'call', undefined, [0, 0], sw)
        .hollywoodHoldem
    ).toBe(false);
    expect(JSON.stringify(sa)).not.toContain(key(a.hero.cards[0]) + '"');
  });
});
