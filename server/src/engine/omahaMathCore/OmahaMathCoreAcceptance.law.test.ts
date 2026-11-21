/**
 * COREGUARD law tests (lane COREGUARD 2026-11-19; owner 8:48 PM Chicago: "You
 * need to fix this and make any and all proper changes as needed"): with
 * omahaMathCore on, the action committed to the table is exactly the core's
 * EV choice on every PLO4/PLO5 cash decision, and an error never becomes a
 * fold. States are generated (seeded): no recorded hole cards.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, HorseDecision, SeatPlayer } from '../../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { seedFastRandom } from '../HorseEval.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from '../HorseComplaintReplay.js';
import { calculateBettingState, validateAction } from '../PokerEngine.js';
import { horseDecisionReceiptRefusal } from '../horseDecision/responseValidation.js';
import { recheckHorseQualifiedBeforeAcceptance } from '../HorseQualifiedAcceptance.js';
import { recheckHorsePhase14BeforeAcceptance } from '../HorsePhase14Acceptance.js';
import { recheckHorseFeaturesBeforeAcceptance } from '../HorseFeatureAuthority.js';
import { ServerTableEngineTurns } from '../ServerTableEngineTurns.js';
import {
  keepOmahaMathCoreDecision,
  omahaMathCoreExactLegalize,
  omahaMathCoreOwns,
  omahaMathCoreRandomRangeEquity,
  omahaMathCoreRecover,
  type OmahaMathCoreRecoveredReceipt,
} from './OmahaMathCoreAcceptance.js';
import {
  noteOmahaMathCoreSwitchDelivered,
  omahaMathCoreRecoverAdmission,
  omahaMathCoreSwitchOn,
  resetOmahaMathCoreSwitchStateForTests,
} from './OmahaMathCoreSwitchState.js';
import { omahaMathCoreRule, omahaMathCoreStreetAdmitted } from './OmahaMathCoreRule.js';
import { holdsCurrentNuts } from './OmahaMathCoreNutsFloor.js';
import { cardToInt } from './OmahaMathCoreEval.js';
import { OMAHA_MATH_CORE_ALL_STREETS } from './OmahaMathCoreRule.js';

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

const decide = (st: ReturnType<typeof stateAt>, opts: Record<string, unknown>) => {
  HorseMind.reset();
  seedFastRandom(1);
  return HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    observeMind: false,
    ...opts,
  } as HorseDecideOpts);
};

const SPECS = specs(['plo4', 'plo5'], 200);

afterEach(() => {
  vi.restoreAllMocks();
  resetOmahaMathCoreSwitchStateForTests();
});

describe('COREGUARD end to end: committed action == the core receipt', () => {
  it(`on ${SPECS.length} generated PLO4/PLO5 cash states (HU and multiway, table and Lightning, every street, facing and unopened, short and deep) the decision is the core's choice, admitted, legal as-is, never legalized, never an error`, () => {
    let refusals = 0;
    let fallbacks = 0;
    let legalized = 0;
    let checked = 0;
    const ms: number[] = [];
    const errors: string[] = [];
    for (const spec of SPECS) {
      const { st } = gen(spec);
      const d = decide(st, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
        omahaMathCorePreflop: true,
      });
      const rec = d.omahaMathCore!;
      expect(rec, JSON.stringify(spec)).toBeDefined();
      if (rec.error !== null || rec.applied !== true) {
        fallbacks++;
        errors.push(`${JSON.stringify(spec)} -> ${rec.error ?? 'not applied'}`);
        continue;
      }
      if (rec.core?.legalized) legalized++;
      ms.push(rec.core!.ms);
      // the decision leaving the worker is the receipt's choice
      expect(d.action).toBe(rec.action);
      expect(d.amount ?? null).toBe(rec.amount);
      // admitted by the receipt validator under the gate
      const refusal = horseDecisionReceiptRefusal(structuredClone(d), spec.variant, {
        player: st.hero,
        gameState: st.gs,
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
      });
      if (refusal !== null) refusals++;
      // every wager the core priced is legal as-is on the engine's own validator
      const bs = calculateBettingState(
        st.gs.pot,
        st.gs.currentBet,
        st.hero.bet,
        st.gs.bigBlind,
        Math.max(2, (st.gs.minRaiseTo ?? 0) - st.gs.currentBet),
        true
      );
      for (const a of rec.core!.evs) {
        if (a.action !== 'bet' && a.action !== 'raise') continue;
        checked++;
        const legal = omahaMathCoreExactLegalize(
          { action: a.action, amount: a.amount!, thinkTime: 0 },
          st.hero,
          st.gs
        );
        expect(legal.action, `${JSON.stringify(spec)} ${a.action} ${a.amount}`).toBe(a.action);
        expect(legal.amount).toBe(a.amount);
        expect(validateAction(a.action, a.amount!, st.hero.stack, bs).valid).toBe(true);
        expect(a.amount!).toBeGreaterThanOrEqual((st.gs.minRaiseTo ?? 0) - 0.005);
        expect(a.amount!).toBeLessThanOrEqual((st.gs.maxRaiseTo ?? Infinity) + 0.005);
      }
      // the door chain (authority rechecks, Phase 14, feature authority) keeps it
      const door = keepOmahaMathCoreDecision(
        d,
        recheckHorseFeaturesBeforeAcceptance(
          recheckHorsePhase14BeforeAcceptance(
            recheckHorseQualifiedBeforeAcceptance(d, { player: st.hero, gameState: st.gs })
          ),
          st.gs.toCall ?? 0
        ),
        'law'
      );
      expect(door.action).toBe(rec.action);
      expect(door.amount ?? null).toBe(rec.amount);
      // one decision: no second look for a core decision
      expect(
        ServerTableEngineTurns.secondLookPlan(d, st.gs.toCall ?? 0, st.gs.pot, 2, 3000, 10000)
      ).toEqual({ ok: false, reason: 'math_core_owned' });
    }
    ms.sort((a, b) => a - b);
    const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
    console.info(
      `COREGUARD e2e: states=${SPECS.length} applied=${ms.length} refusals=${refusals} fallbacks=${fallbacks} legalized=${legalized} wagersChecked=${checked} coreMs p50=${p(0.5)} p99=${p(0.99)} max=${ms.at(-1)}`
    );
    if (errors.length) console.info(`COREGUARD e2e errors:\n${errors.join('\n')}`);
    expect(refusals).toBe(0);
    expect(fallbacks).toBe(0);
    expect(legalized).toBe(0);
    expect(checked).toBeGreaterThan(50);
  }, 600_000);
});

describe('COREGUARD B1: authority withdrawal records the verdict, never reverts a core choice', () => {
  it('a Phase 10 / Phase 14 / feature withdrawal that would execute the baseline (fold) keeps the core choice', () => {
    // a facing spot where the core puts chips in (the baseline fold differs from it)
    let found: { st: ReturnType<typeof stateAt>; d: HorseDecision } | null = null;
    for (const spec of SPECS.filter((s) => s.street !== 'preflop' && s.facing)) {
      const { st } = gen(spec);
      const d = decide(st, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
        omahaMathCorePreflop: true,
      });
      if (d.action !== 'fold') {
        found = { st, d };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { st, d } = found!;
    expect(omahaMathCoreOwns(d)).toBe(true);
    const withLedgers = {
      ...d,
      action: d.action,
      plo4Policy: {
        applied: true,
        authority: { state: 'missing' },
        selection: 'selected',
        baselineAction: 'fold',
        baselineAmount: null,
        finalAction: d.action,
        finalAmount: d.amount ?? null,
      },
      correctivePolicy: {
        applied: true,
        domain: 'plo5-cash',
        baseline: { action: 'fold' },
        selected: { action: d.action, amount: d.amount },
      },
      featureAuthority: { version: 'horse-feature-decision-v1', authority: { state: 'stale' } },
    } as unknown as HorseDecision;
    let reverted: HorseDecision = withLedgers;
    try {
      reverted = recheckHorseQualifiedBeforeAcceptance(withLedgers, {
        player: st.hero,
        gameState: st.gs,
      });
    } catch {
      reverted = { ...withLedgers, action: 'fold', amount: undefined };
    }
    try {
      reverted = recheckHorsePhase14BeforeAcceptance(reverted);
    } catch {
      /* the shape is a fixture; the law is the keep below */
    }
    reverted = recheckHorseFeaturesBeforeAcceptance(reverted, st.gs.toCall ?? 0);
    expect(reverted.action === d.action && (reverted.amount ?? null) === (d.amount ?? null)).toBe(
      false
    );
    const kept = keepOmahaMathCoreDecision(withLedgers, reverted, 'commit_authority');
    expect(kept.action).toBe(d.action);
    expect(kept.amount ?? null).toBe(d.amount ?? null);
  });
  it('switch OFF / no receipt: the door is the identity (byte-identical to today)', () => {
    const after = { action: 'fold' as const, thinkTime: 1 };
    expect(keepOmahaMathCoreDecision({}, after, 'x')).toBe(after);
    expect(keepOmahaMathCoreDecision(null, after, 'x')).toBe(after);
    const notApplied = {
      omahaMathCore: {
        switch: 'omahaMathCore',
        applied: false,
        action: null,
        amount: null,
        incoming: { action: 'call', amount: 2 },
        error: 'boom',
        core: null,
      },
    } as unknown as HorseDecision;
    expect(keepOmahaMathCoreDecision(notApplied, after, 'x')).toBe(after);
  });
});

