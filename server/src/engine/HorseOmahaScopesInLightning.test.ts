/**
 * omahaSlowplayMixInLightning and omahaPublicBetSizeInLightning (PLO Strategy lane 2026-11-19, both default OFF).
 *
 * Two scope options, each its own switch, built as omahaPricedInLightning (HorseOmahaPricedInLightning.test.ts):
 * omahaStrongHandSlowplayMix and omahaBetSizeByPublicState each refuse a Lightning pool
 * (gs.publicMemoryDomain.speed === 'lightning') by a speed test; each scope option lifts that one refusal for the
 * one rule it names, and only when that rule's OWN option is on.
 *
 * Proved here, for each option:
 *  - OFF (unset, false, a non-boolean): in Lightning the rule changes no decision (the code before the option);
 *  - ON outside Lightning: no decision changes;
 *  - ON with the rule's own option off: nothing changes in Lightning;
 *  - ON in Lightning: the rule reaches the Lightning decision path (its receipts fire, decisions change) and it
 *    makes there only what it makes at a table (raise -> call, flop bet -> check; a size, never an action);
 *  - the receipt validator admits in Lightning exactly what the decision path can now emit there: the mix's two
 *    conversions only under the decision's own omahaSlowplayMixInLightning; the public size needs no admission
 *    (its wager is still a bet, a raise or the all-in the legalizer makes of it);
 *  - neither option opens the other's rule.
 * And on the recorded PLO4/PLO5 cash decisions (horseComplaints fixtures): both options false or unset are the same
 * decisions in Lightning, both options true are the same decisions at a table.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { saveFastRandom, seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import {
  omahaSlowplayAdmitsCall,
  omahaSlowplayAdmitsCheck,
  omahaSlowplayAdmitsCheckWithRequest,
  omahaSlowplayCallScope,
  omahaSlowplayCheckScope,
} from './HorseOmahaStrongHandSlowplayMix.js';
import {
  SLOWPLAY_RELEASE_SET,
  slowplayDecide,
  slowplayState,
  type SlowplaySpot,
} from './HorseOmahaStrongHandSlowplayMix.test-support.js';
import { seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import {
  horseDecisionReceiptRefusal,
  horseDecisionReceiptRefusalForGates,
  omahaSlowplayMixInLightningGateCandidates,
} from './horseDecision/responseValidation.js';
import { OPTION_SWITCH_REGISTRY } from './HorseOptionSwitch.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

function lightningOf(gs: HorseGameStateV2): void {
  (gs as unknown as { publicMemoryDomain: object }).publicMemoryDomain = {
    version: 1,
    speed: 'lightning',
    ante: 'bb',
  };
}
const answer = (d: HorseDecision) => JSON.stringify([d.action, d.amount ?? null]);
const firesOf = () =>
  drainFires()
    .filter((f) => f.fires > 0)
    .map((f) => f.feature);

// ─────────────────────────── omahaSlowplayMixInLightning ───────────────────────────

const RELEASE = SLOWPLAY_RELEASE_SET;
const MIX: HorseDecideOpts = { ...RELEASE, omahaStrongHandSlowplayMix: true };
const MIX_IN_LIGHTNING: HorseDecideOpts = { ...MIX, omahaSlowplayMixInLightning: true };
const MIX_SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + 7919 * i);
const facing = (hole: string, board: string, more: Partial<SlowplaySpot> = {}): SlowplaySpot => ({
  hole,
  board,
  opponents: [1],
  position: 'ip',
  bettor: 1,
  betFrac: 1,
  ...more,
});
const lead = (hole: string, board: string, more: Partial<SlowplaySpot> = {}): SlowplaySpot => ({
  hole,
  board,
  opponents: [1],
  position: 'oop',
  ...more,
});
/** The two spots of the mix (facing a bet with a nut-class hand; a set on a very dry flop) and spots outside them. */
const MIX_SPOTS: SlowplaySpot[] = [
  facing('KsKdQc9s5h', 'Kh8c3d'),
  facing('KsKcJd6s4h', 'Kh8c3d'),
  facing('AhQhJc9s5d', 'Kh8h3h', { position: 'oop' }),
  facing('KsKdQc9s5h', 'Kh8c8d3s'),
  facing('AhQhJc7s5d', 'Kh8c3h2h9s'),
  lead('KsKdQc9s5h', 'Kh8c3d'),
  lead('KdKcTs7h2c', 'Kh8c3d'),
  lead('3s3cQc9s5h', 'Kh8c3d', { position: 'ip' }),
  lead('9s9dQc3s2h', '9h8h6c'),
  { ...facing('KsKdQc9', 'Kh8c3d'), variant: 'plo4' as const },
  { ...lead('KsKdQc9', 'Kh8c3d'), variant: 'plo4' as const },
];
const mixState = (spot: SlowplaySpot, lightning: boolean) => {
  const st = slowplayState(spot);
  if (lightning) lightningOf(st.gs);
  return st;
};
/** Every spot at every seed: the answer and the strategy stream after it. */
function mixRun(opts: HorseDecideOpts, lightning: boolean): string[] {
  const out: string[] = [];
  for (const spot of MIX_SPOTS) {
    const st = mixState(spot, lightning);
    for (const seed of MIX_SEEDS) {
      const d = slowplayDecide(st, opts, seed);
      out.push(JSON.stringify([d.action, d.amount ?? null, saveFastRandom()]));
    }
  }
  return out;
}

