/**
 * Lane CORE-POOLED-2 phase 2 law (Nov 20; owner: "EVERYTHING DEPENDS ON THE MATH"): no path of omahaMathCore folds
 * the exact current nuts on any street (flop, turn, river) when a call is available - not the core's own pricing,
 * not the change margin keeping today's fold, not the PLO5 river fold -> call narrowing. Every decision here is
 * run through the whole Rule (omahaMathCoreRule) with today's action a fold, on a frozen clock.
 * Constructed spots only (generated public line, the Horse's own constructed cards): no recorded hole cards.
 * The public-line generator is the COREGUARD acceptance generator (OmahaMathCoreAcceptance.law.test.ts) with the
 * hero's cards and the board fixed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../types.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from '../HorseComplaintReplay.js';
import { omahaMathCoreExactLegalize } from './OmahaMathCoreAcceptance.js';
import { OMAHA_MATH_CORE_ALL_STREETS, omahaMathCoreRule } from './OmahaMathCoreRule.js';
import { CURRENT_NUTS_CALL_FLOOR, holdsCurrentNuts } from './OmahaMathCoreNutsFloor.js';
import { decideOmahaMathCore, type CoreState } from './OmahaMathCore.js';
import { parseCardString } from './OmahaMathCoreEval.js';

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
  /** every seat's starting stack (a short field: the river wager puts the hero all-in to call) */
  behindAll?: number;
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
/** A generated public node and the Horse's own cards (never recorded cards). */
function gen(
  spec: Spec,
  fixedHole: string[],
  fixedBoard: string[]
): { st: ReturnType<typeof stateAt>; spec: Spec } {
  const rng = rngOf(spec.seed);
  const fixed = [...fixedHole, ...fixedBoard];
  const deck: string[] = [];
  for (const r of '23456789TJQKA')
    for (const s of 'cdhs') if (!fixed.includes(r + s)) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const holeN = Number(spec.variant.slice(-1));
  const hole = fixedHole.slice(0, holeN);
  const boardAll = [...fixedBoard, ...deck].slice(0, 5);
  const boardLen = { preflop: 0, flop: 3, turn: 4, river: 5 }[spec.street];
  const n = spec.n;
  const seats = Array.from({ length: n }, (_, i) => i + 1);
  const dealer = n;
  const sb = n === 2 ? 2 : 1;
  const bb = n === 2 ? 1 : 2;
  const behind = new Map<number, number>();
  for (const s of seats)
    behind.set(s, spec.behindAll ?? (spec.deep ? (s % 2 ? 600 : 450) : s % 2 ? 80 : 60));
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

afterEach(() => {
  vi.restoreAllMocks();
});

const split = (s: string) => s.match(/../g)!;
/** [street, hero cards (PLO5; PLO4 takes the first four), board] - each the exact current nuts */
const NUTS: Array<[Street, string, string]> = [
  ['flop', 'JsTs2c3d4h', 'AsKsQs'], // royal flush
  ['flop', 'Th9c3d4s5h', 'Js8d7c'], // the nut straight, rainbow unpaired
  ['turn', 'Th9c3d4s5h', 'Js8d7c2h'], // the nut straight, no flush or pair possible
  ['turn', 'KhKc3d4d5h', 'KsKd7c2h'], // quads on a paired board, no straight flush possible
  ['river', 'Th9c4d4h5c', 'Js8d7c2h3s'], // the nut straight, unpaired, no three of a suit
  ['river', 'KhKc3d4d5h', 'KsKd7c2h9s'], // quads, no straight flush possible
  ['river', 'AsQs3d4d5h', 'Ks9s2s7h4c'], // the nut flush, unpaired, no straight flush possible
];
const ON = { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS, omahaMathCorePreflop: true };

describe('the spots are the exact current nuts (exact enumeration)', () => {
  for (const [street, hole, board] of NUTS)
    for (const holeN of [4, 5])
      it(`${street} ${hole.slice(0, holeN * 2)} on ${board}`, () => {
        expect(
          holdsCurrentNuts(parseCardString(hole.slice(0, holeN * 2)), parseCardString(board))
        ).toBe(true);
      });
  it('the floor is on', () => expect(CURRENT_NUTS_CALL_FLOOR).toBe(true));
});

describe('no path of the core folds the current nuts facing a wager (flop, turn, river; PLO4 and PLO5)', () => {
  let seed = 7000;
  for (const [street, hole, board] of NUTS)
    for (const variant of ['plo4', 'plo5'] as const)
      for (const n of [2, 3, 4])
        for (const deep of [false, true]) {
          const spec: Spec = {
            variant,
            n,
            street,
            facing: true,
            deep,
            lightning: (seed + n) % 2 === 0,
            seed: ++seed,
          };
          it(`${variant} ${street} ${board} ${n}-handed ${deep ? 'deep' : 'short'}${spec.lightning ? ' Lightning' : ''}: today's fold becomes a call or a raise`, () => {
            vi.spyOn(performance, 'now').mockReturnValue(0);
            const holeN = Number(variant.slice(-1));
            const { st } = gen(spec, split(hole).slice(0, holeN), split(board));
            expect((st.gs.toCall ?? 0) > 0).toBe(true);
            const d = omahaMathCoreRule({ action: 'fold', thinkTime: 0 }, st.hero, st.gs, ON, (x) =>
              omahaMathCoreExactLegalize(x, st.hero, st.gs)
            );
            const rec = d.omahaMathCore!;
            expect(rec.error ?? null).toBeNull();
            expect(rec.applied).toBe(true);
            expect(d.action).not.toBe('fold');
            expect(['call', 'raise', 'all_in']).toContain(d.action);
            expect(rec.core!.choice.action).not.toBe('fold');
          });
        }
});

describe('the call is the whole stack (no fold -> call narrowing applies): the current nuts are still called', () => {
  let seed = 9000;
  for (const [street, hole, board] of NUTS)
    for (const variant of ['plo4', 'plo5'] as const)
      for (const n of [3, 4])
        for (const lightning of [false, true]) {
          const spec: Spec = {
            variant,
            n,
            street,
            facing: true,
            deep: false,
            lightning,
            seed: ++seed,
            behindAll: 14,
          };
          it(`${variant} ${street} ${board} ${n}-handed${lightning ? ' Lightning' : ''}, 14-chip stacks`, () => {
            vi.spyOn(performance, 'now').mockReturnValue(0);
            const holeN = Number(variant.slice(-1));
            const { st } = gen(spec, split(hole).slice(0, holeN), split(board));
            if (!((st.gs.toCall ?? 0) > 0)) return; // the generated line left nothing to call
            const d = omahaMathCoreRule({ action: 'fold', thinkTime: 0 }, st.hero, st.gs, ON, (x) =>
              omahaMathCoreExactLegalize(x, st.hero, st.gs)
            );
            expect(d.omahaMathCore!.error ?? null).toBeNull();
            expect(d.action).not.toBe('fold');
          });
        }
});

describe('control: a hand that is not the nuts keeps the fold available', () => {
  it('top set on a three-spade river board is not the nuts; the core still prices the fold', () => {
    const s = {
      variant: 'plo4',
      chipUnit: 0.01,
      mode: 'table',
      street: 'river',
      pot: 160,
      toCall: 40,
      heroBet: 0,
      heroStack: 1000,
      currentBet: 40,
      minRaiseTo: 80,
      maxRaiseTo: 240,
      bigBlind: 2,
      legal: ['fold', 'call', 'raise', 'all_in'],
      heroSeat: 6,
      heroPosition: 'CO',
      ip: false,
      opponents: [
        {
          seat: 1,
          stack: 1000,
          bet: 40,
          folded: false,
          allIn: false,
          streetAction: 'wager',
          calledPrevStreet: true,
          prevAggressor: true,
          position: 'BB',
          preflopLevel: 'call',
        },
      ],
      aggressorSeat: 1,
      line: 'cbet',
      band: 'half',
      wagerFrac: 0.33,
      heroWagerLine: 'raise',
      preflopRaises: 1,
      rake: { percent: 5, cap: 6, noFlopNoDrop: true },
      seed: 'control',
      hole: parseCardString('KhKc3d4h'),
      board: parseCardString('Ks9s2s7h4c'),
    } as unknown as CoreState;
    expect(holdsCurrentNuts(s.hole, s.board)).toBe(false);
    const { receipt } = decideOmahaMathCore(s, { now: () => 0 });
    expect(receipt.evs.some((e) => e.action === 'fold')).toBe(true);
    expect(receipt.nutFloor ?? null).toBeNull();
  });
});