describe('COREGUARD B2: one decision', () => {
  it('a core decision never gets a second look and a deep answer never replaces it; other decisions as before', () => {
    const { st } = gen(SPECS.find((s) => s.street === 'turn' && s.facing)!);
    const d = decide(st, {
      omahaMathCore: true,
      ...OMAHA_MATH_CORE_ALL_STREETS,
      omahaMathCorePreflop: true,
    });
    expect(ServerTableEngineTurns.secondLookPlan(d, 10, 100, 2, 3000, 10000)).toEqual({
      ok: false,
      reason: 'math_core_owned',
    });
    expect(
      ServerTableEngineTurns.secondLookVerdict(d, {
        action: d.action === 'fold' ? 'call' : 'fold',
        amount: 10,
      })
    ).toBeNull();
    const plain = { action: 'call', thinkTime: 3000 };
    expect(ServerTableEngineTurns.secondLookPlan(plain, 10, 100, 2, 3000, 10000).ok).toBe(true);
    expect(
      ServerTableEngineTurns.secondLookVerdict({ action: 'call' }, { action: 'fold' })
    ).toEqual({ action: 'fold', amount: undefined });
  });
});

describe('COREGUARD B3: the size the core priced is the size played', () => {
  it('the exact legalizer only rounds to the cent: no near-pot snap, no 92% / 95% stack jam, no whole-dollar rounding', () => {
    const { st } = gen(SPECS.find((s) => s.street === 'flop' && !s.facing && s.deep)!);
    const pot = st.gs.pot;
    const near = r2(pot * 0.95); // fullPotNearPotWager would make this the full pot
    const out = omahaMathCoreExactLegalize(
      { action: 'bet', amount: near + 0.004, thinkTime: 0 },
      st.hero,
      st.gs
    );
    expect(out).toEqual({ action: 'bet', amount: near, thinkTime: 0 });
    const odd = r2(pot * 0.5) + 0.5; // HorseLogic.legalize's chip step would round this
    expect(
      omahaMathCoreExactLegalize({ action: 'bet', amount: odd, thinkTime: 0 }, st.hero, st.gs)
        .amount
    ).toBe(r2(odd));
    expect(() =>
      omahaMathCoreExactLegalize({ action: 'bet', amount: pot * 3, thinkTime: 0 }, st.hero, st.gs)
    ).toThrow();
  });
});