describe('omahaSlowplayMixInLightning: the slowplay mix in the Lightning pools', () => {
  it("the scope: Lightning is outside the mix's two spots unless the option is on; a table is the same either way", () => {
    let callSpots = 0;
    let checkSpots = 0;
    for (const spot of MIX_SPOTS) {
      const table = mixState(spot, false);
      const pool = mixState(spot, true);
      const call = omahaSlowplayCallScope(table.hero, table.gs);
      const check = omahaSlowplayCheckScope(table.hero, table.gs);
      expect(omahaSlowplayCallScope(table.hero, table.gs, true)).toEqual(call);
      expect(omahaSlowplayCheckScope(table.hero, table.gs, true)).toEqual(check);
      expect(omahaSlowplayCallScope(pool.hero, pool.gs)).toBeNull();
      expect(omahaSlowplayCallScope(pool.hero, pool.gs, false)).toBeNull();
      expect(omahaSlowplayCheckScope(pool.hero, pool.gs)).toBeNull();
      expect(omahaSlowplayCheckScope(pool.hero, pool.gs, false)).toBeNull();
      expect(omahaSlowplayCallScope(pool.hero, pool.gs, true)).toEqual(call);
      expect(omahaSlowplayCheckScope(pool.hero, pool.gs, true)).toEqual(check);
      if (call) callSpots++;
      if (check) checkSpots++;
    }
    expect(callSpots).toBeGreaterThanOrEqual(4);
    expect(checkSpots).toBeGreaterThanOrEqual(3);
  });

  it('OFF: in Lightning the mix changes no decision and no stream position (unset, false, a non-boolean)', () => {
    const base = mixRun(RELEASE, true);
    expect(mixRun(MIX, true)).toEqual(base);
    expect(mixRun({ ...MIX, omahaSlowplayMixInLightning: false }, true)).toEqual(base);
    expect(mixRun({ ...MIX, omahaSlowplayMixInLightning: 1 as unknown as boolean }, true)).toEqual(
      base
    );
  });

  it('ON outside Lightning: every decision is the one without it', () => {
    expect(mixRun(MIX_IN_LIGHTNING, false)).toEqual(mixRun(MIX, false));
  });

  it('ON with the mix off, and the other scope option alone: nothing changes in Lightning', () => {
    const base = mixRun(RELEASE, true);
    expect(mixRun({ ...RELEASE, omahaSlowplayMixInLightning: true }, true)).toEqual(base);
    expect(mixRun({ ...MIX, omahaPublicBetSizeInLightning: true }, true)).toEqual(base);
    expect(mixRun({ ...MIX, omahaPricedInLightning: true }, true)).toEqual(base);
  });

  it('ON in Lightning: the mix makes its raise -> call and its bet -> check there, and nothing else', () => {
    enableBrainTelemetry();
    let calls = 0;
    let checks = 0;
    let scopeSeen = 0;
    for (const spot of MIX_SPOTS) {
      const st = mixState(spot, true);
      for (const seed of MIX_SEEDS) {
        const before = slowplayDecide(st, RELEASE, seed);
        const stream = saveFastRandom();
        drainFires();
        const d = slowplayDecide(st, { ...MIX_IN_LIGHTNING, telemetry: true }, seed);
        expect(saveFastRandom()).toBe(stream);
        const fires = firesOf();
        const called = fires.includes('omaha_strong_hand_slowplay_call');
        const checked = fires.includes('omaha_strong_hand_slowplay_check');
        if (fires.includes('omaha_slowplay_mix_in_lightning_scope_seen')) scopeSeen++;
        if (called || checked)
          expect(fires).toContain('omaha_slowplay_mix_in_lightning_scope_seen');
        if (called) {
          calls++;
          expect(['raise', 'all_in']).toContain(before.action);
          expect(d.action).toBe('call');
          expect(d.amount).toBeCloseTo(st.gs.toCall as number, 9);
        } else if (checked) {
          checks++;
          expect(before.action).toBe('bet');
          expect(d.action).toBe('check');
        } else expect(answer(d)).toBe(answer(before));
        // off: neither the mix's receipts nor the scope receipt in Lightning
        drainFires();
        slowplayDecide(st, { ...MIX, telemetry: true }, seed);
        expect(firesOf().filter((f) => f.includes('slowplay'))).toEqual([]);
      }
    }
    expect(calls).toBeGreaterThan(0);
    expect(checks).toBeGreaterThan(0);
    expect(scopeSeen).toBeGreaterThanOrEqual(calls + checks);
    // at a table the scope receipt never fires
    drainFires();
    const table = mixState(MIX_SPOTS[0], false);
    for (const seed of MIX_SEEDS)
      slowplayDecide(table, { ...MIX_IN_LIGHTNING, telemetry: true }, seed);
    expect(firesOf()).not.toContain('omaha_slowplay_mix_in_lightning_scope_seen');
  });
});

