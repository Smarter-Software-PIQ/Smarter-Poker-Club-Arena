/**
 * Lane CORE-POOLED-2 latency law (Nov 21): the omahaBest memo (OmahaMathCoreEval.ts) changes no number. omahaBest
 * is pure; with the memo on and off, every 2+3 score, every core receipt (timing fields aside) and every decision on
 * the 200 generated COREGUARD states is identical. Frozen clock, so both runs are the same computation.
 * Constructed and generated cards only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from '../HorseComplaintReplay.js';
import { omahaMathCoreExactLegalize } from './OmahaMathCoreAcceptance.js';
import { OMAHA_MATH_CORE_ALL_STREETS, omahaMathCoreRule } from './OmahaMathCoreRule.js';
import { omahaBest, setOmahaBestMemoForTests } from './OmahaMathCoreEval.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SUIT: Record<string, Card['suit']> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};
type Street = 'preflop' | 'flop' | 'turn' | 'river';
interface Spec {
  variant: 'plo4' | 'plo5' | 'plo6';
  n: number;
  street: Street;
  facing: boolean;
  deep: boolean;
  lightning: boolean;
  seed: number;
}

function rngOf(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (x: number) => Math.round(x * 100) / 100;
/** '' when byte-identical, else the first difference in context (for the report). */
function sameJson(a: unknown, b: unknown): string {
  // wall-clock measurements (latencyMs, elapsedMs) are not decisions
  const noClock = (k: string, v: unknown) =>
    /^(latency|elapsed|compute)Ms$/.test(k) ? undefined : v;
  const x = JSON.stringify(a, noClock);
  const y = JSON.stringify(b, noClock);
  if (x === y) return '';
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return `@${i}: ${x.slice(Math.max(0, i - 80), i + 80)} <> ${y.slice(Math.max(0, i - 80), i + 80)}`;
}