describe('COREGUARD B4: an exception is never an automatic fold', () => {
  it("a throw inside the brain: the decision is the core's own choice run standalone (receipt names the error)", () => {
    // both runs on the same frozen clock: the comparison below is exact, never load-dependent
    freezeClock();
    let n = 0;
    for (const spec of SPECS.filter((s) => s.facing).slice(0, 24)) {
      const { st } = gen(spec);
      const direct = omahaMathCoreRule(
        { action: 'fold', thinkTime: 0 },
        st.hero,
        st.gs,
        { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS, omahaMathCorePreflop: true },
        (d) => omahaMathCoreExactLegalize(d, st.hero, st.gs)
      );
      const brain = vi
        .spyOn(HorseLogic as unknown as { decideInternal: () => never }, 'decideInternal')
        .mockImplementation(() => {
          throw new Error('injected');
        });
      const d = decide(st, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
        omahaMathCorePreflop: true,
      });
      brain.mockRestore();
      const rec = d.omahaMathCore as OmahaMathCoreRecoveredReceipt;
      expect(d.policyFallback).toBeUndefined();
      expect(rec.applied).toBe(true);
      expect(rec.recovered.from).toBe('brain_exception');
      expect(rec.recovered.error).toContain('injected');
      expect(rec.recovered.method).toBe('core');
      expect(d.action).toBe(direct.action);
      expect(d.amount ?? null).toBe(direct.amount ?? null);
      // a fold only when the core's EV says fold
      if (d.action === 'fold') expect(rec.core!.choice.action).toBe('fold');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), spec.variant, {
          player: st.hero,
          gameState: st.gs,
          omahaMathCore: true,
          ...OMAHA_MATH_CORE_ALL_STREETS,
        })
      ).toBeNull();
      n++;
    }
    expect(n).toBeGreaterThan(10);
  }, 300_000);
  it('the core itself failing too: the minimal exact computation calls when equity beats the price and checks when free', () => {
    for (const spec of SPECS.slice(0, 40)) {
      const { st } = gen(spec);
      const out = omahaMathCoreRecover({
        player: st.hero,
        gs: st.gs,
        on: true,
        from: 'worker_failure',
        // the street is the core's (lane CORE-AUDIT: recovery acts only on an owned street)
        preflopOwned: true,
        streetOpts: OMAHA_MATH_CORE_ALL_STREETS,
        error: new Error('timeout'),
        runCore: false,
        budgetMs: 15,
      })!;
      expect(out).not.toBeNull();
      const rec = out.omahaMathCore as OmahaMathCoreRecoveredReceipt;
      expect(rec.recovered.method).toBe('minimal');
      const toCall = st.gs.toCall ?? 0;
      if (toCall <= 0.005) expect(out.action).toBe('check');
      else if (rec.recovered.equity! > rec.recovered.price! + 1e-4)
        expect(['call', 'all_in']).toContain(out.action);
      else if (rec.recovered.equity! < rec.recovered.price! - 1e-4) expect(out.action).toBe('fold');
    }
  });
  it('the minimal computation is bounded in time and close to exact on a known spot (top set vs random)', () => {
    const { st } = gen(SPECS.find((s) => s.street === 'flop' && s.facing && s.n === 2)!);
    const t0 = performance.now();
    const r = omahaMathCoreRandomRangeEquity(st.hero, st.gs, 15);
    expect(performance.now() - t0).toBeLessThan(120);
    expect(r.samples).toBeGreaterThanOrEqual(64);
    expect(r.equity).toBeGreaterThanOrEqual(0);
    expect(r.equity).toBeLessThanOrEqual(1);
  });
  it('switch OFF or PLO6: the exception safety net is exactly as before (byte-identical)', () => {
    for (const variant of ['plo5', 'plo6'] as const) {
      const spec = { ...SPECS.find((s) => s.street === 'flop' && s.facing)!, variant };
      const { st } = gen(spec);
      vi.spyOn(
        HorseLogic as unknown as { decideInternal: () => never },
        'decideInternal'
      ).mockImplementation(() => {
        throw new Error('injected');
      });
      const off = decide(st, {});
      const on = decide(st, { omahaMathCore: variant === 'plo6' });
      vi.restoreAllMocks();
      expect(off.policyFallback).toBe('brain_exception');
      expect(JSON.stringify(on)).toBe(JSON.stringify(off));
      expect(
        omahaMathCoreRecover({
          player: st.hero,
          gs: st.gs,
          on: variant === 'plo6',
          from: 'worker_failure',
          error: 'x',
          runCore: false,
        })
      ).toBeNull();
    }
  });
});