type Step = { node: string; before?: { action: string } | null; after: { action: string } };
/** The policy graph's own wager_rules step of a decision, as 'raise>call' (the transition the validator reads). */
const wagerStep = (d: HorseDecision): string => {
  const steps = (d as unknown as { policyGraph?: { transitions?: Step[] } }).policyGraph
    ?.transitions;
  const step = steps?.find((t) => t.node === 'wager_rules');
  return `${step?.before?.action ?? ''}>${step?.after.action ?? ''}`;
};
/**
 * The first Lightning decision of the spot the mix converted INSIDE the graph's wager_rules node (its receipt
 * fired and the recorded step is `step`): the transition the validator has to admit. (Where the mix already
 * acted on the reference decision the graph records no conversion and the validator has nothing to admit.)
 */
function converted(spot: SlowplaySpot, receipt: string, step: string) {
  enableBrainTelemetry();
  const st = mixState(spot, true);
  for (const seed of Array.from({ length: 80 }, (_, i) => 1000 + 7919 * i)) {
    drainFires();
    const d = slowplayDecide(st, { ...MIX_IN_LIGHTNING, telemetry: true }, seed);
    if (firesOf().includes(receipt) && wagerStep(d) === step) return { st, d };
  }
  throw new Error(`no ${receipt} with ${step} in 80 seeds`);
}
const TURN_TOP_FULL = facing('KsKdQc9s5h', 'Kh8c8d3s');