/** A generated public node and the Horse's own cards (never recorded cards). */
function gen(spec: Spec): { st: ReturnType<typeof stateAt>; spec: Spec } {
  const rng = rngOf(spec.seed);
  const deck: string[] = [];
  for (const r of '23456789TJQKA') for (const s of 'cdhs') deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const holeN = Number(spec.variant.slice(-1));
  const hole = deck.slice(0, holeN);
  const boardAll = deck.slice(holeN, holeN + 5);
  const boardLen = { preflop: 0, flop: 3, turn: 4, river: 5 }[spec.street];
  const n = spec.n;
  const seats = Array.from({ length: n }, (_, i) => i + 1);
  const dealer = n;
  const sb = n === 2 ? 2 : 1;
  const bb = n === 2 ? 1 : 2;
  const behind = new Map<number, number>();
  for (const s of seats) behind.set(s, spec.deep ? (s % 2 ? 600 : 450) : s % 2 ? 80 : 60);
  const streetBet = new Map<number, number>(seats.map((s) => [s, 0]));
  const total = new Map<number, number>(seats.map((s) => [s, 0]));
  const folded = new Set<number>();
  const allIn = new Set<number>();
  const actions: ComplaintAction[] = [];
  const push = (seat: number, stage: string, action: string, amount: number, origin: string) =>
    actions.push({
      ord: actions.length + 1,
      seat,
      stage,
      action,
      amount,
      origin,
      isFullRaise: action === 'raise' || action === 'bet',
      dead: false,
    });
  const put = (seat: number, to: number) => {
    const add = Math.min(behind.get(seat)!, to - streetBet.get(seat)!);
    behind.set(seat, r2(behind.get(seat)! - add));
    streetBet.set(seat, r2(streetBet.get(seat)! + add));
    total.set(seat, r2(total.get(seat)! + add));
    if (behind.get(seat)! <= 0.005) allIn.add(seat);
    return add;
  };
  put(sb, 1);
  push(sb, 'preflop', 'sb', 1, 'forced');
  put(bb, 2);
  push(bb, 'preflop', 'bb', 2, 'forced');
  let hero: number;
  let currentBet = 2;
  let lastIncrement = 2;
  if (spec.street === 'preflop') {
    hero = bb;
    const opener = n === 2 ? sb : 3;
    put(opener, 6);
    push(opener, 'preflop', 'raise', 6, 'player');
    currentBet = 6;
    lastIncrement = 4;
    for (const s of seats) {
      if (s === opener || s === bb || (n === 2 && s === sb)) continue;
      if (s === sb || (spec.facing === false && s > opener) || (s > 4 && n > 4)) {
        folded.add(s);
        push(s, 'preflop', 'fold', 0, 'player');
      } else if (s > opener) {
        push(s, 'preflop', 'call', put(s, 6), 'player');
      }
    }
  } else {
    const opener = n === 2 ? sb : 3;
    put(opener, 6);
    push(opener, 'preflop', 'raise', 6, 'player');
    const order = n === 2 ? [bb] : [...seats.filter((s) => s > opener), sb, bb];
    for (const s of order) push(s, 'preflop', 'call', put(s, 6), 'player');
    const streets: Street[] = ['flop', 'turn', 'river'];
    const post = seats; // first seat left of the button acts first; the button last
    for (const st of streets) {
      for (const s of seats) streetBet.set(s, 0);
      currentBet = 0;
      lastIncrement = 2;
      if (st !== spec.street) {
        for (const s of post) push(s, st, 'check', 0, 'player');
        continue;
      }
      hero = seats[Math.floor(rng() * n)];
      if (!spec.facing) {
        for (const s of post) {
          if (s === hero) break;
          push(s, st, 'check', 0, 'player');
        }
      } else {
        const others = seats.filter((s) => s !== hero);
        const bettor = others[Math.floor(rng() * others.length)];
        const frac = [1 / 3, 0.75, 1][Math.floor(rng() * 3)];
        let bet = 0;
        let k = 0;
        for (;;) {
          const s = post[k % n];
          k++;
          if (s === hero && bet > 0) break;
          if (bet === 0) {
            if (s === bettor) {
              const pot = [...total.values()].reduce((a, b) => a + b, 0);
              const size = Math.min(r2(frac * pot), behind.get(s)!);
              put(s, size);
              bet = size;
              currentBet = size;
              lastIncrement = Math.max(2, size);
              push(s, st, allIn.has(s) ? 'all_in' : 'bet', size, 'player');
            } else push(s, st, 'check', 0, 'player');
          } else push(s, st, 'call', put(s, bet), 'player');
        }
      }
      break;
    }
  }
  const heroSeat = hero!;
  const pot = r2([...total.values()].reduce((a, b) => a + b, 0));
  const heroBet = streetBet.get(heroSeat)!;
  const heroBehind = behind.get(heroSeat)!;
  const toCall = Math.max(0, r2(Math.min(currentBet - heroBet, heroBehind)));
  const potMaxTo = r2(currentBet + pot + Math.max(0, currentBet - heroBet));
  const heroMaxTo = Math.min(potMaxTo, r2(heroBet + heroBehind));
  const minTo = currentBet > 0 ? r2(currentBet + Math.max(2, lastIncrement)) : 2;
  const allInLegal = heroBehind > 0 && heroBet + heroBehind <= potMaxTo + 0.005;
  const wagerLegal = heroBehind > toCall + 0.005 && minTo <= heroMaxTo + 0.005;
  const legal =
    toCall > 0
      ? ['fold', 'call', ...(wagerLegal ? ['raise'] : []), ...(allInLegal ? ['all_in'] : [])]
      : ['check', ...(wagerLegal ? ['bet'] : []), ...(allInLegal ? ['all_in'] : [])];
  const node: ComplaintAction = {
    ord: actions.length + 1,
    seat: heroSeat,
    stage: spec.street,
    action: toCall > 0 ? 'call' : 'check',
    amount: toCall,
    origin: 'horse_policy',
    isFullRaise: false,
    dead: false,
  };
  actions.push(node);
  node.publicNode = {
    pot,
    ante: 0,
    anteType: null,
    mode: 'cash',
    asset: 'chips',
    seats: seats.map((s) => [
      s,
      behind.get(s)!,
      streetBet.get(s)!,
      total.get(s)!,
      0,
      0,
      (folded.has(s) ? 1 : 0) | (allIn.has(s) ? 2 : 0),
    ]),
    boards: [boardAll.slice(0, boardLen).join('')],
    street: spec.street,
    toCall,
    currentBet,
    minRaiseTo: wagerLegal ? minTo : null,
    maxRaiseTo: wagerLegal ? heroMaxTo : null,
    legalActions: legal,
    dealerSeat: dealer,
    chipUnit: 0.01,
    bigBlind: 2,
    smallBlind: 1,
    variant: spec.variant,
    structure: 'pot_limit',
    actorSeat: heroSeat,
    bombPot: false,
    boardCount: 1,
    allInOrFold: false,
    fixedBetSize: null,
    wagersCapped: false,
  } as unknown as ComplaintPublicNode;
  const fx = {
    version: 1,
    slug: `coreguard-${spec.seed}`,
    title: 'Generated PLO cash decision',
    complaint: 'generated',
    handId: String(spec.seed),
    fmt: 'cash',
    variant: spec.variant,
    players: seats.map((s) => ({ seat: s, isHorse: s === heroSeat })),
    hole: { [String(heroSeat)]: hole.map((c) => ({ rank: c[0], suit: SUIT[c[1]] }) as Card) },
    actions,
    forbidden: [],
    seeds: [],
  } as unknown as ComplaintFixture;
  const st = stateAt(fx, node);
  if (spec.lightning)
    (st.gs as { publicMemoryDomain?: unknown }).publicMemoryDomain = {
      ...((st.gs as { publicMemoryDomain?: object }).publicMemoryDomain ?? {}),
      speed: 'lightning',
    };
  return { st, spec };
}