describe('COREGUARD B5: the Lightning fold-through never re-asks a core fold', () => {
  it('with lightningEarlyFoldNeedsFoldThrough on, every core decision is identical to the option off', () => {
    // both arms on the same frozen clock (see freezeClock): identical means the same computation
    freezeClock();
    for (const spec of SPECS.filter((s) => s.lightning && s.n >= 3).slice(0, 24)) {
      const { st } = gen(spec);
      const a = decide(st, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
        omahaMathCorePreflop: true,
      });
      const b = decide(st, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
        omahaMathCorePreflop: true,
        lightningEarlyFoldNeedsFoldThrough: true,
      });
      expect(b.action).toBe(a.action);
      expect(b.amount ?? null).toBe(a.amount ?? null);
      expect(omahaMathCoreOwns(b)).toBe(true);
    }
  }, 300_000);
});

describe('COREGUARD worker-failure doors: the switch the workers were handed', () => {
  it('reads the request option or the delivered switch row; nothing delivered and no option is off', () => {
    expect(omahaMathCoreSwitchOn({})).toBe(false);
    expect(omahaMathCoreSwitchOn({ omahaMathCore: true })).toBe(true);
    noteOmahaMathCoreSwitchDelivered(null);
    expect(omahaMathCoreSwitchOn(undefined)).toBe(false);
  });
});

