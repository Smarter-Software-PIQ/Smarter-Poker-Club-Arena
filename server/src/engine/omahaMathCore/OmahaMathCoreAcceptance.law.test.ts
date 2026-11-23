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
import {
  OMAHA_MATH_CORE_REALIZATION_CALIBRATION,
  OMAHA_MATH_CORE_WORK_BUDGET,
  omahaMathCoreCallDraws,
  omahaMathCoreDrawCost,
  omahaMathCoreLateDraws,
} from './OmahaMathCore.js';
import { setWiredValueForTests } from './OmahaMathCoreWire.js';

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
  /** lane CORE-POOLED-6 property law: per-seat stacks, the bettor's pot fraction, and a raise over the bet
   * (0..1 between the minimum raise and the pot); absent = the fixed grid above */
  stacks?: number[];
  frac?: number;
  raiseOver?: number;
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
  for (const s of seats)
    behind.set(s, spec.stacks?.[s - 1] ?? (spec.deep ? (s % 2 ? 600 : 450) : s % 2 ? 80 : 60));
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
        const gridFrac = [1 / 3, 0.75, 1][Math.floor(rng() * 3)];
        const frac = spec.frac ?? gridFrac;
        let raised = false;
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
          } else if (
            spec.raiseOver !== undefined &&
            !raised &&
            s !== bettor &&
            behind.get(s)! > r2(currentBet - streetBet.get(s)!) + 0.005
          ) {
            // one raise over the bet before the hero acts: sized between the minimum raise and the pot, or
            // all-in for less (an incomplete raise does not change the last full increment)
            raised = true;
            const potNow = [...total.values()].reduce((a, b) => a + b, 0);
            const minTo = r2(currentBet + lastIncrement);
            const maxTo = r2(currentBet + potNow + (currentBet - streetBet.get(s)!));
            const want = r2(minTo + spec.raiseOver * Math.max(0, maxTo - minTo));
            const to = Math.min(want, r2(streetBet.get(s)! + behind.get(s)!));
            put(s, to);
            if (to >= minTo - 0.005) lastIncrement = r2(to - currentBet);
            currentBet = to;
            bet = to;
            push(s, st, allIn.has(s) ? 'all_in' : 'raise', to, 'player');
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
      // one decision: no second look for a core-owned decision; unpriced kept B3 turn/river decisions
      // have owned: false (audit P0-2) so downstream safety doors retain full authority.
      if (omahaMathCoreOwns(d)) {
        expect(
          ServerTableEngineTurns.secondLookPlan(d, st.gs.toCall ?? 0, st.gs.pot, 2, 3000, 10000)
        ).toEqual({ ok: false, reason: 'math_core_owned' });
      } else {
        expect(rec.owned).toBe(false);
        const slp = ServerTableEngineTurns.secondLookPlan(
          d,
          st.gs.toCall ?? 0,
          st.gs.pot,
          2,
          3000,
          10000
        );
        expect(slp.ok || slp.reason !== 'math_core_owned').toBe(true);
      }
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
    const { st } = gen(SPECS.find((s) => s.street === 'flop' && s.facing)!);
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
      // lane CORE-FIX-1: the standalone run has no real incumbent (the synthetic fold is nobody's decision)
      const direct = omahaMathCoreRule(
        { action: 'fold', thinkTime: 0 },
        st.hero,
        st.gs,
        { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS, omahaMathCorePreflop: true },
        (d) => omahaMathCoreExactLegalize(d, st.hero, st.gs),
        undefined,
        'none'
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
  it('the minimal computation never reads the clock: the same draws and the same answer under any clock (lane CORE-POOLED-6)', () => {
    let worst = 0;
    for (const spec of SPECS.filter((x) => x.street !== 'preflop').slice(0, 24)) {
      const { st } = gen(spec);
      let t = 0;
      const frozen = omahaMathCoreRandomRangeEquity(st.hero, st.gs, 15, () => 0);
      const jumping = omahaMathCoreRandomRangeEquity(st.hero, st.gs, 15, () => (t += 1000));
      const t0 = performance.now();
      const real = omahaMathCoreRandomRangeEquity(st.hero, st.gs, 15);
      worst = Math.max(worst, performance.now() - t0);
      expect(jumping, JSON.stringify(spec)).toEqual(frozen);
      expect(real).toEqual(frozen);
      // the fixed work: 6,000 hand evaluations shared by the hero and his opponents
      expect(frozen.samples).toBe(Math.max(256, Math.floor(6000 / spec.n)));
    }
    console.info(`CORE-POOLED-6 recovery equity: worst wall time ${worst.toFixed(1)} ms`);
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
      // Core-owned decisions stay owned; unpriced kept B3 turn/river decisions stay owned: false (audit P0-2)
      if (spec.street === 'flop' || spec.street === 'preflop') {
        expect(omahaMathCoreOwns(b)).toBe(true);
      } else {
        expect(omahaMathCoreOwns(b)).toBe(omahaMathCoreOwns(a));
      }
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

/**
 * Lane CORE-POOLED-6 (2026-11-21, owner order: prove the core cannot emit an illegal action). The grid above
 * holds 84 states with two stack depths and three bet sizes. This law draws PROPERTY_STATES random PLO4/PLO5
 * cash states from a fixed seed: two to six seats, every street, stacks from 8 to 2,000 chips to the cent
 * (shorter than the call, shorter than the minimum raise, deeper than the pot), any bet fraction of the pot,
 * and a raise over the bet (full, or all-in for less) before the Horse acts. Each emitted action and every
 * wager the core priced is checked against pot-limit arithmetic written out here and against the engine's
 * own validator. Nothing is legalized after the fact and nothing falls back.
 */
const PROPERTY_STATES = 1500;
describe('CORE-POOLED-6 property: every action the core emits is legal pot-limit poker', () => {
  it(`on ${PROPERTY_STATES} random PLO4/PLO5 cash states the emitted action and amount sit inside min-raise, pot limit and stack; no refusal, fallback or legalization`, () => {
    const rng = rngOf(20261121);
    const streets: Street[] = ['flop', 'flop', 'flop', 'turn', 'river', 'preflop'];
    const stack = () => {
      const u = rng();
      const [lo, hi] =
        u < 0.25 ? [8, 20] : u < 0.55 ? [20, 90] : u < 0.85 ? [90, 400] : [400, 2000];
      return r2(lo + rng() * (hi - lo));
    };
    const bad: string[] = [];
    const count: Record<string, number> = {};
    let applied = 0;
    let fallbacks = 0;
    let refusals = 0;
    let legalized = 0;
    let wagers = 0;
    let shortHero = 0;
    let callOffs = 0;
    let closingCalls = 0;
    let closingMultiway = 0;
    let riverChecks = 0;
    const sane: string[] = [];
    let keptUnpriced = 0;
    const workMax: Record<number, number> = {};
    let workChecked = 0;
    let riverCheckGap = 0;
    const riverEx: string[] = [];
    let closingGap = 0;
    const arith: string[] = [];
    let changes = 0;
    const unpriced: Record<string, number> = {};
    const unpricedEx: string[] = [];
    let nutsSpots = 0;
    for (let i = 0; i < PROPERTY_STATES; i++) {
      const variant = rng() < 0.3 ? 'plo4' : 'plo5';
      const n = 2 + Math.floor(rng() * 5);
      const street = streets[Math.floor(rng() * streets.length)];
      const spec: Spec = {
        variant,
        n,
        street,
        facing: street === 'preflop' ? true : rng() < 0.65,
        deep: false,
        lightning: rng() < 0.4,
        seed: 500_000 + i,
        stacks: Array.from({ length: n }, stack),
        frac: r2(0.1 + rng() * 0.9),
        ...(rng() < 0.4 ? { raiseOver: r2(rng()) } : {}),
      };
      const { st } = gen(spec);
      const gs = st.gs;
      const hero = st.hero;
      const tag = JSON.stringify(spec);
      const d = decide(st, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
        omahaMathCorePreflop: true,
      });
      const rec = d.omahaMathCore;
      if (!rec || rec.error !== null || rec.applied !== true) {
        fallbacks++;
        bad.push(`${tag} -> ${rec ? (rec.error ?? 'not applied') : 'no receipt'}`);
        continue;
      }
      applied++;
      if (rec.core?.legalized) legalized++;
      count[d.action] = (count[d.action] ?? 0) + 1;
      const facing = gs.toCall ?? 0;
      // arithmetic of a closing heads-up call (nobody can act after it): its raw price is the hero's equity x the
      // pot he can win (the part of the wager his stack does not cover is not his to win) minus what he adds
      {
        const opp = gs.players.filter((p) => p.seat !== hero.seat);
        const callEv = rec.core!.evs.find(
          (e) => e.action === 'call' || (e.action === 'all_in' && hero.stack <= facing + 0.005)
        );
        if (
          spec.street !== 'preflop' &&
          facing > 0.005 &&
          callEv &&
          callEv.equity !== null &&
          (opp.length === 1
            ? hero.stack <= facing + 0.005 || opp[0].stack <= 0.005 || spec.street === 'river'
            : // multiway: the hero's whole stack goes in and everyone else has already matched the wager
              hero.stack <= facing + 0.005 &&
              opp.every((p) => p.bet >= gs.currentBet - 0.005 || p.stack <= 0.005))
        ) {
          const A = Math.min(facing, hero.stack);
          const uncovered = opp.reduce(
            (x, p) => x + Math.max(0, p.bet - (hero.bet + hero.stack)),
            0
          );
          if (opp.length > 1) closingMultiway++;
          const raw = (callEv as { calibration?: { raw: number } }).calibration?.raw ?? callEv.ev;
          const exact = callEv.equity * (gs.pot + A - uncovered) - A;
          closingCalls++;
          closingGap = Math.max(closingGap, Math.abs(raw - exact) / Math.max(1, gs.pot));
          if (Math.abs(raw - exact) > 0.02 + 0.005 * (gs.pot + A))
            arith.push(
              `${tag} raw ${raw} exact ${r2(exact)} eq ${callEv.equity} pot ${gs.pot} A ${A} unc ${uncovered}`
            );
        }
      }
      // every priced candidate is a sane number: finite, probabilities inside [0, 1], the chips it adds are the
      // chips the action puts in, and its value sits between losing the whole stack and winning every chip the
      // hero's stack can contest
      {
        const others = gs.players.filter((p) => p.seat !== hero.seat);
        // the receipt describes the state it priced: street, pot, the chips to call, the live opponents
        const c0 = rec.core!;
        if (c0.street !== spec.street) sane.push(`${tag}: receipt street ${c0.street}`);
        if (Math.abs(c0.pot - gs.pot) > 0.011)
          sane.push(`${tag}: receipt pot ${c0.pot} != ${gs.pot}`);
        if (
          Math.abs(c0.toCall - Math.min(facing, hero.stack)) > 0.011 &&
          Math.abs(c0.toCall - facing) > 0.011
        )
          sane.push(`${tag}: receipt toCall ${c0.toCall} != ${facing}`);
        const liveSeats = others
          .filter((p) => !p.is_folded)
          .map((p) => p.seat)
          .sort((x, y) => x - y);
        const recSeats = c0.opponents.map((o) => o.seat).sort((x, y) => x - y);
        if (JSON.stringify(liveSeats) !== JSON.stringify(recSeats))
          sane.push(`${tag}: receipt opponents ${recSeats} != ${liveSeats}`);
        // the decision is a priced candidate, or today's action kept because the core could not price it
        const chosen = c0.evs.find((e) => e.action === d.action);
        if (c0.kept?.unpriced || c0.tables === 'b3-turn-river-hud') keptUnpriced++;
        else if (!chosen)
          sane.push(`${tag}: the decision ${d.action} is not among the priced candidates`);
        const winnable = gs.pot + others.reduce((a, p) => a + Math.min(p.stack, hero.stack), 0);
        for (const e of rec.core!.evs) {
          const raw = (e as { calibration?: { raw: number } }).calibration?.raw ?? e.ev;
          const w = `${tag} ${e.action} ${e.amount ?? ''}`;
          if (![e.ev, raw, e.adds, e.foldProb].every(Number.isFinite))
            sane.push(`${w}: not finite`);
          if (e.equity !== null && !(e.equity >= 0 && e.equity <= 1))
            sane.push(`${w}: equity ${e.equity}`);
          if (!(e.foldProb >= 0 && e.foldProb <= 1)) sane.push(`${w}: foldProb ${e.foldProb}`);
          if (e.se !== null && !(e.se >= 0)) sane.push(`${w}: se ${e.se}`);
          const adds =
            e.action === 'fold' || e.action === 'check'
              ? 0
              : e.action === 'call'
                ? Math.min(facing, hero.stack)
                : e.action === 'all_in'
                  ? hero.stack
                  : (e.amount ?? 0) - hero.bet;
          if (Math.abs(e.adds - adds) > 0.011) sane.push(`${w}: adds ${e.adds} != ${r2(adds)}`);
          if (e.action === 'fold' && raw !== 0) sane.push(`${w}: fold priced ${raw}`);
          if (raw < -hero.stack - 0.011) sane.push(`${w}: ev ${raw} below -stack ${hero.stack}`);
          if (raw > winnable + 0.011) sane.push(`${w}: ev ${raw} above winnable ${r2(winnable)}`);
          if (e.action === 'call' && raw < -adds - 0.011)
            sane.push(`${w}: call ev ${raw} below -adds`);
        }
      }
      // the equity work of a decision is bounded call by call (lane CORE-FIX-1: every call takes the same draws for
      // its range count, never sized by the work spent before it): calls x the largest per-call work up to k ranges.
      // B3 turn/river fast-path (audit P0-1) skips decideOmahaMathCore (0 wire work), so wire.work is checked on
      // full-core decisions and counted as 0-work on b3-turn-river-hud fast-path receipts.
      if (rec.core!.tables === 'b3-turn-river-hud') {
        workChecked++;
      } else {
        const wire = rec.core!.wire;
        const k = gs.players.filter((p) => p.seat !== hero.seat && !p.is_folded).length;
        // every receipt carries the units it spent: without the field the bound below would check nothing
        if (!wire || typeof wire.work !== 'number')
          sane.push(`${tag}: the receipt carries no wire.work`);
        else {
          let perCall = 0;
          for (let j = 1; j <= Math.max(1, k); j++)
            // the sampler stops on a 64-draw batch boundary: at most 63 draws past the call's allowance
            perCall = Math.max(
              perCall,
              (omahaMathCoreCallDraws(j) + 63) * omahaMathCoreDrawCost(j)
            );
          const bound = wire.lateEquityCalls * perCall + 0.5;
          workChecked++;
          workMax[k] = Math.max(workMax[k] ?? 0, wire.work);
          if (wire.work > bound) sane.push(`${tag}: work ${wire.work} over ${Math.round(bound)}`);
        }
      }
      // a river check that closes the action (the hero is last, everyone checked) is equity x the pot
      // (verified via standalone recovery/core when live incumbent takes the B3 fast-path)
      if (spec.street === 'river' && facing <= 0.005 && hero.seat === spec.n) {
        const riverEvs =
          rec.core!.tables === 'b3-turn-river-hud'
            ? (omahaMathCoreRule(
                { action: 'check', thinkTime: 0 },
                hero,
                gs,
                { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS },
                (x) => omahaMathCoreExactLegalize(x, hero, gs),
                undefined,
                'none'
              ).omahaMathCore?.core?.evs ?? [])
            : rec.core!.evs;
        const chk = riverEvs.find((e) => e.action === 'check');
        if (chk && chk.equity !== null) {
          riverChecks++;
          const exact = chk.equity * gs.pot;
          riverCheckGap = Math.max(riverCheckGap, Math.abs(chk.ev - exact) / Math.max(1, gs.pot));
          if (Math.abs(chk.ev - exact) > 0.02 + 0.005 * gs.pot && riverEx.length < 6)
            riverEx.push(
              `${tag} check ev ${chk.ev} exact ${r2(exact)} eq ${chk.equity} pot ${gs.pot}`
            );
        }
      }
      // prove it to change it: a change of today's action always has today's action priced to beat
      const today = decide(st, {});
      if (today.action !== d.action) {
        changes++;
        if (!rec.core!.evs.some((e) => e.action === today.action)) {
          const k = `${today.action}->${d.action}`;
          unpriced[k] = (unpriced[k] ?? 0) + 1;
          if (unpricedEx.length < 12)
            unpricedEx.push(
              `${tag} today ${today.action} ${today.amount ?? ''} core ${d.action} ${d.amount ?? ''} toCall ${gs.toCall} stack ${hero.stack} evs ${rec.core!.evs.map((e) => e.action + ':' + (e.amount ?? '')).join(',')}`
            );
        }
      }
      // the two money invariants on the same random states: no call-off at zero equity, no fold of the nuts
      const coreRec = (rec as unknown as OmahaMathCoreRecoveredReceipt).core!;
      if (d.action === 'call' || (d.action === 'all_in' && hero.stack <= facing + 0.005)) {
        callOffs++;
        const priced = coreRec.evs.find((e) => e.action === d.action);
        if (priced && priced.equity !== null && coreRec.nutFloor == null && !(priced.equity > 0))
          bad.push(`${tag}: ${d.action} with zero equity`);
      }
      const boardInts = (gs.communityCards ?? []).map(cardToInt);
      if (
        facing > 0.005 &&
        boardInts.length >= 3 &&
        holdsCurrentNuts(hero.cards.map(cardToInt), boardInts)
      ) {
        nutsSpots++;
        if (d.action === 'fold') bad.push(`${tag}: folded the exact current nuts`);
      }
      const toCall = gs.toCall ?? 0;
      const heroTo = r2(hero.bet + hero.stack);
      const potCap = r2(gs.currentBet + gs.pot + Math.max(0, gs.currentBet - hero.bet));
      const maxTo = Math.min(potCap, heroTo);
      if (hero.stack <= toCall + 0.005) shortHero++;
      const fail = (why: string) => bad.push(`${tag} ${d.action} ${d.amount ?? ''}: ${why}`);
      const bs = calculateBettingState(
        gs.pot,
        gs.currentBet,
        hero.bet,
        gs.bigBlind,
        Math.max(2, (gs.minRaiseTo ?? 0) - gs.currentBet),
        true
      );
      const wagerOk = (action: string, amount: number, who: string) => {
        wagers++;
        if (gs.minRaiseTo == null) return fail(`${who}: a wager where none is legal`);
        if (amount < gs.minRaiseTo - 0.005)
          fail(`${who}: ${amount} under the minimum ${gs.minRaiseTo}`);
        if (amount > potCap + 0.005) fail(`${who}: ${amount} over the pot limit ${potCap}`);
        if (amount > heroTo + 0.005) fail(`${who}: ${amount} over the stack ${heroTo}`);
        if (amount > (gs.maxRaiseTo ?? Infinity) + 0.005)
          fail(`${who}: over maxRaiseTo ${gs.maxRaiseTo}`);
        if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
          fail(`${who}: not a whole cent`);
        if (!validateAction(action as 'bet', amount, hero.stack, bs).valid)
          fail(`${who}: validator refuses`);
      };
      if (d.action !== rec.action || (d.amount ?? null) !== rec.amount)
        fail('decision is not the receipt');
      if (d.action === 'fold') {
        if (toCall <= 0) fail('fold with nothing to call');
      } else if (d.action === 'check') {
        if (toCall > 0) fail('check facing a wager');
      } else if (d.action === 'call') {
        if (toCall <= 0) fail('call with nothing to call');
        if (d.amount != null && Math.abs(d.amount - Math.min(toCall, hero.stack)) > 0.005)
          fail(`call amount is not min(toCall ${toCall}, stack ${hero.stack})`);
      } else if (d.action === 'bet' || d.action === 'raise') {
        if ((d.action === 'bet') !== toCall <= 0) fail('bet/raise does not match the facing state');
        if (d.amount == null) fail('wager without an amount');
        else wagerOk(d.action, d.amount, 'decision');
      } else if (d.action === 'all_in') {
        if (hero.stack <= 0) fail('all-in without chips');
        if (d.amount != null && d.amount > heroTo + 0.005) fail('all-in over the stack');
        // an all-in that raises must fit the pot limit; an all-in for the call or less always fits
        if (heroTo > gs.currentBet + 0.005 && heroTo > potCap + 0.005)
          fail(`all-in ${heroTo} over the pot limit ${potCap}`);
      } else fail('unknown action');
      for (const a of rec.core!.evs) {
        if (a.action !== 'bet' && a.action !== 'raise') continue;
        if (a.amount == null) {
          fail(`priced ${a.action} without an amount`);
          continue;
        }
        wagerOk(a.action, a.amount, `priced ${a.action}`);
        if (a.amount > maxTo + 0.005) fail(`priced ${a.action} ${a.amount} over ${maxTo}`);
      }
      if (
        horseDecisionReceiptRefusal(structuredClone(d), spec.variant, {
          player: hero,
          gameState: gs,
          omahaMathCore: true,
          ...OMAHA_MATH_CORE_ALL_STREETS,
        }) !== null
      )
        refusals++;
    }
    console.info(
      `CORE-POOLED-6 property: states=${PROPERTY_STATES} applied=${applied} fallbacks=${fallbacks} refusals=${refusals} legalized=${legalized} wagersChecked=${wagers} shortHero=${shortHero} callOffs=${callOffs} nutsSpots=${nutsSpots} actions=${JSON.stringify(count)} bad=${bad.length}`
    );
    console.info(
      `CORE-POOLED-6 property: changes=${changes} unpricedIncumbent=${JSON.stringify(unpriced)}\n${unpricedEx.join('\n')}`
    );
    console.info(
      `CORE-POOLED-6 property: closingCalls=${closingCalls} (multiway ${closingMultiway}) worst |raw-exact|/pot=${closingGap.toFixed(4)} over=${arith.length}\n${arith.slice(0, 8).join('\n')}`
    );
    console.info(
      `CORE-POOLED-6 property: riverChecks=${riverChecks} worst gap/pot=${riverCheckGap.toFixed(4)}\n${riverEx.join('\n')}`
    );
    console.info(
      `CORE-POOLED-6 property: sane violations=${sane.length} keptUnpriced=${keptUnpriced} workMaxByOpponents=${JSON.stringify(workMax)}\n${sane.slice(0, 12).join('\n')}`
    );
    if (bad.length)
      console.info(`CORE-POOLED-6 property failures (first 25):\n${bad.slice(0, 25).join('\n')}`);
    expect(bad).toEqual([]);
    expect(fallbacks).toBe(0);
    expect(refusals).toBe(0);
    expect(legalized).toBe(0);
    expect(applied).toBe(PROPERTY_STATES);
    expect(wagers).toBeGreaterThan(1000);
    expect(callOffs).toBeGreaterThan(100);
    // a closing heads-up call is priced at equity x the pot the hero can win, minus what he adds
    expect(arith).toEqual([]);
    expect(closingCalls).toBeGreaterThan(20);
    // a river check that closes the action is priced at equity x the pot
    expect(sane).toEqual([]);
    expect(workChecked).toBe(applied);
    expect(riverEx).toEqual([]);
    expect(riverChecks).toBeGreaterThan(10);
    // every change the core made had today's action priced among its candidates (prove it to change it)
    expect(unpriced).toEqual({});
    expect(changes).toBeGreaterThan(100);
  }, 1_800_000);
});

/**
 * Lane CORE-POOLED-6 (2026-11-21). Found in the owner-ordered sweep: a call of an all-in wager by a covering hero
 * (no live opponent with chips behind) is an exact showdown, yet OmahaMathCoreValue.ts gave it a showdown term, so
 * the PLO5 flop call realization factor (0.81) discounted it: the core priced calling a shove as if 19% of the
 * equity were lost to later play that cannot happen. The hero-all-in call was already exempt; this one was not.
 */
describe('CORE-POOLED-6: the work budget charges a draw by the seats it draws', () => {
  it('heads-up is charged 1 per draw; every call (lane CORE-FIX-1: first or last) gets 2,400 / 750 / 312 / 150 / 150 draws against 1 to 5 ranges', () => {
    expect(omahaMathCoreDrawCost(1)).toBe(1);
    expect(omahaMathCoreLateDraws(1)).toBe(600);
    expect(OMAHA_MATH_CORE_WORK_BUDGET).toBe(12000);
    expect([1, 2, 3, 4, 5].map(omahaMathCoreCallDraws)).toEqual([2400, 750, 312, 150, 150]);
    // more seats never get more draws, and the late floor never goes under 150
    for (let k = 1; k < 8; k++) {
      expect(omahaMathCoreDrawCost(k + 1)).toBeGreaterThan(omahaMathCoreDrawCost(k));
      expect(omahaMathCoreLateDraws(k + 1)).toBeLessThanOrEqual(omahaMathCoreLateDraws(k));
      expect(omahaMathCoreLateDraws(k)).toBeGreaterThanOrEqual(150);
    }
    expect(omahaMathCoreDrawCost(0)).toBe(1);
  });
});

describe('CORE-POOLED-6: a call that closes the hand is priced at its exact showdown value', () => {
  it('heads-up PLO5 flop, the bettor all-in and covered by the hero: the call carries no realization discount', () => {
    let closing = 0;
    let positive = 0;
    for (let i = 0; i < 600 && closing < 80; i++) {
      const short = r2(9 + (i % 10)); // 3 to 12 chips behind on the flop; a pot-size bet (12) puts all of it in
      const mk = (stacks: number[]): Spec => ({
        variant: 'plo5',
        n: 2,
        street: 'flop',
        facing: true,
        deep: false,
        lightning: i % 2 === 0,
        seed: 700_000 + i,
        stacks,
        frac: 1,
      });
      let st = gen(mk([short, 400])).st;
      const closes = (s: typeof st) =>
        Math.abs((s.gs.toCall ?? 0) - (short - 6)) < 0.005 && s.hero.stack > (s.gs.toCall ?? 0) + 1;
      if (!closes(st)) st = gen(mk([400, short])).st;
      if (!closes(st)) continue;
      const d = decide(st, { omahaMathCore: true, omahaMathCorePlo5Flop: true });
      const rec = d.omahaMathCore;
      expect(rec?.applied, String(i)).toBe(true);
      const call = rec!.core!.evs.find((e) => e.action === 'call');
      if (!call) continue;
      closing++;
      // the legal answers are fold and call only (nobody is left to raise)
      expect(rec!.core!.evs.some((e) => e.action === 'raise' || e.action === 'bet')).toBe(false);
      const cal = (call as { calibration?: { raw: number } }).calibration;
      if (cal)
        expect(
          Math.abs(cal.raw - call.ev),
          `state ${i}: raw ${cal.raw} priced ${call.ev}`
        ).toBeLessThan(0.006);
      if (call.ev > 0.5) positive++;
    }
    console.info(
      `CORE-POOLED-6 closing call: states=${closing} with a call worth more than 0.5 chips=${positive}`
    );
    expect(closing).toBeGreaterThanOrEqual(40);
    expect(positive).toBeGreaterThan(5);
  }, 300_000);

  it('the one-step fallback path too: with the plan path off, the closing call is priced the same with and without the PLO5 flop factors', () => {
    const streets = OMAHA_MATH_CORE_REALIZATION_CALIBRATION.streets;
    const shipped = streets.plo5;
    let closing = 0;
    let open = 0;
    let openDiscounted = 0;
    setWiredValueForTests(false);
    try {
      for (let i = 0; i < 400 && closing < 40; i++) {
        const short = r2(9 + (i % 10));
        const mk = (stacks: number[]): Spec => ({
          variant: 'plo5',
          n: 2,
          street: 'flop',
          facing: true,
          deep: false,
          lightning: false,
          seed: 710_000 + i,
          stacks,
          frac: 1,
        });
        const callOf = (st: ReturnType<typeof stateAt>, factors: boolean) => {
          streets.plo5 = factors ? shipped : [];
          const d = decide(st, { omahaMathCore: true, omahaMathCorePlo5Flop: true });
          return d.omahaMathCore?.core?.evs.find((e) => e.action === 'call');
        };
        // closing: the bettor is all-in and the hero covers
        let st = gen(mk([short, 400])).st;
        const closes = (s: typeof st) =>
          Math.abs((s.gs.toCall ?? 0) - (short - 6)) < 0.005 &&
          s.hero.stack > (s.gs.toCall ?? 0) + 1;
        if (!closes(st)) st = gen(mk([400, short])).st;
        if (closes(st)) {
          const withF = callOf(st, true);
          const without = callOf(st, false);
          if (withF && without) {
            closing++;
            expect(withF.ev, `closing state ${i}`).toBe(without.ev);
          }
        }
        // control: the same deal with both stacks deep is NOT closing, and there the factor does discount the call
        const deep = gen(mk([400, 400])).st;
        const dWith = callOf(deep, true);
        const dWithout = callOf(deep, false);
        if (dWith && dWithout) {
          open++;
          if (dWith.ev < dWithout.ev - 0.005) openDiscounted++;
        }
      }
    } finally {
      streets.plo5 = shipped;
      setWiredValueForTests(true);
    }
    console.info(
      `CORE-POOLED-6 closing call, one-step path: closing=${closing} open=${open} openDiscounted=${openDiscounted}`
    );
    expect(closing).toBeGreaterThanOrEqual(20);
    expect(openDiscounted).toBeGreaterThan(5);
  }, 300_000);
});
