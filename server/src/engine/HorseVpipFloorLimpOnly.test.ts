/**
 * THE TABLE VPIP FLOOR LIMPS FOR A BIG BLIND, AND NOTHING ELSE (option
 * vpipFloorLimpOnly, default OFF). Owner 2026-11-17 14:34 Chicago, finding
 * F-10: "Table VPIP must limp fold for a bb. smh nothing else if there vpip
 * drops."
 *
 * The spots are the six-seat 50% PLO5 Classic table of the recorded hand
 * 59518335 (anonymised to seats), rebuilt for the lines the audit's F-10
 * decisions were taken in (a cold call of an open with callers in, a small
 * blind facing the button's open, a big blind facing an open and a call or a
 * re-raise, first in from every seat, a limped pot, a limp raised behind),
 * every Horse with the option switch set production decided with
 * (PRODUCTION_28372C9A). The hole cards are synthesised; none is a retained
 * hand's.
 *
 * WHICH VARIANTS THE OPTION GOVERNS is a declared table
 * (VPIP_FLOOR_LIMP_ONLY_VARIANTS, from the F-10 evaluation E1d/E3: hold'em's
 * 20% floor only). The mechanism is proved here on every variant that
 * evaluation measured, with the table set to all four for the test
 * (MEASURED_VARIANTS_PRICED), because the recorded table is PLO5 and a later
 * measurement may list more variants; the last describe runs on the declared
 * table itself and pins what ships.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VPIP_FLOOR_LIMP_ONLY_VARIANTS,
  VPIP_LIMP_BUFFER_HANDS,
  vpipFloorLimpEv,
  vpipFloorLimpOnlyApplies,
  vpipFloorLimpOnlySelectionFor,
  vpipFloorLimpOnlySelects,
  vpipFloorLimpOnlyShortfall,
  vpipFloorLimpOnlyStep,
  type HorseDecideOpts,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  decideAt,
  HOLE_COUNT,
  limpedThenRaised,
  MEASURED_VARIANTS_PRICED,
  PRODUCTION_28372C9A,
  PRODUCTION_MIX,
  setLimpOnlyVariants,
  withLimpOnlyVariants,
  SPOTS,
  type FloorVariant,
  type Spot,
  type SpotName,
  type Table,
} from './HorseVpipFloorLimpOnly.test-support.js';
import type { HorseDecision } from '../types.js';

const P = PRODUCTION_28372C9A;
const ON: HorseDecideOpts = { ...P, vpipFloorLimpOnly: true };
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17];

// Every describe but the last proves the mechanism on all four measured variants.
let restoreVariants: (() => void) | null = null;
beforeEach(() => {
  restoreVariants = setLimpOnlyVariants(MEASURED_VARIANTS_PRICED);
});
afterEach(() => {
  restoreVariants?.();
  restoreVariants = null;
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const own = (vpip: number) => ({ hands: 30, vpip });
const floored = (variant: FloorVariant, floor: number, vpip?: number): Table => ({
  variant,
  floor,
  ...(vpip !== undefined ? { ownVpip: own(vpip) } : {}),
});
const unfloored = (variant: FloorVariant): Table => ({ variant, floor: 0 });

interface Played {
  actions: string[];
  amounts: (number | undefined)[];
  bytes: string[];
  /** the bytes without jointPolicy.stateKey, the hash of the public state, which names the table's floor */
  sameAsTable: string[];
  next: number[];
  fires: string[][];
}
function play(
  spot: Spot,
  table: Table,
  hole: string,
  opts: HorseDecideOpts,
  mutate?: (gs: Record<string, unknown>) => void
): Played {
  enableBrainTelemetry();
  const out: Played = { actions: [], amounts: [], bytes: [], sameAsTable: [], next: [], fires: [] };
  for (const seed of SEEDS) {
    drainFires();
    const d = decideAt(spot, table, hole, { telemetry: true, ...opts }, seed, mutate);
    out.actions.push(d.decision.action);
    out.amounts.push(d.decision.amount);
    out.bytes.push(digest(d.decision));
    const jp = (d.decision as { jointPolicy?: Record<string, unknown> }).jointPolicy;
    out.sameAsTable.push(
      digest({
        ...d.decision,
        ...(jp ? { jointPolicy: { ...jp, stateKey: null } } : {}),
      } as HorseDecision)
    );
    out.next.push(d.next);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const digest = (d: HorseDecision): string =>
  createHash('sha256')
    .update(JSON.stringify(withoutMeasurements(d)))
    .digest('hex')
    .slice(0, 16);
const all = (a: string) => SEEDS.map(() => a);
const fired = (p: Played, f: string) => p.fires.filter((x) => x.includes(f)).length;
const S = (name: SpotName): Spot => SPOTS[name] as Spot;

/** Hands the unfloored PLO5 brain folds in every spot below. */
const PLO5_WEAK = ['Kc9d7h5s3c', 'JcTd6h5s2c', 'Qc8d6h3s2c', 'Th8c5d3s2h'];
/** Hands it raises first in and re-raises an open with. */
const PLO5_STRONG = ['AhAs8h7c4c', 'KhQhJsTs9c'];

describe('the rule, as functions', () => {
  it('the line is the product buffer: three hands of the judged window above the floor', () => {
    expect(VPIP_LIMP_BUFFER_HANDS).toBe(3);
    const at = (floor: number, vpip: number) =>
      vpipFloorLimpOnlyShortfall({ vpipFloor: floor, vpipWindowHands: 30, ownVpip: own(vpip) });
    expect(at(50, 60)).toBe(0);
    expect(at(50, 56.7)).toBeCloseTo(0.99, 6);
    expect(at(50, 50)).toBeCloseTo(3, 6);
    expect(at(30, 40)).toBe(0);
    expect(at(20, 30)).toBe(0);
    expect(at(20, 26.7)).toBeCloseTo(0.99, 6);
    // no floor, or no judged sample yet: not a drop
    expect(vpipFloorLimpOnlyShortfall({ vpipFloor: 0, ownVpip: own(0) })).toBeNull();
    expect(vpipFloorLimpOnlyShortfall({ vpipFloor: 50, vpipWindowHands: 30 })).toBeNull();
    expect(
      vpipFloorLimpOnlyShortfall({ vpipFloor: 50, ownVpip: { hands: 2, vpip: 0 } })
    ).toBeNull();
    expect(
      vpipFloorLimpOnlyShortfall({ vpipFloor: 50, ownVpip: { hands: 30, vpip: null } })
    ).toBeNull();
  });

  it('the price the floor pays for a hand of VPIP grows with the hands it still needs', () => {
    // never anything above the line
    expect(vpipFloorLimpOnlySelects(0, 5, 2)).toBe(false);
    // one hand short: an expected loss of up to a third of the price
    expect(vpipFloorLimpOnlySelects(1, -0.66, 2)).toBe(true);
    expect(vpipFloorLimpOnlySelects(1, -0.68, 2)).toBe(false);
    // two short: up to two thirds
    expect(vpipFloorLimpOnlySelects(2, -1.3, 2)).toBe(true);
    expect(vpipFloorLimpOnlySelects(2, -1.4, 2)).toBe(false);
    // at the floor itself: up to the whole price, which no limp can lose in this model
    expect(vpipFloorLimpOnlySelects(3, -2, 2)).toBe(true);
    expect(vpipFloorLimpOnlySelects(4.5, -2, 2)).toBe(true);
    expect(vpipFloorLimpOnlySelects(3, -2.01, 2)).toBe(false);
    // unpriceable: no limp
    expect(vpipFloorLimpOnlySelects(3, Number.NaN, 2)).toBe(false);
  });

  it('EV(limp): equity against the ranges to act, realization by position, the raise behind and its own EV', () => {
    const cont: [number, number] = [0, 0.8];
    const raise: [number, number] = [0.8, 1];
    const equity = (bands: Array<[number, number] | null>) => (bands[0]?.[0] === 0.8 ? 0.3 : 0.4);
    const bbBehind = {
      rfi: 0.2,
      vpip: 0.5,
      owes: 0,
      actsAfterHeroPostflop: false,
      continueBand: cont,
      raiseBand: raise,
    };
    const ev = vpipFloorLimpEv({
      price: 2,
      bigBlind: 2,
      pot: 5,
      limpers: [],
      behind: [bbBehind],
      potLimit: true,
      equity,
    });
    // derived by hand: raised (0.2): pot raise to 9, call 7, pot 21, EV(call) 0.3 x 0.85 x 21 - 7 < 0 -> -2;
    // unraised (0.8): the big blind checks, heads-up, in position (0.85), pot 7: 0.4 x 0.85 x 7 - 2 = 0.38
    expect(ev.pRaised).toBeCloseTo(0.2, 12);
    expect(ev.realization).toBeCloseTo(0.85, 12);
    expect(ev.flopPot).toBeCloseTo(7, 12);
    expect(ev.evRaised).toBeCloseTo(-0.4, 12);
    expect(ev.evLimp).toBeCloseTo(0.8 * 0.38 - 0.4, 12);
    // a more raise-prone player behind lowers it; out of position lowers it
    const wider = vpipFloorLimpEv({
      price: 2,
      bigBlind: 2,
      pot: 5,
      limpers: [],
      behind: [{ ...bbBehind, rfi: 0.4 }],
      potLimit: true,
      equity,
    });
    expect(wider.evLimp).toBeLessThan(ev.evLimp);
    const oop = vpipFloorLimpEv({
      price: 2,
      bigBlind: 2,
      pot: 5,
      limpers: [],
      behind: [{ ...bbBehind, actsAfterHeroPostflop: true }],
      potLimit: true,
      equity,
    });
    expect(oop.realization).toBeCloseTo(0.75 + 0.1 * 0.2, 12);
    expect(oop.evLimp).toBeLessThan(ev.evLimp);
    // never below the price (a raise is folded when calling is worse)
    for (const eq of [0, 0.1, 0.5])
      expect(
        vpipFloorLimpEv({
          price: 2,
          bigBlind: 2,
          pot: 5,
          limpers: [],
          behind: [bbBehind, { ...bbBehind, owes: 1, rfi: 0.6 }],
          potLimit: false,
          equity: () => eq,
        }).evLimp
      ).toBeGreaterThanOrEqual(-2 - 1e-12);
  });

  it('the step: a limp or completion for at most the big blind, never a raised pot, a straddle or the stack', () => {
    const fold: HorseDecision = { action: 'fold', thinkTime: 0 };
    const gs = (over: Record<string, unknown> = {}) => ({
      stage: 'preflop',
      currentBet: 2,
      bigBlind: 2,
      vpipFloor: 50,
      vpipWindowHands: 30,
      ownVpip: own(50),
      actionHistory: [] as { stage: string; action: string; isFullRaise?: boolean }[],
      ...over,
    });
    const step = (g: ReturnType<typeof gs>, p = { bet: 0, stack: 400 }, d = fold, ev = 0) =>
      vpipFloorLimpOnlyStep(d, p, g, () => ev);
    expect(step(gs())).toEqual({
      decision: { action: 'call', amount: 2, thinkTime: 0 },
      receipt: 'vpip_floor_limp_only_limp',
    });
    // the small blind completes the half blind
    expect(step(gs(), { bet: 1, stack: 399 }).decision).toMatchObject({
      action: 'call',
      amount: 1,
    });
    // a raised pot, an under-raise all-in, a straddle, more than a big blind: the fold stands
    const raised = gs({
      currentBet: 9,
      actionHistory: [{ stage: 'preflop', action: 'raise', isFullRaise: true }],
    });
    expect(step(raised)).toEqual({ decision: fold, receipt: 'vpip_floor_limp_only_priced_out' });
    const underRaise = gs({
      currentBet: 3,
      actionHistory: [{ stage: 'preflop', action: 'all_in', isFullRaise: false }],
    });
    expect(step(underRaise).decision).toBe(fold);
    expect(step(gs({ straddleActive: true })).decision).toBe(fold);
    expect(step(gs({ currentBet: 4 })).decision).toBe(fold);
    // never the whole stack
    expect(step(gs(), { bet: 0, stack: 2 }).decision).toBe(fold);
    // a priced refusal stands
    const refusal = { ...fold, continuationGuard: 'preflop_priced_refusal' as const };
    expect(step(gs(), undefined, refusal).decision).toBe(refusal);
    // at or over the line, or no sample: nothing to say
    expect(step(gs({ ownVpip: own(60) }))).toEqual({ decision: fold, receipt: null });
    expect(step(gs({ ownVpip: undefined }))).toEqual({ decision: fold, receipt: null });
    // only a preflop fold
    const check: HorseDecision = { action: 'check', thinkTime: 0 };
    expect(vpipFloorLimpOnlyStep(check, { bet: 2, stack: 400 }, gs({}), () => 0).decision).toBe(
      check
    );
    // priced: one hand short, an expected loss beyond a third of the price keeps the fold
    expect(step(gs({ ownVpip: own(56.7) }), undefined, fold, -0.7).receipt).toBe(
      'vpip_floor_limp_only_fold_kept'
    );
    expect(step(gs({ ownVpip: own(56.7) }), undefined, fold, -0.6).receipt).toBe(
      'vpip_floor_limp_only_limp'
    );
    expect(step(gs({ stage: 'flop' })).decision).toBe(fold);
    // one big blind ahead to complete in a call-off pot (an all-in call is not a raise)
    const callOff = gs({ actionHistory: [{ stage: 'preflop', action: 'all_in' }] });
    expect(step(callOff).receipt).toBe('vpip_floor_limp_only_limp');
  });

  it('applies to a floored cash table of a governed variant, and never to a tournament, All-In-Or-Fold, a bomb pot or Lightning', () => {
    const t = { vpipFloor: 50, gameVariant: 'plo5' };
    expect(vpipFloorLimpOnlyApplies(t, { vpipFloorLimpOnly: true }, false)).toBe(true);
    expect(vpipFloorLimpOnlyApplies(t, {}, false)).toBe(false);
    expect(vpipFloorLimpOnlyApplies(t, { vpipFloorLimpOnly: false }, false)).toBe(false);
    expect(vpipFloorLimpOnlyApplies(t, { vpipFloorLimpOnly: 1 as unknown as boolean }, false)).toBe(
      false
    );
    expect(vpipFloorLimpOnlyApplies(t, { vpipFloorLimpOnly: true }, true)).toBe(false);
    expect(
      vpipFloorLimpOnlyApplies({ ...t, allInOrFold: true }, { vpipFloorLimpOnly: true }, false)
    ).toBe(false);
    expect(
      vpipFloorLimpOnlyApplies({ ...t, bombPot: true }, { vpipFloorLimpOnly: true }, false)
    ).toBe(false);
    expect(
      vpipFloorLimpOnlyApplies(
        { ...t, publicMemoryDomain: { speed: 'lightning' } },
        { vpipFloorLimpOnly: true },
        false
      )
    ).toBe(false);
    expect(
      vpipFloorLimpOnlyApplies(
        { vpipFloor: 0, gameVariant: 'plo5' },
        { vpipFloorLimpOnly: true },
        false
      )
    ).toBe(false);
    // a variant the table does not list, or no variant at all: not governed
    for (const gameVariant of ['plo8', 'flo8', 'flh', 'short_deck', 'pineapple', undefined])
      expect(
        vpipFloorLimpOnlyApplies({ vpipFloor: 50, gameVariant }, { vpipFloorLimpOnly: true }, false)
      ).toBe(false);
    expect(
      vpipFloorLimpOnlyApplies(
        { vpipFloor: 50, gameVariant: 'PLO5' },
        { vpipFloorLimpOnly: true },
        false
      )
    ).toBe(true);
  });

  it("the selection 'every' limps every eligible fold under the line without pricing it, and nothing else", () => {
    const fold: HorseDecision = { action: 'fold', thinkTime: 0 };
    const gs = (over: Record<string, unknown> = {}) => ({
      stage: 'preflop',
      currentBet: 2,
      bigBlind: 2,
      vpipFloor: 50,
      vpipWindowHands: 30,
      ownVpip: own(56.7),
      actionHistory: [] as { stage: string; action: string; isFullRaise?: boolean }[],
      ...over,
    });
    let priced = 0;
    const ev = () => {
      priced++;
      return -2;
    };
    const p = { bet: 0, stack: 400 };
    // one hand short, the worst possible limp: 'priced' keeps the fold, 'every' limps and asks no price
    expect(vpipFloorLimpOnlyStep(fold, p, gs(), ev, 'priced').receipt).toBe(
      'vpip_floor_limp_only_fold_kept'
    );
    expect(priced).toBe(1);
    expect(vpipFloorLimpOnlyStep(fold, p, gs(), ev, 'every')).toEqual({
      decision: { action: 'call', amount: 2, thinkTime: 0 },
      receipt: 'vpip_floor_limp_only_limp',
    });
    expect(priced).toBe(1);
    // the same limits as 'priced': a raised pot, a straddle, the stack, at or over the line
    const raised = gs({
      currentBet: 9,
      actionHistory: [{ stage: 'preflop', action: 'raise', isFullRaise: true }],
    });
    expect(vpipFloorLimpOnlyStep(fold, p, raised, ev, 'every')).toEqual({
      decision: fold,
      receipt: 'vpip_floor_limp_only_priced_out',
    });
    expect(vpipFloorLimpOnlyStep(fold, p, gs({ straddleActive: true }), ev, 'every').decision).toBe(
      fold
    );
    expect(vpipFloorLimpOnlyStep(fold, { bet: 0, stack: 2 }, gs(), ev, 'every').decision).toBe(
      fold
    );
    expect(vpipFloorLimpOnlyStep(fold, p, gs({ ownVpip: own(60) }), ev, 'every')).toEqual({
      decision: fold,
      receipt: null,
    });
    expect(vpipFloorLimpOnlyStep(fold, p, gs({ ownVpip: undefined }), ev, 'every').receipt).toBe(
      null
    );
  });
});

describe('off: unset, false and a truthy non-boolean decide byte-identically, draw for draw', () => {
  it.each([
    ['plo5', 50, 'btnFacingOpenTwoCalls', PLO5_WEAK[0], 50],
    ['plo5', 50, 'utgFirstIn', PLO5_WEAK[1], 56.7],
    ['plo5', 50, 'sbFirstIn', PLO5_WEAK[2], 50],
    ['plo5', 50, 'btnFirstIn', PLO5_STRONG[0], 50],
    ['nlh', 20, 'coFirstIn', 'Kd9c', 20],
    ['nlh', 20, 'bbFacingReRaise', '7c2d', 20],
    ['plo6', 50, 'btnFacingOpenTwoCalls', 'Kc9d7h5s3c2d', 60],
    ['plo4', 30, 'sbFacingButtonOpen', 'Kc9d7h5s', 30],
  ] as const)('%s %s%% %s', (variant, floor, spot, hole, vpip) => {
    const table = floored(variant, floor, vpip);
    const unset = play(S(spot), table, hole, P);
    for (const opts of [
      { ...P, vpipFloorLimpOnly: false },
      { ...P, vpipFloorLimpOnly: 1 as unknown as boolean },
    ]) {
      const off = play(S(spot), table, hole, opts);
      expect(off.bytes).toEqual(unset.bytes);
      expect(off.next).toEqual(unset.next);
    }
  });
});

describe('the floor no longer calls a raise (failing before: today the call-down buys these)', () => {
  it.each([
    // the recorded line (4.5 big blinds into an open and two calls)
    ['btnFacingOpenTwoCalls', 50],
    ['btnFacingOpenTwoCalls', 56.7],
    // the audit's small-blind cases (#59715720 d3, #59749689 d4, #59823259 d3 shape)
    ['sbFacingButtonOpen', 50],
    ['bbFacingCutoffOpenAndCall', 53.3],
  ] as const)('PLO5 %s, own VPIP %s%%: today a call, on the unfloored fold', (spot, vpip) => {
    for (const hole of PLO5_WEAK) {
      const today = play(S(spot), floored('plo5', 50, vpip), hole, P);
      expect([hole, today.actions]).toEqual([hole, all('call')]);
      expect(fired(today, 'vpip_floor_call_down')).toBe(SEEDS.length);
      const on = play(S(spot), floored('plo5', 50, vpip), hole, ON);
      expect([hole, on.actions]).toEqual([hole, all('fold')]);
      expect(fired(on, 'vpip_floor_call_down')).toBe(0);
      expect(fired(on, 'vpip_floor_limp_only_priced_out')).toBe(SEEDS.length);
      expect(play(S(spot), unfloored('plo5'), hole, P).actions).toEqual(all('fold'));
    }
  });

  it('NLH 20%: the 3-bet call-down for six big blinds becomes the fold', () => {
    for (const hole of ['7c2d', 'Ts4h', 'Kd9c', '9s8s']) {
      expect(play(S('bbFacingReRaise'), floored('nlh', 20, 20), hole, P).actions).toEqual(
        all('call')
      );
      expect(play(S('bbFacingReRaise'), floored('nlh', 20, 20), hole, ON).actions).toEqual(
        all('fold')
      );
    }
  });

  it('NLH 20%: a limp raised behind is not called by the floor', () => {
    for (const hole of ['7c2d', 'Kd9c', '4c4d']) {
      const line = limpedThenRaised(S('btnFirstIn'));
      expect(play(line, floored('nlh', 20, 20), hole, P).actions).toEqual(all('call'));
      expect(play(line, floored('nlh', 20, 20), hole, ON).actions).toEqual(all('fold'));
    }
  });
});

describe('the floor no longer raises (failing before)', () => {
  it('NLH 20%: a first-in raise only the floor makes becomes the limp at the floor, the fold above it', () => {
    for (const hole of ['Kd9c', 'Qd5d']) {
      expect(play(S('coFirstIn'), unfloored('nlh'), hole, P).actions).toEqual(all('fold'));
      expect(play(S('coFirstIn'), floored('nlh', 20, 20), hole, P).actions).toEqual(all('raise'));
      const at = play(S('coFirstIn'), floored('nlh', 20, 20), hole, ON);
      expect(at.actions).toEqual(all('call'));
      expect(at.amounts).toEqual(SEEDS.map(() => 2));
      expect(fired(at, 'vpip_floor_limp_only_limp')).toBe(SEEDS.length);
    }
    // one hand short of the line: priced, a limp or the fold, never the raise
    for (const hole of ['Kd9c', 'Qd5d']) {
      const near = play(S('coFirstIn'), floored('nlh', 20, 26.7), hole, ON);
      for (const [k, a] of near.actions.entries()) {
        expect(['call', 'fold']).toContain(a);
        if (a === 'call') expect(near.amounts[k]).toBe(2);
      }
    }
  });

  it('NLH 20%: a 3-bet only the floor makes becomes the unfloored call', () => {
    const hole = 'JhTh';
    expect(play(S('sbFacingButtonOpen'), floored('nlh', 20, 20), hole, P).actions).toEqual(
      all('raise')
    );
    const none = play(S('sbFacingButtonOpen'), unfloored('nlh'), hole, P);
    expect(none.actions.filter((a) => a === 'call').length).toBeGreaterThan(SEEDS.length / 2);
    const on = play(S('sbFacingButtonOpen'), floored('nlh', 20, 20), hole, ON);
    expect(on.sameAsTable).toEqual(none.sameAsTable);
  });

  it('PLO6 50% (no limp mode today): above the line the floor still acts today; on, nothing', () => {
    for (const hole of ['Kc9d7h5s3c2d', 'JcTd6h5s2c4d']) {
      for (const spot of ['btnFacingOpenTwoCalls', 'btnFirstIn', 'sbFacingButtonOpen'] as const) {
        const none = play(S(spot), unfloored('plo6'), hole, ON);
        const on = play(S(spot), floored('plo6', 50, 63.3), hole, ON);
        expect([spot, hole, on.sameAsTable]).toEqual([spot, hole, none.sameAsTable]);
      }
      // today the floor's 70.6% target is above 63.3%: the call-down buys the raised pot
      expect(play(S('btnFacingOpenTwoCalls'), floored('plo6', 50, 63.3), hole, P).actions).toEqual(
        all('call')
      );
    }
  });
});

describe('what the floor still does: the limp for a big blind', () => {
  it('PLO5 at the floor: first in from every seat and in a limped pot, the fold becomes the limp', () => {
    for (const spot of ['utgFirstIn', 'hjFirstIn', 'coFirstIn', 'btnFirstIn', 'btnLimped'] as const)
      for (const hole of PLO5_WEAK) {
        const on = play(S(spot), floored('plo5', 50, 50), hole, ON);
        expect([spot, hole, on.actions, on.amounts]).toEqual([
          spot,
          hole,
          all('call'),
          SEEDS.map(() => 2),
        ]);
      }
  });

  it('the small blind completes for one chip; the big blind checks free', () => {
    for (const hole of PLO5_WEAK) {
      const sb = play(S('sbFirstIn'), floored('plo5', 50, 50), hole, ON);
      expect(sb.actions).toEqual(all('call'));
      expect(sb.amounts).toEqual(SEEDS.map(() => 1));
      const bb = play(S('bbOption'), floored('plo5', 50, 50), hole, ON);
      expect(bb.actions).toEqual(all('check'));
    }
  });

  it('limped, then raised: the unfloored decision stands (fold, or the call the hand makes anyway)', () => {
    const line = limpedThenRaised(S('btnFirstIn'));
    for (const hole of PLO5_WEAK)
      expect(play(line, floored('plo5', 50, 50), hole, ON).actions).toEqual(all('fold'));
    for (const hole of ['7c4c8hQhQs', '9h8h7d6d2c']) {
      const none = play(line, unfloored('plo5'), hole, ON);
      expect(none.actions).toEqual(all('call'));
      expect(play(line, floored('plo5', 50, 50), hole, ON).sameAsTable).toEqual(none.sameAsTable);
    }
  });

  it('a straddled hand: the floor does nothing (the limp is not one big blind)', () => {
    const on = play(
      S('btnFirstIn'),
      { ...floored('plo5', 50, 50), straddleActive: true },
      PLO5_WEAK[0],
      ON
    );
    expect(on.actions).toEqual(all('fold'));
  });

  it('priced selection: fewer folds limp the closer the Horse is to its line (nested), every one at the floor', () => {
    let s = 20261117;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const deal = () => {
      const seen = new Set<string>();
      while (seen.size < HOLE_COUNT.plo5)
        seen.add('23456789TJQKA'[Math.floor(rnd() * 13)] + 'cdhs'[Math.floor(rnd() * 4)]);
      return [...seen].join('');
    };
    const limps: Record<string, Set<string>> = {
      '50': new Set(),
      '53.3': new Set(),
      '56.7': new Set(),
    };
    const foldsBoth: string[] = [];
    for (let i = 0; i < 60; i++) {
      const hole = deal();
      let folds = 0;
      for (const spot of ['utgFirstIn', 'btnFirstIn'] as const) {
        if (decideAt(S(spot), unfloored('plo5'), hole, ON, 1).decision.action !== 'fold') continue;
        folds++;
        if (folds === 2) foldsBoth.push(hole);
        for (const v of Object.keys(limps)) {
          const d = decideAt(S(spot), floored('plo5', 50, Number(v)), hole, ON, 1).decision;
          expect(['fold', 'call']).toContain(d.action);
          if (d.action === 'call') limps[v].add(`${spot}|${hole}`);
        }
      }
    }
    // nested: one short is a subset of two short, which is a subset of at the floor
    for (const k of limps['56.7']) expect(limps['53.3'].has(k)).toBe(true);
    for (const k of limps['53.3']) expect(limps['50'].has(k)).toBe(true);
    expect(limps['50'].size).toBeGreaterThan(limps['53.3'].size);
    expect(foldsBoth.length).toBeGreaterThan(10);
  }, 120_000);
});

describe('above the line the floor does nothing: the floored table decides as the unfloored one', () => {
  it.each([
    ['plo5', 50, 60],
    ['plo5', 50, 90],
    ['plo4', 30, 40],
    ['plo6', 50, 60],
    ['nlh', 20, 30],
  ] as const)('%s %s%% floor, own VPIP %s%%', (variant, floor, vpip) => {
    const holes: Record<FloorVariant, string[]> = {
      plo5: [PLO5_WEAK[0], PLO5_STRONG[1], '7c4c8hQhQs'],
      plo4: ['Kc9d7h5s', 'AhAs8h7c'],
      plo6: ['Kc9d7h5s3c2d', 'AhAsKhQs9c8d'],
      nlh: ['7c2d', 'Kd9c', 'AhKs'],
    };
    for (const spot of [
      'utgFirstIn',
      'btnFirstIn',
      'sbFirstIn',
      'btnFacingOpenTwoCalls',
      'bbFacingReRaise',
    ] as const)
      for (const hole of holes[variant]) {
        const none = play(S(spot), unfloored(variant), hole, ON);
        const on = play(S(spot), floored(variant, floor, vpip), hole, ON);
        expect([spot, hole, on.sameAsTable]).toEqual([spot, hole, none.sameAsTable]);
      }
  });

  it('and with no judged sample yet (under three hands, or none)', () => {
    for (const ownVpip of [undefined, { hands: 2, vpip: 0 }]) {
      const table: Table = { variant: 'plo5', floor: 50, ownVpip };
      for (const hole of PLO5_WEAK) {
        expect(play(S('btnFirstIn'), table, hole, ON).sameAsTable).toEqual(
          play(S('btnFirstIn'), unfloored('plo5'), hole, ON).sameAsTable
        );
      }
    }
  });
});

describe('preserved: what the floor did that was right', () => {
  it('a hand the unfloored brain raises or re-raises plays exactly as today', () => {
    for (const hole of PLO5_STRONG)
      for (const spot of [
        'utgFirstIn',
        'btnFirstIn',
        'sbFirstIn',
        'btnFacingOpenTwoCalls',
        'sbFacingButtonOpen',
      ] as const) {
        const today = play(S(spot), floored('plo5', 50, 50), hole, P);
        const on = play(S(spot), floored('plo5', 50, 50), hole, ON);
        expect([spot, hole, on.actions, on.amounts]).toEqual([
          spot,
          hole,
          today.actions,
          today.amounts,
        ]);
      }
  });

  it('PLO5 under the line, first in: the floor limp of today stays the limp', () => {
    for (const spot of ['utgFirstIn', 'btnFirstIn', 'btnLimped', 'sbFirstIn'] as const)
      for (const hole of PLO5_WEAK) {
        const today = play(S(spot), floored('plo5', 50, 50), hole, P);
        const on = play(S(spot), floored('plo5', 50, 50), hole, ON);
        expect(on.actions).toEqual(today.actions);
        expect(on.amounts).toEqual(today.amounts);
      }
  });

  it('PLO5 limped then raised: the limp-fold of today stays the fold', () => {
    const line = limpedThenRaised(S('btnFirstIn'));
    for (const hole of PLO5_WEAK) {
      expect(play(line, floored('plo5', 50, 50), hole, P).actions).toEqual(all('fold'));
      expect(play(line, floored('plo5', 50, 50), hole, ON).actions).toEqual(all('fold'));
    }
  });
});

describe('untouched: tournaments, Lightning, bomb pots and All-In-Or-Fold', () => {
  const cases: Array<[string, (gs: Record<string, unknown>) => void]> = [
    ['tournament', (gs) => void (gs.gameMode = 'tournament')],
    ['lightning', (gs) => void (gs.publicMemoryDomain = { speed: 'lightning' })],
    ['bomb pot', (gs) => void (gs.bombPot = true)],
    ['all-in-or-fold', (gs) => void (gs.allInOrFold = true)],
  ];
  it.each(cases)('%s: on decides as off', (_name, mutate) => {
    for (const spot of ['btnFirstIn', 'btnFacingOpenTwoCalls'] as const)
      for (const hole of [PLO5_WEAK[0], PLO5_STRONG[0]]) {
        const off = play(S(spot), floored('plo5', 50, 50), hole, P, mutate);
        const on = play(S(spot), floored('plo5', 50, 50), hole, ON, mutate);
        expect([spot, hole, on.bytes, on.next]).toEqual([spot, hole, off.bytes, off.next]);
      }
  });

  it('an unfloored table: on decides as off', () => {
    for (const variant of ['plo5', 'nlh'] as const)
      for (const spot of ['btnFirstIn', 'btnFacingOpenTwoCalls', 'bbOption'] as const) {
        const hole = variant === 'nlh' ? '7c2d' : PLO5_WEAK[0];
        const off = play(S(spot), unfloored(variant), hole, P);
        const on = play(S(spot), unfloored(variant), hole, ON);
        expect([variant, spot, on.bytes, on.next]).toEqual([variant, spot, off.bytes, off.next]);
      }
  });
});

describe('the FAST decision and its DEEP second look price the same limp', () => {
  it('a larger second-look sample (deepEquity) never changes the floor action', () => {
    let st = 11;
    const rnd = () => {
      st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
      return st / 4294967296;
    };
    let compared = 0;
    for (const variant of ['plo5', 'nlh'] as const)
      for (let i = 0; i < 12; i++) {
        const seen = new Set<string>();
        while (seen.size < HOLE_COUNT[variant])
          seen.add('23456789TJQKA'[Math.floor(rnd() * 13)] + 'cdhs'[Math.floor(rnd() * 4)]);
        const hole = [...seen].join('');
        const floor = variant === 'nlh' ? 20 : 50;
        for (const spot of ['utgFirstIn', 'btnFirstIn', 'sbFirstIn', 'btnLimped'] as const)
          for (const vpip of [floor + 3.3, floor + 6.7]) {
            const t = floored(variant, floor, vpip);
            const fast = decideAt(S(spot), t, hole, ON, i).decision;
            const deep = decideAt(S(spot), t, hole, { ...ON, deepEquity: 3 }, i).decision;
            expect([spot, hole, vpip, deep.action, deep.amount]).toEqual([
              spot,
              hole,
              vpip,
              fast.action,
              fast.amount,
            ]);
            compared++;
          }
      }
    expect(compared).toBe(192);
  }, 120_000);
});

describe('receipts', () => {
  it('on, no receipt of the old floor fires; the limp and the priced-out fold carry their own', () => {
    const old = [
      'vpip_floor_call_down',
      'omaha_vpip_floor_limp',
      'omaha_vpip_floor_limp_fold',
      'omaha_vpip_floor_three_bet_bar_kept',
      'vpip_floor_closing',
      'vpip_floor_prior',
    ];
    for (const spot of ['btnFirstIn', 'btnFacingOpenTwoCalls'] as const) {
      const on = play(S(spot), floored('plo5', 50, 50), PLO5_WEAK[0], ON);
      for (const f of old) expect([spot, f, fired(on, f)]).toEqual([spot, f, 0]);
      expect(fired(on, 'vpip_floor_limp_only_seen')).toBe(SEEDS.length);
    }
    expect(
      fired(
        play(S('btnFirstIn'), floored('plo5', 50, 50), PLO5_WEAK[0], ON),
        'vpip_floor_limp_only_limp'
      )
    ).toBe(SEEDS.length);
  });
});

describe('the declared table: which variants the option governs (what ships)', () => {
  // this describe runs on the table as declared in HorseLogic.ts
  beforeEach(() => {
    restoreVariants?.();
    restoreVariants = null;
  });

  let st = 20261118;
  const rnd = () => {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    return st / 4294967296;
  };
  const deal = (variant: FloorVariant) => {
    const seen = new Set<string>();
    while (seen.size < HOLE_COUNT[variant])
      seen.add('23456789TJQKA'[Math.floor(rnd() * 13)] + 'cdhs'[Math.floor(rnd() * 4)]);
    return [...seen].join('');
  };
  const RAISED = PRODUCTION_MIX.map(([n]) => n).filter((n) =>
    S(n).prior.some(([, a]) => a === 'pot')
  );

  it("is hold'em on the priced selection and nothing else (F-10 evaluation E1d / E3)", () => {
    // A change here needs a new declared measurement: see the table's comment in HorseLogic.ts.
    expect({ ...VPIP_FLOOR_LIMP_ONLY_VARIANTS }).toEqual({ nlh: 'priced' });
    expect(vpipFloorLimpOnlySelectionFor('nlh')).toBe('priced');
    for (const v of ['plo4', 'plo5', 'plo6', 'plo8', 'flo8', 'flh', 'short_deck', 'pineapple'])
      expect([v, vpipFloorLimpOnlySelectionFor(v)]).toEqual([v, undefined]);
    for (const v of [undefined, null, '', 'toString', 'constructor', '__proto__'])
      expect([v, vpipFloorLimpOnlySelectionFor(v)]).toEqual([v, undefined]);
  });

  it.each([
    ['plo5', 50, [50, 56.7, 43.3]],
    ['plo6', 50, [50, 56.7]],
    ['plo4', 30, [30, 36.7]],
  ] as const)(
    '%s %s%% is left out: with the option on it decides as with it off, byte for byte, draw for draw',
    (variant, floor, vpips) => {
      const holes: Record<string, string[]> = {
        plo5: [PLO5_WEAK[0], PLO5_WEAK[2], PLO5_STRONG[0]],
        plo6: ['Kc9d7h5s3c2d', 'AhAsKhQs9c8d'],
        plo4: ['Kc9d7h5s', 'AhAs8h7c'],
      };
      let floorActsToday = 0;
      for (const spot of [
        'utgFirstIn',
        'btnFirstIn',
        'sbFirstIn',
        'btnFacingOpenTwoCalls',
        'sbFacingButtonOpen',
        'bbFacingReRaise',
      ] as const)
        for (const hole of holes[variant])
          for (const vpip of vpips) {
            const off = play(S(spot), floored(variant, floor, vpip), hole, P);
            const on = play(S(spot), floored(variant, floor, vpip), hole, ON);
            expect([spot, hole, vpip, on.bytes, on.next]).toEqual([
              spot,
              hole,
              vpip,
              off.bytes,
              off.next,
            ]);
            expect(fired(on, 'vpip_floor_limp_only_seen')).toBe(0);
            // the comparison is not vacuous: today's floor does act in these spots
            const none = play(S(spot), unfloored(variant), hole, P);
            if (off.actions.join() !== none.actions.join()) floorActsToday++;
          }
      expect(floorActsToday).toBeGreaterThan(0);
    },
    120_000
  );

  it("hold'em 20%, under the line, facing a raise or a re-raise: the decision is the unfloored one on every hand (the floor never calls or raises in a raised pot)", () => {
    let compared = 0;
    let todayDiffers = 0;
    for (let i = 0; i < 40; i++) {
      const hole = deal('nlh');
      for (const name of RAISED)
        for (const vpip of [20, 26.7, 10]) {
          const seed = 1 + i;
          const none = decideAt(S(name), unfloored('nlh'), hole, ON, seed).decision;
          const on = decideAt(S(name), floored('nlh', 20, vpip), hole, ON, seed).decision;
          expect([name, hole, vpip, on.action, on.amount]).toEqual([
            name,
            hole,
            vpip,
            none.action,
            none.amount,
          ]);
          const today = decideAt(S(name), floored('nlh', 20, vpip), hole, P, seed).decision;
          if (today.action !== none.action) todayDiffers++;
          compared++;
        }
    }
    expect(compared).toBe(40 * RAISED.length * 3);
    // failing before: today's floor buys calls and raises in these raised pots
    expect(todayDiffers).toBeGreaterThan(0);
  }, 120_000);

  it("hold'em 20%, a limp raised behind: the unfloored decision stands on every hand", () => {
    for (let i = 0; i < 30; i++) {
      const hole = deal('nlh');
      for (const first of ['utgFirstIn', 'btnFirstIn', 'sbFirstIn'] as const) {
        const line = limpedThenRaised(S(first));
        const none = decideAt(line, unfloored('nlh'), hole, ON, 1 + i).decision;
        const on = decideAt(line, floored('nlh', 20, 20), hole, ON, 1 + i).decision;
        expect([first, hole, on.action, on.amount]).toEqual([
          first,
          hole,
          none.action,
          none.amount,
        ]);
      }
    }
  }, 120_000);

  it("hold'em 20%, under the line in an unraised pot: the only change the floor makes is a fold that becomes the one-big-blind limp", () => {
    let limps = 0;
    for (let i = 0; i < 40; i++) {
      const hole = deal('nlh');
      for (const name of [
        'utgFirstIn',
        'coFirstIn',
        'btnFirstIn',
        'btnLimped',
        'sbFirstIn',
        'bbOption',
      ] as const)
        for (const vpip of [20, 26.7]) {
          const none = decideAt(S(name), unfloored('nlh'), hole, ON, 1 + i);
          const on = decideAt(S(name), floored('nlh', 20, vpip), hole, ON, 1 + i);
          if (on.decision.action === none.decision.action) {
            expect([name, hole, on.decision.amount]).toEqual([name, hole, none.decision.amount]);
            continue;
          }
          expect([name, hole, none.decision.action, on.decision.action]).toEqual([
            name,
            hole,
            'fold',
            'call',
          ]);
          expect(on.decision.amount).toBe(name === 'sbFirstIn' ? 1 : 2);
          expect(on.toCall).toBeLessThanOrEqual(2);
          limps++;
        }
    }
    expect(limps).toBeGreaterThan(0);
  }, 120_000);

  it("hold'em 20%, at or over the line (9 of 30): nothing changes, on any hand in any spot", () => {
    for (let i = 0; i < 25; i++) {
      const hole = deal('nlh');
      for (const [name] of PRODUCTION_MIX)
        for (const vpip of [30, 33.3, 60]) {
          const none = decideAt(S(name), unfloored('nlh'), hole, ON, 1 + i).decision;
          const on = decideAt(S(name), floored('nlh', 20, vpip), hole, ON, 1 + i).decision;
          expect([name, hole, vpip, on.action, on.amount]).toEqual([
            name,
            hole,
            vpip,
            none.action,
            none.amount,
          ]);
        }
    }
  }, 120_000);

  it("the selection 'every' through the decision path (measurement only; no declared variant uses it)", () => {
    withLimpOnlyVariants({ plo5: 'every' }, () => {
      // one hand short of the line: every unraised fold limps, at every seat
      for (const spot of [
        'utgFirstIn',
        'hjFirstIn',
        'coFirstIn',
        'btnFirstIn',
        'btnLimped',
      ] as const)
        for (const hole of PLO5_WEAK) {
          const on = play(S(spot), floored('plo5', 50, 56.7), hole, ON);
          expect([spot, hole, on.actions, on.amounts]).toEqual([
            spot,
            hole,
            all('call'),
            SEEDS.map(() => 2),
          ]);
          expect(fired(on, 'vpip_floor_limp_only_fold_kept')).toBe(0);
        }
      // a raised pot, and at the line: the unfloored decision
      for (const hole of PLO5_WEAK) {
        expect(
          play(S('btnFacingOpenTwoCalls'), floored('plo5', 50, 43.3), hole, ON).actions
        ).toEqual(all('fold'));
        expect(play(S('btnFirstIn'), floored('plo5', 50, 60), hole, ON).sameAsTable).toEqual(
          play(S('btnFirstIn'), unfloored('plo5'), hole, ON).sameAsTable
        );
      }
    });
    // and the declared table is back
    expect({ ...VPIP_FLOOR_LIMP_ONLY_VARIANTS }).toEqual({ nlh: 'priced' });
  });
});