describe('omahaSlowplayMixInLightning: the receipt validator', () => {
  it("the raise that became the call in Lightning is admitted only under the decision's own option, for the exact chips, with a nut-class hand", () => {
    // the turn, a top full house facing a pot bet (on the flop another admission of the validator, one with no
    // speed test, already covers the raise that became the call; on the turn only the mix's does)
    const { st, d } = converted(TURN_TOP_FULL, 'omaha_strong_hand_slowplay_call', 'raise>call');
    const paid = st.gs.toCall as number;
    expect({ action: d.action, amount: d.amount }).toEqual({ action: 'call', amount: paid });
    const ctx = { player: st.hero, gameState: st.gs };
    expect(omahaSlowplayAdmitsCall(st.hero, st.gs, paid)).toBe(false);
    expect(omahaSlowplayAdmitsCall(st.hero, st.gs, paid, false)).toBe(false);
    expect(omahaSlowplayAdmitsCall(st.hero, st.gs, paid, true)).toBe(true);
    expect(horseDecisionReceiptRefusal(structuredClone(d), 'plo5', ctx)).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaSlowplayMixInLightning: true,
      })
    ).toBeNull();
    // the other Lightning scope does not admit it
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaPricedInLightning: true,
      })
    ).toBe('policy_graph');
    // no wider than the decision path: not for other chips, not for a hand that is not nut class
    expect(omahaSlowplayAdmitsCall(st.hero, st.gs, paid + 1, true)).toBe(false);
    const weak = mixState(facing('QsQdJc9s5h', 'Kh8c8d3s'), true);
    expect(omahaNutClassNow(weak.hero, weak.gs)).toBe(false);
    expect(omahaSlowplayAdmitsCall(weak.hero, weak.gs, weak.gs.toCall as number, true)).toBe(false);
    // at a table: as before, with or without the gate
    const table = mixState(TURN_TOP_FULL, false);
    expect(omahaSlowplayAdmitsCall(table.hero, table.gs, table.gs.toCall as number)).toBe(true);
    expect(omahaSlowplayAdmitsCall(table.hero, table.gs, table.gs.toCall as number, true)).toBe(
      true
    );
  });

  it("the flop bet that became the check in Lightning: the mix's own admission opens only under the option, only in its spot", () => {
    const { st, d } = converted(
      lead('KsKdQc9s5h', 'Kh8c3d'),
      'omaha_strong_hand_slowplay_check',
      'bet>check'
    );
    expect(d.action).toBe('check');
    const ctx = { player: st.hero, gameState: st.gs };
    expect(horseDecisionReceiptRefusal(structuredClone(d), 'plo5', ctx)).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaPricedInLightning: true,
      })
    ).toBe('policy_graph');
    expect(omahaSlowplayAdmitsCheck(st.hero, st.gs)).toBe(false);
    expect(omahaSlowplayAdmitsCheck(st.hero, st.gs, true)).toBe(true);
    expect(omahaSlowplayAdmitsCheckWithRequest('plo5', ctx)).toBe(false);
    expect(omahaSlowplayAdmitsCheckWithRequest('plo5', ctx, false)).toBe(false);
    expect(omahaSlowplayAdmitsCheckWithRequest('plo5', ctx, true)).toBe(true);
    expect(omahaSlowplayAdmitsCheckWithRequest('plo5', undefined, true)).toBe(false);
    expect(omahaSlowplayAdmitsCheckWithRequest('plo4', ctx, true)).toBe(false);
    // the decision the path emitted is admitted only under the decision's own option
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaSlowplayMixInLightning: true,
      })
    ).toBeNull();
    // outside the spot (a wet flop) the option admits nothing
    const wet = mixState(lead('9s9dQc3s2h', '9h8h6c'), true);
    expect(omahaSlowplayAdmitsCheck(wet.hero, wet.gs, true)).toBe(false);
  });

  it('under the candidate gates: unchanged without the new argument, admitted when the option may have been on', () => {
    const { st, d } = converted(TURN_TOP_FULL, 'omaha_strong_hand_slowplay_call', 'raise>call');
    const ctx = { player: st.hero, gameState: st.gs };
    const run = (priced?: readonly boolean[], slowplay?: readonly boolean[]) =>
      horseDecisionReceiptRefusalForGates(
        structuredClone(d),
        'plo5',
        ctx,
        [false],
        [false],
        priced,
        slowplay
      );
    expect(run()).toBe('policy_graph');
    expect(run([false])).toBe('policy_graph');
    expect(run([false, true])).toBe('policy_graph');
    expect(run([false], [false])).toBe('policy_graph');
    expect(run([false], [])).toBe('policy_graph');
    expect(run([false], [false, true])).toBeNull();
    expect(run([false], [true])).toBeNull();
  });

  it('the candidates: the request alone, a bad configuration, a truthy non-boolean', () => {
    expect(omahaSlowplayMixInLightningGateCandidates(undefined, null)).toEqual([false]);
    expect(
      omahaSlowplayMixInLightningGateCandidates({ omahaSlowplayMixInLightning: true }, null)
    ).toEqual([true]);
    expect(
      omahaSlowplayMixInLightningGateCandidates({ omahaSlowplayMixInLightning: 1 }, null)
    ).toEqual([false]);
    expect(omahaSlowplayMixInLightningGateCandidates({}, { nonsense: true })).toEqual([false]);
  });
});