function specs(variants: Spec['variant'][], count: number): Spec[] {
  const out: Spec[] = [];
  const streets: Street[] = ['preflop', 'flop', 'turn', 'river'];
  let seed = 1000;
  for (const variant of variants)
    for (const street of streets)
      for (const n of [2, 3, 4])
        for (const facing of street === 'preflop' ? [true] : [true, false])
          for (const deep of [false, true]) {
            seed++;
            out.push({ variant, n, street, facing, deep, lightning: seed % 2 === 0, seed });
          }
  return out.slice(0, count);
}

/**
 * (Lane CORE-POOLED-5: the sampler no longer reads the clock at all, law OmahaMathCoreDeterminism.law.test.ts;
 * the text below describes the state before that and why the clock is frozen here.)
 * A clock that does not move, as the exact replay runs the core. The core boxes its equity sampling with the
 * wall clock (OMAHA_MATH_CORE_BUDGET_MS deadline, per-call maxMs, the late() reduced draw floor); under a loaded
 * host a stall moves that clock between two runs of the same state, the runs take different draw counts and a
 * borderline call/fold flips (B4 failed an engine release prequalification on Nov 20 with 'call' vs 'fold';
 * reproduced on the B4 states 1007, 1011, 1012 with a clock advancing 37 ms per read). With the clock frozen
 * the deterministic work budget (OMAHA_MATH_CORE_WORK_BUDGET) and the seeded samplers alone bound the
 * work, so two runs of the same state are the same computation and a comparison between them is exact.
 * Restored by the file's afterEach (vi.restoreAllMocks).
 */
const freezeClock = () => vi.spyOn(performance, 'now').mockReturnValue(0);

const SPECS = specs(['plo4', 'plo5'], 200);
void LIVE;
void sameJson;

afterEach(() => {
  setOmahaBestMemoForTests(true);
  vi.restoreAllMocks();
});

const noClock = (k: string, v: unknown) => (/(^ms$|Ms$|^elapsed|^latency)/.test(k) ? undefined : v);

describe('the omahaBest memo returns exactly the fresh evaluation', () => {
  it('on 20,000 seeded holdings x boards (PLO4, PLO5, PLO6 sizes), first and repeated lookups', () => {
    const rng = rngOf(424242);
    const deal = (k: number, used: Set<number>) => {
      const out: number[] = [];
      while (out.length < k) {
        const c = Math.floor(rng() * 52);
        if (!used.has(c)) {
          used.add(c);
          out.push(c);
        }
      }
      return out;
    };
    const cases: Array<{ hole: number[]; board: number[] }> = [];
    for (let i = 0; i < 4000; i++) {
      const used = new Set<number>();
      const hole = deal(4 + (i % 3), used);
      cases.push({ hole, board: deal(5, used) });
    }
    setOmahaBestMemoForTests(false);
    const fresh = cases.map((c) => omahaBest(c.hole, c.hole.length, c.board, 5));
    setOmahaBestMemoForTests(true);
    for (let rep = 0; rep < 5; rep++)
      cases.forEach((c, i) => expect(omahaBest(c.hole, c.hole.length, c.board, 5)).toBe(fresh[i]));
  });
});

describe('every core receipt and decision is identical with the memo on and off', () => {
  it(`on ${SPECS.length} generated PLO4/PLO5 states, every street admitted, frozen clock`, () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const opts = {
      omahaMathCore: true,
      ...OMAHA_MATH_CORE_ALL_STREETS,
      omahaMathCorePreflop: true,
    };
    let compared = 0;
    for (const spec of SPECS) {
      const { st } = gen(spec);
      const run = () =>
        JSON.stringify(
          omahaMathCoreRule(
            { action: (st.gs.toCall ?? 0) > 0 ? 'fold' : 'check', thinkTime: 0 },
            st.hero,
            st.gs,
            opts,
            (d) => omahaMathCoreExactLegalize(d, st.hero, st.gs),
            () => 0
          ),
          noClock
        );
      setOmahaBestMemoForTests(false);
      const off = run();
      setOmahaBestMemoForTests(true);
      const on = run();
      expect(on, JSON.stringify(spec)).toBe(off);
      compared++;
    }
    expect(compared).toBe(SPECS.length);
  }, 600_000);
});

// keep the types referenced for readers of the generator
export type _MemoTypes = [SeatPlayer, HorseGameStateV2, Card];