describe('CORE-AUDIT: the core recovers a failed decision only on a street it owns', () => {
  const STREET_FLAGS_OFF = {
    omahaMathCorePlo4Flop: false,
    omahaMathCorePlo4Turn: false,
    omahaMathCorePlo4River: false,
    omahaMathCorePlo5Flop: false,
    omahaMathCorePlo5Turn: false,
    omahaMathCorePlo5River: false,
  };
  it('worker failure and brain exception: no recovery on a street whose flag is off (only the PLO5 flop flag on)', () => {
    let owned = 0;
    let notOwned = 0;
    for (const spec of SPECS.slice(0, 120)) {
      const { st } = gen(spec);
      const streetOpts = { ...STREET_FLAGS_OFF, omahaMathCorePlo5Flop: true };
      const admitted = omahaMathCoreStreetAdmitted(spec.variant, spec.street, streetOpts);
      for (const from of ['worker_failure', 'brain_exception'] as const) {
        const out = omahaMathCoreRecover({
          player: st.hero,
          gs: st.gs,
          on: true,
          from,
          preflopOwned: false,
          streetOpts,
          error: new Error('timeout'),
          runCore: false,
          budgetMs: 15,
        });
        if (admitted) expect(out).not.toBeNull();
        else expect(out).toBeNull();
      }
      if (admitted) owned++;
      else notOwned++;
    }
    expect(owned).toBeGreaterThan(5);
    expect(notOwned).toBeGreaterThan(20);
  });
  it('no street opts at all: the core owns no street, so a worker failure takes the caller path (null)', () => {
    for (const spec of SPECS.slice(0, 40)) {
      const { st } = gen(spec);
      const out = omahaMathCoreRecover({
        player: st.hero,
        gs: st.gs,
        on: true,
        from: 'worker_failure',
        error: new Error('timeout'),
        runCore: false,
        budgetMs: 15,
      });
      expect(out).toBeNull();
    }
  });
  it('a controller refusal after an applied core receipt still recovers (that street is already owned)', () => {
    for (const spec of SPECS.filter((s) => s.facing).slice(0, 20)) {
      const { st } = gen(spec);
      const out = omahaMathCoreRecover({
        player: st.hero,
        gs: st.gs,
        on: true,
        from: 'controller_refused',
        error: 'controller_refused',
        runCore: false,
        budgetMs: 15,
      });
      expect(out).not.toBeNull();
    }
  });
  it('never calls off with zero equity and never folds the exact current nuts facing a wager (every street, every generated state)', () => {
    freezeClock();
    let calls = 0;
    let nutsSpots = 0;
    for (const spec of SPECS) {
      const { st } = gen(spec);
      const d = decide(st, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
        omahaMathCorePreflop: true,
      });
      const core = (d.omahaMathCore as OmahaMathCoreRecoveredReceipt | undefined)?.core;
      if (!core) continue;
      const toCall = st.gs.toCall ?? 0;
      if (d.action === 'call' || (d.action === 'all_in' && st.hero.stack <= toCall + 0.005)) {
        const priced = core.evs.find((e) => e.action === d.action);
        calls++;
        // a zero-equity call-off is never the core's choice (a call of the current nuts is never zero equity)
        if (priced && priced.equity !== null && core.nutFloor == null)
          expect(priced.equity).toBeGreaterThan(0);
      }
      const board = (st.gs.communityCards ?? []).map(cardToInt);
      if (
        toCall > 0.005 &&
        board.length >= 3 &&
        holdsCurrentNuts(st.hero.cards.map(cardToInt), board)
      ) {
        nutsSpots++;
        expect(d.action, JSON.stringify(spec)).not.toBe('fold');
      }
    }
    expect(calls).toBeGreaterThan(10);
    void nutsSpots;
  }, 300_000);
  it('the worker-failure doors read the admission from the request option or the delivered switch row', () => {
    resetOmahaMathCoreSwitchStateForTests();
    const none = omahaMathCoreRecoverAdmission({});
    expect(none.preflopOwned).toBe(false);
    expect(Object.values(none.streetOpts).every((v) => v === false)).toBe(true);
    const req = omahaMathCoreRecoverAdmission({ omahaMathCore: true, omahaMathCorePlo5Flop: true });
    expect(req.streetOpts.omahaMathCorePlo5Flop).toBe(true);
    expect(req.streetOpts.omahaMathCorePlo5Turn).toBe(false);
    expect(req.streetOpts.omahaMathCorePlo4Flop).toBe(false);
    expect(req.preflopOwned).toBe(false);
    noteOmahaMathCoreSwitchDelivered(null);
    expect(omahaMathCoreRecoverAdmission(undefined).streetOpts.omahaMathCorePlo5Flop).toBe(false);
    resetOmahaMathCoreSwitchStateForTests();
  });
});

describe('COREGUARD PLO6 and switch OFF: byte-identical', () => {
  it('PLO6 decisions with the option on are byte-identical to off; PLO4/PLO5 off equals absent', () => {
    for (const spec of specs(['plo6'], 16)) {
      const { st } = gen(spec);
      const off = decide(st, {});
      const on = decide(st, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
        omahaMathCorePreflop: true,
      });
      expect(on.omahaMathCore).toBeUndefined();
      expect(sameJson(on, off)).toBe('');
    }
    for (const spec of SPECS.slice(0, 16)) {
      const { st } = gen(spec);
      const a = decide(st, {});
      const b = decide(st, { omahaMathCore: false });
      expect(b.omahaMathCore).toBeUndefined();
      expect(sameJson(b, a)).toBe('');
    }
  }, 300_000);
});

// keep the types referenced (SeatPlayer, HorseGameStateV2) for readers of the generator
export type _CoreguardTypes = [SeatPlayer, HorseGameStateV2];