// ─────────────────────────── omahaPublicBetSizeInLightning ───────────────────────────

const FX = SET_LEADS as unknown as ComplaintFixture;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const RANKS = '23456789TJQKA'.split('') as CardRank[];
const SUITS: CardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const key = (c: Card) => `${c.rank}${c.suit[0]}`;

function sizeSpot(ord: number, lightning: boolean, hole?: Card[]) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  const node = fx.actions.find((a) => a.ord === ord)!;
  if (hole) fx.hole[String(node.seat)] = hole;
  const st = stateAt(fx, node);
  if (lightning) lightningOf(st.gs);
  return st;
}
/** Different five-card hands that do not use a board card (HorseBetSizeByPublicState.test.ts). */
function hands(ord: number, n: number): Card[][] {
  const board = new Set(sizeSpot(ord, false).gs.communityCards.map(key));
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
const SIZE: HorseDecideOpts = { omahaBetSizeByPublicState: true };
const SIZE_IN_LIGHTNING: HorseDecideOpts = { ...SIZE, omahaPublicBetSizeInLightning: true };
const SIZE_SEEDS = [7, 77, 777, 7777, 77777, 777777];
/** A decision without its wall-clock stamps (the policy graph times each step). */
const stable = (d: unknown): unknown =>
  JSON.parse(
    JSON.stringify(d, (k, v) => (/^(elapsed|latency|compute)Ms$/.test(k) ? undefined : v))
  );
const wager = (a: string) => a === 'bet' || a === 'raise';
function sizeDecide(
  st: ReturnType<typeof sizeSpot>,
  opts: HorseDecideOpts,
  i: number
): HorseDecision {
  seedHorseBetSizeRandom(SIZE_SEEDS[i % SIZE_SEEDS.length]);
  seedFastRandom(1000 + i);
  HorseMind.reset();
  return structuredClone(
    HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { mind: false, ...opts })
  );
}

describe.each([
  { name: 'turn, first to act', ord: 18 },
  { name: 'flop, facing a bet', ord: 16 },
])('omahaPublicBetSizeInLightning: $name', ({ ord }) => {
  const HANDS = hands(ord, 60);

  it('OFF: in Lightning the public size changes nothing (unset, false, a non-boolean), byte for byte', () => {
    HANDS.forEach((hole, i) => {
      const st = sizeSpot(ord, true, hole);
      const base = stable(sizeDecide(st, {}, i));
      expect(stable(sizeDecide(st, SIZE, i))).toEqual(base);
      expect(stable(sizeDecide(st, { ...SIZE, omahaPublicBetSizeInLightning: false }, i))).toEqual(
        base
      );
      expect(
        stable(
          sizeDecide(st, { ...SIZE, omahaPublicBetSizeInLightning: 1 as unknown as boolean }, i)
        )
      ).toEqual(base);
      // the option alone, and the other scope options, do not open it
      expect(stable(sizeDecide(st, { omahaPublicBetSizeInLightning: true }, i))).toEqual(base);
      expect(stable(sizeDecide(st, { ...SIZE, omahaSlowplayMixInLightning: true }, i))).toEqual(
        base
      );
    });
  });

  it('ON outside Lightning: every decision is the one without it, byte for byte', () => {
    HANDS.forEach((hole, i) => {
      const st = sizeSpot(ord, false, hole);
      expect(stable(sizeDecide(st, SIZE_IN_LIGHTNING, i))).toEqual(stable(sizeDecide(st, SIZE, i)));
    });
  });

  it('ON in Lightning: the size is the public size of the same spot at a table; the action is never changed; the validator admits it as it is', () => {
    enableBrainTelemetry();
    let wagers = 0;
    let resized = 0;
    let sameAsTable = 0;
    HANDS.forEach((hole, i) => {
      const st = sizeSpot(ord, true, hole);
      const off = sizeDecide(st, SIZE, i);
      drainFires();
      const on = sizeDecide(st, { ...SIZE_IN_LIGHTNING, telemetry: true }, i);
      const seen = drainFires().filter(
        (f) => f.feature === 'omaha_public_bet_size_in_lightning_scope_seen'
      );
      // the receipt: at most once per decision, and whenever a public-size receipt fired
      expect(seen.reduce((n, f) => n + f.fires, 0)).toBeLessThanOrEqual(1);
      // never a check into a bet, a call into a raise, or back; a wager whose public size is every chip is the all-in
      if (wager(off.action) && on.action === 'all_in') {
        wagers++;
        resized++;
        expect(seen.length).toBe(1);
      } else {
        expect(on.action, hole.map(key).join('')).toBe(off.action);
        if (!wager(on.action)) expect(on.amount ?? null).toBe(off.amount ?? null);
        else {
          wagers++;
          expect(seen.length).toBe(1);
          if (on.amount !== off.amount) resized++;
          // the same public spot at a table draws the same size from the same public stream
          const tableSt = sizeSpot(ord, false, hole);
          const table = sizeDecide(tableSt, SIZE, i);
          if (table.action === on.action) {
            expect(on.amount, hole.map(key).join('')).toBe(table.amount);
            sameAsTable++;
          }
        }
      }
      // no admission was added: the validator, with no gate at all, admits what the path emitted
      expect(
        horseDecisionReceiptRefusal(structuredClone(on), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
      // off, and at a table: the scope receipt never fires
      drainFires();
      sizeDecide(st, { ...SIZE, telemetry: true }, i);
      sizeDecide(sizeSpot(ord, false, hole), { ...SIZE_IN_LIGHTNING, telemetry: true }, i);
      expect(firesOf()).not.toContain('omaha_public_bet_size_in_lightning_scope_seen');
    });
    expect(wagers).toBeGreaterThan(5);
    expect(resized).toBeGreaterThan(0);
    expect(sameAsTable).toBeGreaterThan(0);
  });
});

// ─────────────────────────── both, on the recorded decisions ───────────────────────────

const DIR = resolve(process.cwd(), 'src/engine/horseComplaints');
const FIXTURES: ComplaintFixture[] = readdirSync(DIR)
  .filter((f) => /^plo[45]-.*\.fixture\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as ComplaintFixture)
  .filter((fx) => fx.fmt === 'cash');
const NODES = FIXTURES.flatMap((fx) =>
  fx.actions
    .filter((a) => a.publicNode && fx.hole[String(a.publicNode.actorSeat ?? a.seat)]?.length)
    .map((a) => ({
      name: `${fx.slug}#${a.ord}`,
      build: (lightning: boolean) => {
        const st = stateAt(JSON.parse(JSON.stringify(fx)) as ComplaintFixture, a);
        if (lightning) lightningOf(st.gs);
        return st;
      },
    }))
);
const RULES_ON: HorseDecideOpts = {
  ...RELEASE,
  omahaStrongHandSlowplayMix: true,
  omahaBetSizeByPublicState: true,
};
const RULES_OFF: HorseDecideOpts = {
  ...RELEASE,
  omahaStrongHandSlowplayMix: false,
  omahaBetSizeByPublicState: false,
};
const BOTH = { omahaSlowplayMixInLightning: true, omahaPublicBetSizeInLightning: true };
const NEITHER = { omahaSlowplayMixInLightning: false, omahaPublicBetSizeInLightning: false };
const CORPUS_SEEDS = [11, 23];
function corpusDecide(
  node: (typeof NODES)[number],
  lightning: boolean,
  opts: HorseDecideOpts,
  seed: number
): string {
  const st = node.build(lightning);
  seedHorseBetSizeRandom(seed);
  seedFastRandom(seed);
  HorseMind.reset();
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { mind: false, ...opts });
  return JSON.stringify([d.action, d.amount ?? null, saveFastRandom()]);
}

describe('the two Lightning scope options on the recorded PLO4/PLO5 cash decisions', () => {
  it('the corpus is real PLO4/PLO5 cash decisions', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(8);
    expect(NODES.length).toBeGreaterThanOrEqual(20);
  });

  it('OFF in Lightning (unset and false) the two rules change no decision; ON at a table nothing changes; ON without the rules nothing changes', () => {
    for (const n of NODES)
      for (const seed of CORPUS_SEEDS) {
        const lightningBase = corpusDecide(n, true, RULES_OFF, seed);
        expect(corpusDecide(n, true, RULES_ON, seed), n.name).toBe(lightningBase);
        expect(corpusDecide(n, true, { ...RULES_ON, ...NEITHER }, seed), n.name).toBe(
          lightningBase
        );
        expect(corpusDecide(n, true, { ...RULES_OFF, ...BOTH }, seed), n.name).toBe(lightningBase);
        expect(corpusDecide(n, false, { ...RULES_ON, ...BOTH }, seed), n.name).toBe(
          corpusDecide(n, false, RULES_ON, seed)
        );
      }
  });

  it('each option opens only its own rule in Lightning', () => {
    let sizeOnly = 0;
    for (const n of NODES) {
      const seed = CORPUS_SEEDS[0];
      // the public size's scope with only the mix on, and the mix's scope with only the size on: nothing
      const mixOnly: HorseDecideOpts = { ...RELEASE, omahaStrongHandSlowplayMix: true };
      const sizeOnlyOpts: HorseDecideOpts = { ...RELEASE, omahaBetSizeByPublicState: true };
      const base = corpusDecide(n, true, RELEASE, seed);
      expect(
        corpusDecide(n, true, { ...mixOnly, omahaPublicBetSizeInLightning: true }, seed),
        n.name
      ).toBe(base);
      expect(
        corpusDecide(n, true, { ...sizeOnlyOpts, omahaSlowplayMixInLightning: true }, seed),
        n.name
      ).toBe(base);
      if (
        corpusDecide(n, true, { ...sizeOnlyOpts, omahaPublicBetSizeInLightning: true }, seed) !==
        base
      )
        sizeOnly++;
    }
    expect(sizeOnly).toBeGreaterThan(0);
  });
});

describe('registration', () => {
  it('both options are registered switchable, release default off, never on by default', () => {
    for (const name of ['omahaSlowplayMixInLightning', 'omahaPublicBetSizeInLightning']) {
      const entry = OPTION_SWITCH_REGISTRY.find((e) => e.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.releaseDefault).toBe('off');
      expect(entry!.states).toContain('off');
      expect(entry!.states).toContain('on');
    }
  });
});
