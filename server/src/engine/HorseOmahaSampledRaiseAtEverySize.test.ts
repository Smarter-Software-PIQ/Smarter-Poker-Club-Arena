/**
 * omahaSampledRaiseIsPricedAtEverySize (default OFF; verifier defect of 2026-11-19 on
 * HorseOmahaPricedRules.omahaPricedSampledRaise, the flop and turn raise of omahaDrawRaiseIsPriced
 * and omahaPressureIsPriced).
 *
 * The defect: the sampled comparison priced ONE raise size and read the opponent's fold to a raise
 * size-blind (his fold to a bet times 0.42, or the street read's fold-to-raise cell, both measured
 * over raises of every size). A 20-chip minimum raise into 120 was priced with the fold share of an
 * average raise, and no size was ever compared with another.
 *
 * With the option on: the fold, the call and a raise to each legal size are priced, each raise's
 * fold share at the price that raise lays each opponent and its called share against the part of
 * the range that continues at that price; the action of highest value is chosen and the raise is
 * made AT the priced size (the draw raise and the pressure raise). With it off, every decision is
 * byte-identical.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, omahaDecisionMemosHeld, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_BIG_DRAW_OOP_REALISATION,
  omahaBigDrawEquities,
  type OmahaBigDrawCounts,
} from './HorseOmahaBigDrawAggression.js';
import { emptyStreetRead, validStreetRead } from './HorseOmahaStreetRead.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import { readFileSync } from 'node:fs';
import {
  OMAHA_PRICED_NO_READ,
  OMAHA_PRICED_SAMPLED_MARGIN,
  OMAHA_PRICED_SAMPLED_REFERENCE_FOLD,
  OMAHA_PRICED_SAMPLED_REFERENCE_MEASURED_THROUGH,
  omahaPricedSampledCandidates,
  omahaPricedSampledContinuingShare,
  omahaPricedSampledFoldAtPrice,
  omahaPricedSampledRaise,
  omahaPricedShrunk,
  type OmahaPricedSampledInput,
} from './HorseOmahaPricedRules.js';
import {
  LIVE,
  LIVE_OPTIONS,
  allPriced,
  cards,
  decideAt,
  pricedSpot,
  type PricedSpot,
  type PricedState,
} from './HorseOmahaPricedRules.test-support.js';
import {
  omahaPricedDrawRaiseRule,
  omahaPricedPressureRaiseSized,
  type OmahaPricedPressureAdmission,
  omahaPricedPressureWithheld,
  omahaPricedSampledAdmitsResize,
  omahaPricedSetStreetRatesSource,
} from './HorseOmahaPricedWiring.js';
import {
  OMAHA_PRICED_RAISE_GATE_OPTIONS,
  horseDecisionReceiptRefusal,
} from './horseDecision/responseValidation.js';
import type { HorseDecision } from '../types.js';

afterEach(() => {
  omahaPricedSetStreetRatesSource(null);
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const cell = (hit: number, opp: number) => ({ hit, opp });
const BOARD = 'Qh9h3d';
/** Heads-up flop, out of position, 900 behind on both sides: a wager of `bet` into `potBefore`. */
const spot = (
  hole: string,
  potBefore: number,
  bet: number,
  foldToRaise: { hit: number; opp: number } | null = null
): OmahaPricedSampledInput => ({
  street: 'flop',
  hole: cards(hole),
  board: cards(BOARD),
  pot: potBefore + bet,
  toCall: bet,
  stack: 900,
  heroBet: 0,
  currentBet: bet,
  to: 2 * bet,
  inPosition: false,
  opponents: [
    {
      stack: 900,
      bet,
      read: foldToRaise ? { ...OMAHA_PRICED_NO_READ, foldToRaise } : null,
    },
  ],
});
const legal = (potBefore: number, bet: number) => ({
  minTo: 2 * bet,
  maxTo: potBefore + 3 * bet,
  whole: true,
});
const atEverySize = (
  hole: string,
  potBefore: number,
  bet: number,
  foldToRaise: { hit: number; opp: number } | null = null
) =>
  omahaPricedSampledRaise({
    ...spot(hole, potBefore, bet, foldToRaise),
    sizes: legal(potBefore, bet),
  })!;

describe('the defect: one size, its fold share size-blind (option off, #11212)', () => {
  it('a minimum raise and a pot raise are priced with the same fold share, and no size is compared with another', () => {
    for (const read of [null, cell(18, 20), cell(1, 20)]) {
      const base = spot('2c3c7s8sKc', 100, 20, read);
      const min = omahaPricedSampledRaise({ ...base, to: 40 })!;
      const pot = omahaPricedSampledRaise({ ...base, to: 160 })!;
      expect(min.foldEquity).toBe(pot.foldEquity);
      expect(min.rows).toBeUndefined();
      expect(min.best).toBeUndefined();
      expect(min.action).toBeUndefined();
    }
  });
  it('air facing 20 into 100 raises the minimum on the fold share of an average raise; a weak draw does too', () => {
    // 2c3c7s8sKc on Qh9h3d: no pair, no draw (share 0.13 against the range that continues)
    const air = omahaPricedSampledRaise(spot('2c3c7s8sKc', 100, 20))!;
    expect(air.foldEquity).toBeCloseTo(0.1764, 4);
    expect(air.evCall).toBeLessThan(0);
    expect(air.raise).toBe(true);
    const draw = omahaPricedSampledRaise(spot('JsTs8c4d2d', 100, 20))!;
    expect(draw.raise).toBe(true);
  });
});

describe('the fold to a raise is read at the price the raise lays (omahaPricedSampledFoldAtPrice)', () => {
  const REF = OMAHA_PRICED_SAMPLED_REFERENCE_FOLD.flop;
  const at = (call: number, c: { hit: number; opp: number } | null = null, prior = 0.1764) =>
    omahaPricedSampledFoldAtPrice({ street: 'flop', prior, cell: c, laid: 100, call });
  // the increment that lays the reference price into 100: call / (100 + call) = REF
  const refCall = (100 * REF) / (1 - REF);
  it('with no cell it is the population figure at the reference price, and in proportion to the price elsewhere', () => {
    expect(at(refCall)).toBeCloseTo(0.1764, 10);
    expect(at(100)).toBeCloseTo((0.1764 * 0.5) / REF, 10);
    expect(at(25)).toBeCloseTo((0.1764 * 0.2) / REF, 10);
    let last = 0;
    for (const call of [5, 10, 25, 50, 100, 200, 400]) {
      const f = at(call);
      expect(f).toBeGreaterThan(last);
      last = f;
    }
  });
  it('a cell never makes a raise worth more than either reading of it', () => {
    for (const c of [cell(18, 20), cell(6, 15), cell(1, 20), cell(1, 1)])
      for (const call of [5, 25, 60, 100, 300]) {
        const f = at(call, c);
        const factor = Math.min(0.95, Math.max(0.03, call / (100 + call))) / REF;
        // the whole read carried to this price
        expect(f).toBeLessThanOrEqual(omahaPricedShrunk(c, 0.1764) * factor + 1e-12);
        // the cell shrunk toward the prior at this price
        expect(f).toBeLessThanOrEqual(omahaPricedShrunk(c, 0.1764 * factor) + 1e-12);
      }
    // a measured over-folder: a small raise buys a fraction of the fold a large one buys
    expect(at(10, cell(18, 20))).toBeLessThan(0.25);
    expect(at(100, cell(18, 20))).toBeGreaterThan(0.7);
    // a measured under-folder stays one at every size
    expect(at(400, cell(1, 20))).toBeLessThan(0.1764);
  });
  it('the reference prices are the measured ones', () => {
    expect(OMAHA_PRICED_SAMPLED_REFERENCE_FOLD).toEqual({ flop: 0.369, turn: 0.353 });
  });
});

describe('the fold, the call and a raise to each legal size, chosen by value (option on)', () => {
  it('every legal size is priced on its own fold share, which rises with the size', () => {
    for (const [potBefore, bet] of [
      [50, 50],
      [100, 20],
      [100, 100],
    ])
      for (const read of [null, cell(18, 20), cell(1, 20)]) {
        const v = atEverySize('AhKhJcTc2s', potBefore, bet, read);
        expect(v.rows!.map((r) => r.to)).toEqual([
          2 * bet,
          Math.round(2 * bet + 0.5 * (potBefore + bet)),
          potBefore + 3 * bet,
        ]);
        for (let k = 1; k < v.rows!.length; k++)
          expect(v.rows![k].foldEquity).toBeGreaterThan(v.rows![k - 1].foldEquity);
        // each row is the stated value: he folds and the pot is won, or he continues and the
        // Horse holds its realized share of the pot the raise builds
        const pot = potBefore + bet;
        for (const r of v.rows!) {
          const cost = r.to;
          const x = r.to - bet;
          const ev =
            r.foldEquity * pot +
            (1 - r.foldEquity) *
              (OMAHA_BIG_DRAW_OOP_REALISATION * r.equity * (pot + cost + x) - cost);
          expect(Math.abs(r.ev - ev)).toBeLessThan(0.15);
        }
        // the raise is the row of highest value; the action is the comparison of the three
        const top = Math.max(...v.rows!.map((r) => r.ev));
        expect(v.best!.ev).toBe(top);
        expect(v.evRaise).toBe(top);
        const raise = top > v.evCall + v.margin && top > 0;
        expect(v.raise).toBe(raise);
        expect(v.action).toBe(raise ? 'raise' : v.evCall > 0 ? 'call' : 'fold');
        expect(v.margin).toBeCloseTo(OMAHA_PRICED_SAMPLED_MARGIN * pot, 2);
      }
  });
  it('air facing 20 into 100: no raise size and no call is worth more than the fold (the old answer was the minimum raise)', () => {
    const v = atEverySize('2c3c7s8sKc', 100, 20);
    expect(v.rows!.length).toBe(3);
    for (const r of v.rows!) expect(r.ev).toBeLessThan(0);
    // the 20-chip raise lays him 20 into 140: far less than the fold share of an average raise
    expect(v.rows![0].foldEquity).toBeLessThan(0.08);
    expect(v.evCall).toBeLessThan(0);
    expect(v.raise).toBe(false);
    expect(v.action).toBe('fold');
  });
  it('a weak draw facing 20 into 100: the call is worth more than every raise size (the old answer was the minimum raise)', () => {
    const v = atEverySize('JsTs8c4d2d', 100, 20);
    expect(v.evCall).toBeGreaterThan(0);
    for (const r of v.rows!) expect(r.ev).toBeLessThan(v.evCall + v.margin);
    expect(v.action).toBe('call');
  });
  it('the nut flush draw with a wrap raises, and to the size of highest value', () => {
    const v = atEverySize('AhKhJcTc2s', 50, 50);
    expect(v.action).toBe('raise');
    expect(v.best!.to).toBe(200);
    expect(v.best!.ev).toBeGreaterThan(v.rows![0].ev);
  });
  it('against a measured over-folder the sizes are told apart: the minimum raise is not the raise', () => {
    const v = atEverySize('JsTs8c4d2d', 50, 50, cell(18, 20));
    expect(v.action).toBe('raise');
    expect(v.best!.to).toBeGreaterThan(v.rows![0].to);
    expect(v.best!.ev).toBeGreaterThan(v.rows![0].ev + v.margin);
  });
  it('the proposed size is priced beside the legal steps; an illegal one is not', () => {
    const base = { ...spot('AhKhJcTc2s', 100, 20), sizes: legal(100, 20) };
    expect(omahaPricedSampledRaise({ ...base, to: 77 })!.rows!.map((r) => r.to)).toEqual([
      40, 77, 100, 160,
    ]);
    expect(omahaPricedSampledRaise({ ...base, to: 30 })!.rows!.map((r) => r.to)).toEqual([
      40, 100, 160,
    ]);
    // no more than the deepest opponent holds; an all-in the menu does not offer is not priced
    const short = { ...base, opponents: [{ stack: 60, bet: 20, read: null }] };
    expect(omahaPricedSampledRaise({ ...short, to: 160 })!.rows!.map((r) => r.to)).toEqual([
      40, 60, 80,
    ]);
    const jam = { ...base, stack: 90, sizes: { ...legal(100, 20), canShove: false } };
    expect(omahaPricedSampledRaise({ ...jam, to: 90 })!.rows!.map((r) => r.to)).toEqual([40, 65]);
  });
});

describe('through the rule and the whole decision', () => {
  const FAMILY: HorseDecideOpts = {
    omahaNoDrawRaiseOutOfPosition: true,
    omahaDrawRaiseIsPriced: true,
    mind: false,
  } as HorseDecideOpts;
  const ON: HorseDecideOpts = { ...FAMILY, omahaSampledRaiseIsPricedAtEverySize: true };
  const ruleAt = (
    s: PricedSpot,
    opts: HorseDecideOpts,
    amount: (min: number, max: number) => number
  ) => {
    const st = pricedSpot(s);
    const decision: HorseDecision = {
      action: 'raise',
      amount: amount(st.gs.minRaiseTo as number, st.gs.maxRaiseTo as number),
      thinkTime: 1000,
    };
    enableBrainTelemetry();
    drainFires();
    const out = omahaPricedDrawRaiseRule(decision, st.hero, st.gs, {
      ...opts,
      telemetry: true,
    } as HorseDecideOpts);
    return { st, decision, out, fires: drainFires().map((f) => f.feature) };
  };
  it('a draw raise proposed at the minimum is made to the size of highest value; off, the size given is kept', () => {
    const s: PricedSpot = { hole: 'AhKhJcTc2s', board: BOARD, potBefore: 100, bet: 20 };
    const off = ruleAt(s, FAMILY, (min) => min);
    expect(off.out).toEqual(off.decision);
    expect(off.fires).toContain('omaha_priced_draw_raise_kept');
    const on = ruleAt(s, ON, (min) => min);
    expect(on.out!.action).toBe('raise');
    expect(on.out!.amount).toBe(160);
    expect(on.fires).toContain('omaha_priced_draw_raise_resized');
    // proposed at the size of highest value: kept as given
    const kept = ruleAt(s, ON, (_min, max) => max);
    expect(kept.out).toEqual(kept.decision);
    expect(kept.fires).toContain('omaha_priced_draw_raise_kept');
  });
  it('a weak draw raised to the minimum facing 20 into 100 becomes the call; off, the minimum raise stood', () => {
    const s: PricedSpot = { hole: 'JsTs8c4d2d', board: BOARD, potBefore: 100, bet: 20 };
    const off = ruleAt(s, FAMILY, (min) => min);
    expect(off.out!.action).toBe('raise');
    const on = ruleAt(s, ON, (min) => min);
    expect(on.out!.action).toBe('call');
    expect(on.out!.amount).toBe(20);
    expect(on.fires).toContain('omaha_priced_draw_raise_called');
  });

  const SPOTS: PricedSpot[] = [
    { hole: 'AhKhJcTc2s', board: BOARD },
    { hole: 'AhKhJcTc2s', board: BOARD, potBefore: 100, bet: 20 },
    { hole: 'JsTs8c4d2d', board: BOARD, potBefore: 100, bet: 20 },
    { hole: 'JsTs8c4d2d', board: BOARD, potBefore: 100, bet: 50, inPosition: true },
    { hole: '2c3c7s8sKc', board: BOARD, potBefore: 100, bet: 20 },
    { hole: '6h5h8c4d2d', board: BOARD, potBefore: 60, bet: 60 },
    { hole: 'AhKhJcTc2s', board: 'Qh9h3d2c', potBefore: 100, bet: 30 },
    { hole: 'JsTs8c4d2d', board: 'Qh9h3d2c', potBefore: 100, bet: 30, inPosition: true },
    // review note C1: the brain's own draw raise (here its all-in) is resized to the priced size
    { hole: 'AhKhJcTc2s', board: BOARD, potBefore: 216, bet: 100 },
  ];
  const SEEDS = [1, 3, 7, 11, 42, 2026];
  const bytes = (d: unknown) =>
    JSON.stringify(withoutMeasurements({ ...(d as object), thinkTime: 0 }));
  const OPTION = 'omahaSampledRaiseIsPricedAtEverySize';
  it('unset, false and a truthy non-boolean are byte-identical; alone (no family on) it changes nothing', () => {
    for (const s of SPOTS) {
      const st = pricedSpot(s);
      for (const seed of SEEDS.slice(0, 3))
        for (const base of [
          { ...LIVE_OPTIONS, ...allPriced(true) },
          { ...LIVE_OPTIONS, omahaDrawRaiseIsPriced: true },
          { ...LIVE_OPTIONS, omahaPressureIsPriced: true },
        ] as HorseDecideOpts[]) {
          const want = bytes(decideAt(st, base, seed));
          expect(bytes(decideAt(st, { ...base, [OPTION]: false }, seed))).toBe(want);
          expect(bytes(decideAt(st, { ...base, [OPTION]: 1 } as never, seed))).toBe(want);
        }
      for (const seed of SEEDS.slice(0, 3)) {
        expect(bytes(decideAt(st, { ...LIVE_OPTIONS, [OPTION]: true }, seed))).toBe(
          bytes(decideAt(st, LIVE_OPTIONS, seed))
        );
        expect(bytes(decideAt(st, { [OPTION]: true }, seed))).toBe(bytes(decideAt(st, {}, seed)));
      }
    }
  });
  it('on, with its families: every decision is legal and passes the receipt validator', () => {
    const configs = [
      { ...LIVE_OPTIONS, ...allPriced(true), [OPTION]: true },
      { ...LIVE_OPTIONS, omahaDrawRaiseIsPriced: true, [OPTION]: true },
      { ...LIVE_OPTIONS, omahaPressureIsPriced: true, [OPTION]: true },
      { ...allPriced(true), [OPTION]: true },
    ] as HorseDecideOpts[];
    let changed = 0;
    let resized = 0;
    for (const s of SPOTS) {
      const st = pricedSpot(s);
      for (const seed of SEEDS)
        for (const opts of configs) {
          const without = decideAt(st, { ...opts, [OPTION]: false }, seed);
          const d = decideAt(st, opts, seed);
          expect(st.gs.legalActions).toContain(d.action);
          if (d.action === 'raise') {
            expect(d.amount!).toBeGreaterThanOrEqual((st.gs.minRaiseTo as number) - 1e-9);
            expect(d.amount!).toBeLessThanOrEqual((st.gs.maxRaiseTo as number) + 1e-9);
          }
          expect(
            horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
              player: st.hero,
              gameState: st.gs,
              omahaPricedRaise: OMAHA_PRICED_RAISE_GATE_OPTIONS.some(
                (name) => (opts as Record<string, unknown>)[name] === true
              ),
            })
          ).toBeNull();
          if (bytes(d) !== bytes(without)) changed++;
          // a raise the option moved to another size passes the dedicated exact admission
          if (
            (d.action === 'raise' || d.action === 'all_in') &&
            (without.action === 'raise' || without.action === 'all_in') &&
            (d.action !== without.action || d.amount !== without.amount)
          ) {
            resized++;
            expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, d.action, d.amount)).toBe(true);
          }
        }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[sampled raise at every size, whole decision] decisions changed by the option: ${changed}, raises resized: ${resized}`
    );
    // not vacuous: the option changes whole decisions in these spots, and moves raises to another
    // size (so the dedicated admission above is exercised, review note C1)
    expect(changed).toBeGreaterThan(0);
    expect(resized).toBeGreaterThan(0);
  });

  // ── review note C1: a DRAW raise resized end to end, through HorseLogic.decide ──
  const DRAW_WHOLE = { ...LIVE_OPTIONS, omahaDrawRaiseIsPriced: true } as HorseDecideOpts;
  const decideTold = (st: PricedState, opts: HorseDecideOpts, seed: number) => {
    HorseMind.reset();
    const now = st.fresh();
    enableBrainTelemetry();
    drainFires();
    seedFastRandom(seed);
    const d = structuredClone(
      HorseLogic.decide(now.hero, now.gs, LIVE.style, LIVE.mods, {
        observeMind: false,
        decisionTimeMs: 1794938400000,
        telemetry: true,
        ...opts,
      } as never)
    );
    return { d, now, fires: drainFires().map((f) => f.feature) };
  };
  it('C1: through the whole decision the brain makes a draw raise and it is made at the priced size', () => {
    // The nut flush draw with a wrap out of position: the brain raises (or shoves) at its own size;
    // with the option on the draw-raise rule makes that raise at the size of highest value.
    const FIXTURES: Array<{ s: PricedSpot; seed: number }> = [
      { s: { hole: 'AhKhJcTc2s', board: BOARD, potBefore: 100, bet: 50 }, seed: 2 },
      { s: { hole: 'AhKhJcTc2s', board: BOARD, potBefore: 100, bet: 30 }, seed: 4 },
      { s: { hole: 'AhKhJcTc2s', board: BOARD, potBefore: 216, bet: 100 }, seed: 1 },
    ];
    const moved: Array<{
      st: PricedState;
      on: ReturnType<typeof decideTold>;
      off: ReturnType<typeof decideTold>;
    }> = [];
    for (const { s, seed } of FIXTURES) {
      const st = pricedSpot(s);
      const off = decideTold(st, { ...DRAW_WHOLE, [OPTION]: false }, seed);
      const on = decideTold(st, { ...DRAW_WHOLE, [OPTION]: true }, seed);
      const raised = (d: HorseDecision) => d.action === 'raise' || d.action === 'all_in';
      if (
        raised(off.d) &&
        raised(on.d) &&
        (on.d.action !== off.d.action || on.d.amount !== off.d.amount)
      )
        moved.push({ st, on, off });
    }
    // not vacuous: at least one whole decision moves the brain's draw raise to another size
    expect(moved.length).toBeGreaterThan(0);
    let ruledRaises = 0;
    for (const { st, on, off } of moved) {
      // the draw-raise rule did it, priced above the call (not the mix), under its receipt
      expect(on.fires).toContain('omaha_priced_draw_raise_resized');
      expect(on.fires).not.toContain('omaha_priced_draw_raise_mixed_resized');
      expect(off.fires).not.toContain('omaha_priced_draw_raise_resized');
      // a raise the brain gave (not its shove, which other owners may make of another raise): the
      // size made is the rule's own answer for it on the same public state, the size of highest value
      if (off.d.action === 'raise') {
        HorseMind.reset();
        const fresh = st.fresh();
        const ruled = omahaPricedDrawRaiseRule(off.d, fresh.hero, fresh.gs, {
          ...DRAW_WHOLE,
          [OPTION]: true,
        } as HorseDecideOpts)!;
        expect([on.d.action, on.d.amount]).toEqual([ruled.action, ruled.amount]);
        ruledRaises++;
      }
      // legal, admitted by the dedicated exact admission and by the whole receipt validator
      expect(st.gs.legalActions).toContain(on.d.action);
      if (on.d.action === 'raise') {
        expect(on.d.amount!).toBeGreaterThanOrEqual((st.gs.minRaiseTo as number) - 1e-9);
        expect(on.d.amount!).toBeLessThanOrEqual((st.gs.maxRaiseTo as number) + 1e-9);
      }
      expect(omahaPricedSampledAdmitsResize(on.now.hero, on.now.gs, on.d.action, on.d.amount)).toBe(
        true
      );
      expect(
        horseDecisionReceiptRefusal(structuredClone(on.d), 'plo5', {
          player: on.now.hero,
          gameState: on.now.gs,
          omahaPricedRaise: false,
        })
      ).toBeNull();
      // the size moved drops the notes of the old one
      expect(on.d.valueSize).toBeUndefined();
    }
    expect(ruledRaises).toBeGreaterThan(0);
  });
});

describe('review notes (REVIEW-7339ae3f40e N1, N2, N4 to N9)', () => {
  const REF = OMAHA_PRICED_SAMPLED_REFERENCE_FOLD.flop;
  const PRIOR = 0.1764;
  const foldAt = (
    call: number,
    c: { hit: number; opp: number; price?: number } | null,
    laid = 120,
    street: 'flop' | 'turn' = 'flop'
  ) => omahaPricedSampledFoldAtPrice({ street, prior: PRIOR, cell: c, laid, call });
  const HAND = 'AhKhJcTc2s';
  const rowsOf = (i: OmahaPricedSampledInput) => omahaPricedSampledRaise(i)!.rows!;

  it('N2: a cell that carries the price it was measured at is carried from THAT price', () => {
    const c = { hit: 60, opp: 200 };
    // measured at the reference price: the figure a cell with no price gives
    for (const call of [10, 40, 120, 300])
      expect(foldAt(call, { ...c, price: REF })).toBeCloseTo(foldAt(call, c), 12);
    // measured over pot raises (price 0.5) and priced at a pot raise: his rate as measured, shrunk
    // toward the prior at this price, never scaled up again
    const atPot = foldAt(120, { ...c, price: 0.5 });
    expect(atPot).toBeCloseTo(omahaPricedShrunk(c, (PRIOR * 0.5) / REF), 12);
    expect(foldAt(120, { hit: 300, opp: 1000, price: 0.5 })).toBeLessThanOrEqual(0.3 + 1e-9);
    // the same cell at a 20-chip raise: carried down from 0.5, not from the reference price, so it
    // folds less than the cell read as if it had been measured at the reference price
    const small = foldAt(20, { ...c, price: 0.5 });
    const smallAtReference = foldAt(20, c);
    expect(small).toBeLessThan(smallAtReference);
    const model = 20 / 140;
    expect(small).toBeCloseTo(
      omahaPricedShrunk({ hit: (60 * model) / 0.5, opp: 200 }, (PRIOR * model) / REF),
      12
    );
    // the fold still rises with the price laid
    let last = 0;
    for (const call of [5, 20, 60, 120, 400]) {
      const f = foldAt(call, { ...c, price: 0.5 });
      expect(f).toBeGreaterThan(last);
      last = f;
    }
  });
  it('N2: no stored cell carries a price today, so the reference stands only to its cutoff and the option stays off', () => {
    const row = emptyStreetRead();
    expect(validStreetRead(row)).toBe(true);
    (row.foldToRaise.flop as { price?: number }).price = 0.4;
    // the stored row is exactly {hit, opp}: a price needs a counter migration
    expect(validStreetRead(row)).toBe(false);
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaSampledRaiseIsPricedAtEverySize');
    expect(OMAHA_PRICED_SAMPLED_REFERENCE_MEASURED_THROUGH).toBe('2026-11-15');
    const authority = readFileSync(
      new URL(
        '../../../docs/horse-option-authority.d/omahaSampledRaiseIsPricedAtEverySize.md',
        import.meta.url
      ),
      'utf8'
    );
    expect(authority).toContain('price-indexed cell is required before switch-on');
    expect(authority).toContain(OMAHA_PRICED_SAMPLED_REFERENCE_MEASURED_THROUGH);
  });

  it('N4: the range that continues is the strongest share of his range, and tightens with the fold', () => {
    const eq = { all: 0.5, bet: 0.4, raise: 0.25 };
    // 200 hands continue against a bet, the strongest 80 against a raise: the Horse holds 0.25
    // against those and 0.5 against the other 120
    const counts: OmahaBigDrawCounts = { got: [400, 200, 80], won: [200, 80, 20] };
    const share = (fold: number, k: OmahaBigDrawCounts | null = counts) =>
      omahaPricedSampledContinuingShare(eq, k, fold);
    expect(share(0)).toBeCloseTo(0.4, 12);
    expect(share(0.2)).toBeCloseTo((0.4 * 0.25 + 0.4 * 0.5) / 0.8, 12);
    expect(share(0.6)).toBe(0.25);
    expect(share(0.9)).toBe(0.25);
    let last = 1;
    for (const fold of [0, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8]) {
      expect(share(fold)).toBeLessThanOrEqual(last);
      last = share(fold);
    }
    // a class too thin to split, or no sample: the one figure
    expect(share(0.1, { got: [400, 200, 30], won: [200, 80, 8] })).toBe(0.25);
    expect(share(0.1, null)).toBe(0.25);
    // on the sample itself: asking for the counts does not move the shares, and each row holds
    // its own share, nearer the raise-continuing figure the larger the raise
    const got: OmahaBigDrawCounts = { got: [], won: [] };
    const e = omahaBigDrawEquities(cards(HAND), cards(BOARD), [], undefined, got)!;
    expect(e).toEqual(omahaBigDrawEquities(cards(HAND), cards(BOARD))!);
    expect(got.got[1]).toBeGreaterThan(got.got[2]);
    const v = atEverySize(HAND, 100, 20);
    expect(v.equities).toEqual(e);
    for (const r of v.rows!)
      expect(r.equity).toBeCloseTo(omahaPricedSampledContinuingShare(e, got, r.foldEquity), 3);
    for (let k = 1; k < v.rows!.length; k++)
      expect(Math.abs(v.rows![k].equity - e.raise)).toBeLessThan(
        Math.abs(v.rows![k - 1].equity - e.raise)
      );
  });

  it('N5, N9: two opponents: each is priced on HIS call and the fold share is the product', () => {
    const base = spot(HAND, 100, 20);
    const two = {
      ...base,
      opponents: [
        { stack: 900, bet: 20, read: null },
        { stack: 900, bet: 0, read: null },
      ],
      sizes: legal(100, 20),
    };
    for (const r of rowsOf(two)) {
      // the bettor pays the increment; the player still to answer pays the whole raise
      const bettor = foldAt(r.to - 20, null, 140);
      const behind = foldAt(r.to, null, 140);
      expect(behind).toBeGreaterThan(bettor);
      expect(r.foldEquity).toBeCloseTo(bettor * behind, 4);
    }
    // heads-up rows fold more often than the same raise into two
    const one = rowsOf({ ...base, sizes: legal(100, 20) });
    rowsOf(two).forEach((r, k) => expect(r.foldEquity).toBeLessThan(one[k].foldEquity));
    // his call is no more than his stack; the raise is matched by the deepest opponent
    const short = {
      ...two,
      opponents: [two.opponents[0], { stack: 30, bet: 0, read: null }],
    };
    const top = rowsOf(short).at(-1)!;
    expect(top.to).toBe(160);
    expect(top.foldEquity).toBeCloseTo(foldAt(140, null, 140) * foldAt(30, null, 140), 4);
    // a measured read of one opponent moves his factor alone
    const read = {
      ...two,
      opponents: [
        two.opponents[0],
        { stack: 900, bet: 0, read: { ...OMAHA_PRICED_NO_READ, foldToRaise: cell(18, 20) } },
      ],
    };
    for (const r of rowsOf(read))
      expect(r.foldEquity).toBeCloseTo(
        foldAt(r.to - 20, null, 140) * foldAt(r.to, cell(18, 20), 140),
        4
      );
  });

  it('N9: a short stack: the largest size is the all-in; with less than a full raise left it is the only one', () => {
    const base = spot(HAND, 100, 20);
    const v = omahaPricedSampledRaise({
      ...base,
      stack: 100,
      sizes: { ...legal(100, 20), maxTo: 100 },
    })!;
    expect(v.rows!.map((r) => [r.to, r.jam])).toEqual([
      [40, false],
      [70, false],
      [100, true],
    ]);
    // the all-in realizes its whole share (no later street), the others the out-of-position part
    const jam = v.rows![2];
    expect(
      Math.abs(jam.ev - (jam.foldEquity * 120 + (1 - jam.foldEquity) * (jam.equity * 300 - 100)))
    ).toBeLessThan(0.15);
    // 30 behind facing 20 (the minimum raise is to 40): the all-in for less than a full raise
    const less = { ...base, stack: 30, to: 30, sizes: { minTo: 40, maxTo: 30, whole: true } };
    expect(rowsOf(less).map((r) => [r.to, r.jam])).toEqual([[30, true]]);
    // the menu: no all-in offered, no raise offered, neither
    expect(
      omahaPricedSampledRaise({ ...less, sizes: { ...less.sizes, canShove: false } })
    ).toBeNull();
    const menu = (m: { canRaise?: boolean; canShove?: boolean }) =>
      omahaPricedSampledRaise({
        ...base,
        stack: 100,
        sizes: { ...legal(100, 20), maxTo: 100, ...m },
      });
    expect(menu({ canRaise: false })!.rows!.map((r) => r.to)).toEqual([100]);
    expect(menu({ canShove: false })!.rows!.map((r) => r.to)).toEqual([40, 70]);
    expect(menu({ canRaise: false, canShove: false })).toBeNull();
  });

  it('N9: a fractional-chip table prices fractional sizes', () => {
    const base = { ...spot(HAND, 1.1, 0.25), to: 0.5 };
    const sizes = { minTo: 0.5, maxTo: 1.85, whole: false };
    const rows = rowsOf({ ...base, sizes });
    expect(rows.map((r) => r.to)).toEqual([0.5, Math.round(1.175 * 100) / 100, 1.85]);
    expect(Number.isInteger(rows[1].to)).toBe(false);
    for (let k = 1; k < rows.length; k++)
      expect(rows[k].foldEquity).toBeGreaterThan(rows[k - 1].foldEquity);
    // on a whole-chip table the middle size is a whole chip (the ends are the legal ends)
    expect(rowsOf({ ...base, sizes: { ...sizes, whole: true } }).map((r) => r.to)).toEqual([
      0.5, 1, 1.85,
    ]);
  });

  it('N9: a turn spot at function level reads the turn reference price', () => {
    const turn: OmahaPricedSampledInput = {
      ...spot(HAND, 100, 30),
      street: 'turn',
      board: cards('Qh9h3d2c'),
      sizes: legal(100, 30),
    };
    const v = omahaPricedSampledRaise(turn)!;
    expect(v.rows!.map((r) => r.to)).toEqual([60, 125, 190]);
    for (const r of v.rows!) {
      expect(r.foldEquity).toBeCloseTo(foldAt(r.to - 30, null, 160, 'turn'), 4);
      expect(r.foldEquity).toBeGreaterThan(foldAt(r.to - 30, null, 160, 'flop'));
    }
    expect(v.best!.ev).toBe(Math.max(...v.rows!.map((r) => r.ev)));
    expect(v.action).toBe(v.raise ? 'raise' : v.evCall > 0 ? 'call' : 'fold');
  });

  it('N7: the legal sizes are priced whatever the proposed size is', () => {
    const base = { ...spot(HAND, 100, 20), sizes: legal(100, 20) };
    for (const to of [20, 0, Number.NaN])
      expect(rowsOf({ ...base, to }).map((r) => r.to)).toEqual([40, 100, 160]);
    // without the range the one size given must be a raise, as before
    expect(omahaPricedSampledRaise({ ...spot(HAND, 100, 20), to: 20 })).toBeNull();
    expect(
      omahaPricedSampledCandidates(
        { stack: 900, heroBet: 0, currentBet: 20, opponents: [{ stack: 900, bet: 20 }] },
        legal(100, 20)
      )
    ).toEqual([40, 100, 160]);
  });

  const ruleOn = (
    st: ReturnType<typeof pricedSpot>,
    opts: HorseDecideOpts,
    decision: HorseDecision,
    seed = 1
  ) => {
    enableBrainTelemetry();
    drainFires();
    seedFastRandom(seed);
    const out = omahaPricedDrawRaiseRule(decision, st.hero, st.gs, {
      ...opts,
      telemetry: true,
    } as HorseDecideOpts);
    return { out, fires: drainFires().map((f) => f.feature) };
  };
  const DRAW_ON = {
    omahaNoDrawRaiseOutOfPosition: true,
    omahaDrawRaiseIsPriced: true,
    omahaSampledRaiseIsPricedAtEverySize: true,
    mind: false,
  } as HorseDecideOpts;
  /** the spot with the Horse `behind` chips deep (its all-in is then a legal size) */
  const shortSpot = (s: PricedSpot, behind: number) => {
    const st = pricedSpot(s);
    st.hero.stack = behind;
    for (const p of st.gs.players ?? []) if (p.seat === st.hero.seat) p.stack = behind;
    st.gs.maxRaiseTo = Math.min(st.gs.maxRaiseTo as number, behind + (st.hero.bet ?? 0));
    return st;
  };

  it('N8, N9: the resize to the whole stack is the all-in; a changed amount carries no old size note', () => {
    const s: PricedSpot = { hole: HAND, board: BOARD, potBefore: 100, bet: 20 };
    const st = shortSpot(s, 100);
    const decision = {
      action: 'raise',
      amount: 40,
      thinkTime: 1000,
      valueSize: { amount: 40 },
      continuationGuard: 'x',
    } as unknown as HorseDecision;
    const { out, fires } = ruleOn(st, DRAW_ON, decision);
    expect(fires).toContain('omaha_priced_draw_raise_resized');
    expect(out!.action).toBe('all_in');
    expect(out!.amount).toBeUndefined();
    expect(out!.valueSize).toBeUndefined();
    expect(out!.continuationGuard).toBeUndefined();
    expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, 'all_in', undefined)).toBe(true);
    // the all-in given, already the size of highest value, is kept with its notes
    const jam = { ...decision, action: 'all_in' } as HorseDecision;
    delete jam.amount;
    const kept = ruleOn(st, DRAW_ON, jam);
    expect(kept.out).toBe(jam);
    expect(kept.fires).toContain('omaha_priced_draw_raise_kept');
    // a deep raise resized keeps the raise action and drops the notes too
    const deep = pricedSpot(s);
    const moved = ruleOn(deep, DRAW_ON, decision);
    expect(moved.out!.action).toBe('raise');
    expect(moved.out!.amount).toBe(160);
    expect(moved.out!.valueSize).toBeUndefined();
  });

  it('N9: two opponents through the rule: the raise is still made at a priced legal size', () => {
    const st = pricedSpot({ hole: HAND, board: BOARD, potBefore: 100, bet: 20 });
    const opp = (st.gs.players ?? []).find((p) => p.seat !== st.hero.seat)!;
    st.gs.players!.push({ ...opp, seat: 3, user_id: 'third-player', bet: 0, stack: 500 });
    const decision: HorseDecision = { action: 'raise', amount: 40, thinkTime: 1000 };
    const { out, fires } = ruleOn(st, DRAW_ON, decision);
    expect(['raise', 'call']).toContain(out!.action);
    if (out!.action === 'raise') {
      expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, 'raise', out!.amount)).toBe(true);
      expect([40, 100, 160]).toContain(out!.amount);
    } else expect(fires).toContain('omaha_priced_draw_raise_called');
    // three opponents cannot be sampled: no size is admitted
    st.gs.players!.push({ ...opp, seat: 4, user_id: 'fourth-player', bet: 0, stack: 500 });
    expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, 'raise', 160)).toBe(false);
  });

  it('N1: the validator admission is the exact chips of a priced size, in the sampled spot only', () => {
    const st = pricedSpot({ hole: HAND, board: BOARD, potBefore: 100, bet: 20 });
    const admits = (action: string, amount?: number, at = st) =>
      omahaPricedSampledAdmitsResize(at.hero, at.gs, action, amount);
    for (const to of [40, 100, 160]) expect(admits('raise', to)).toBe(true);
    for (const to of [20, 39, 41, 99.99, 101, 160.5, 161, 500])
      expect(admits('raise', to)).toBe(false);
    expect(admits('raise', undefined)).toBe(false);
    expect(admits('call', 20)).toBe(false);
    // deep: the whole stack is not a priced size
    expect(admits('all_in')).toBe(false);
    const short = shortSpot({ hole: HAND, board: BOARD, potBefore: 100, bet: 20 }, 100);
    expect(admits('all_in', undefined, short)).toBe(true);
    expect(admits('raise', 100, short)).toBe(false);
    expect(admits('raise', 70, short)).toBe(true);
    // the river is not a sampled spot
    const river = pricedSpot({ hole: HAND, board: 'Qh9h3d2c5s', potBefore: 100, bet: 20 });
    expect(admits('raise', 160, river)).toBe(false);
  });

  const PRESS = {
    omahaPressureIsPriced: true,
    omahaSampledRaiseIsPricedAtEverySize: true,
    mind: false,
    telemetry: true,
  } as HorseDecideOpts;
  const sized = (
    st: ReturnType<typeof pricedSpot>,
    d: HorseDecision,
    admission: OmahaPricedPressureAdmission | null,
    opts = PRESS
  ) => {
    enableBrainTelemetry();
    drainFires();
    const out = omahaPricedPressureRaiseSized(d, st.hero, st.gs, opts, admission);
    return { out, fires: drainFires().map((f) => f.feature) };
  };
  const minRaise = (st: ReturnType<typeof pricedSpot>) =>
    ({
      action: 'raise',
      amount: st.gs.minRaiseTo as number,
      thinkTime: 1000,
      valueSize: { amount: st.gs.minRaiseTo },
    }) as unknown as HorseDecision;
  // top set (no draw the bar names) and the nut flush draw with a wrap
  it.each(['QsQd7c4c2s', HAND])(
    'N1: a pressure raise admitted at a priced size is made at that size (%s)',
    (hole) => {
      const st = pricedSpot({ hole, board: BOARD, potBefore: 50, bet: 50 });
      const d = minRaise(st);
      // the pricing says the raise is admitted at a priced size; it keeps nothing itself
      const told: OmahaPricedPressureAdmission = {};
      expect(omahaPricedPressureWithheld('raise', st.hero, st.gs, PRESS, {} as never, told)).toBe(
        false
      );
      expect(told.sampledAtPrice).toBe(true);
      expect(Number.isFinite(told.sampledTo)).toBe(true);
      // the caller's record of ITS decision is the only carrier: without it, on the same state
      // and straight after that pricing, the raise is the decision given
      expect(sized(st, d, null).out).toBe(d);
      expect(sized(st, d, {}).out).toBe(d);
      expect(sized(pricedSpot({ hole, board: BOARD, potBefore: 50, bet: 50 }), d, null).out).toBe(
        d
      );
      const on = sized(st, d, told);
      expect(on.fires).toContain('omaha_priced_pressure_raise_resized');
      expect(on.out.action).toBe('raise');
      expect(on.out.amount!).toBeGreaterThan(d.amount!);
      // made at the size the admission priced (the brain's size is a priced step here)
      expect(on.out.amount).toBe(told.sampledTo);
      expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, 'raise', on.out.amount)).toBe(true);
      expect(on.out.valueSize).toBeUndefined();
      // the size of highest value given: kept as it is
      expect(sized(st, on.out, told).out).toBe(on.out);
      // not a raise: untouched
      const call: HorseDecision = { action: 'call', amount: 50, thinkTime: 0 };
      expect(sized(st, call, told).out).toBe(call);
      // either option off: the decision itself, whatever the caller says
      for (const off of [
        { ...PRESS, omahaSampledRaiseIsPricedAtEverySize: false },
        { ...PRESS, omahaSampledRaiseIsPricedAtEverySize: 1 },
        { ...PRESS, omahaPressureIsPriced: false },
      ] as HorseDecideOpts[])
        expect(sized(st, d, told, off).out).toBe(d);
      // a draw the draw rule owns is priced and sized there, once
      const owned = sized(st, d, told, {
        ...PRESS,
        omahaNoDrawRaiseOutOfPosition: true,
        omahaDrawRaiseIsPriced: true,
      } as HorseDecideOpts);
      if (hole === HAND) expect(owned.out).toBe(d);
      else expect(owned.fires).toContain('omaha_priced_pressure_raise_resized');
    }
  );
  it('in a Lightning pool the pressure raise is sized, and its size admitted, only with omahaPricedInLightning', () => {
    const lightning = (st: ReturnType<typeof pricedSpot>) => {
      (st.gs as unknown as { publicMemoryDomain: object }).publicMemoryDomain = {
        version: 1,
        speed: 'lightning',
        ante: 'bb',
      };
      return st;
    };
    const table = pricedSpot({ hole: 'QsQd7c4c2s', board: BOARD, potBefore: 50, bet: 50 });
    const told: OmahaPricedPressureAdmission = {};
    omahaPricedPressureWithheld('raise', table.hero, table.gs, PRESS, {} as never, told);
    expect(told.sampledAtPrice).toBe(true);
    const atTable = sized(table, minRaise(table), told);
    expect(atTable.fires).toContain('omaha_priced_pressure_raise_resized');
    const st = lightning(pricedSpot({ hole: 'QsQd7c4c2s', board: BOARD, potBefore: 50, bet: 50 }));
    const d = minRaise(st);
    // the scope option off, unset or not exactly true: Lightning is outside the priced scope, as before
    for (const off of [
      PRESS,
      { ...PRESS, omahaPricedInLightning: false },
      { ...PRESS, omahaPricedInLightning: 1 },
    ] as HorseDecideOpts[])
      expect(sized(st, d, told, off).out).toBe(d);
    expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, 'raise', atTable.out.amount)).toBe(false);
    expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, 'raise', atTable.out.amount, false)).toBe(
      false
    );
    // on: the same size as at a table, and the receipt admission follows the same gate
    const on = sized(st, d, told, { ...PRESS, omahaPricedInLightning: true } as HorseDecideOpts);
    expect(on.fires).toContain('omaha_priced_pressure_raise_resized');
    expect([on.out.action, on.out.amount]).toEqual([atTable.out.action, atTable.out.amount]);
    expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, 'raise', on.out.amount, true)).toBe(true);
    // the gate opens nothing at a table
    expect(omahaPricedSampledAdmitsResize(table.hero, table.gs, 'raise', on.out.amount, true)).toBe(
      omahaPricedSampledAdmitsResize(table.hero, table.gs, 'raise', on.out.amount)
    );
  });
  it('N1: a pressure raise the price withholds, or priced with the size option off, tells the caller nothing', () => {
    const air = pricedSpot({ hole: '2c3c7s8sKc', board: BOARD, potBefore: 100, bet: 20 });
    const told: OmahaPricedPressureAdmission = {};
    expect(omahaPricedPressureWithheld('raise', air.hero, air.gs, PRESS, {} as never, told)).toBe(
      true
    );
    expect(told.sampledAtPrice).toBeUndefined();
    expect(told.sampledTo).toBeUndefined();
    const st = pricedSpot({ hole: 'QsQd7c4c2s', board: BOARD, potBefore: 60, bet: 60 });
    const OFF = { ...PRESS, omahaSampledRaiseIsPricedAtEverySize: false } as HorseDecideOpts;
    expect(omahaPricedPressureWithheld('raise', st.hero, st.gs, OFF, {} as never, told)).toBe(
      false
    );
    expect(told.sampledAtPrice).toBeUndefined();
    // the call-down asks nothing of the raise size
    omahaPricedPressureWithheld('call_down', st.hero, st.gs, PRESS, {} as never, told);
    expect(told.sampledAtPrice).toBeUndefined();
    expect(told.sampledTo).toBeUndefined();
    // told nothing, a raise is not resized
    const d = minRaise(air);
    expect(sized(air, d, told).out).toBe(d);
  });

  // ── the whole decision: the brain itself prices and admits the pressure raise ──
  // The mind is on with an empty memory, so the bettor's read is the PLO presumption (aggressive):
  // the brain's V53 block holds a pressure read and asks its price.
  const WHOLE = {
    ...LIVE_OPTIONS,
    omahaPressureIsPriced: true,
    omahaSampledRaiseIsPricedAtEverySize: true,
  } as HorseDecideOpts;
  const whole = (st: ReturnType<typeof pricedSpot>, opts: HorseDecideOpts, seed: number) => {
    HorseMind.reset();
    const now = st.fresh();
    enableBrainTelemetry();
    drainFires();
    seedFastRandom(seed);
    const d = structuredClone(
      HorseLogic.decide(now.hero, now.gs, LIVE.style, LIVE.mods, {
        observeMind: false,
        decisionTimeMs: 1794938400000,
        telemetry: true,
        ...opts,
      } as never)
    );
    return { d, now, fires: drainFires().map((f) => f.feature) };
  };
  const wholeBytes = (d: unknown) =>
    JSON.stringify(withoutMeasurements({ ...(d as object), thinkTime: 0 }));
  /** the first spot and seed where the brain's own pressure raise is resized */
  const firstResized = () => {
    for (const hole of ['QsQd7c4c2s', 'QsQd9c4c2s', 'Qs9s3c7c2d', '9s9d7c4c2s'])
      for (const [potBefore, bet] of [
        [50, 50],
        [100, 50],
        [60, 60],
        [100, 30],
      ])
        for (let seed = 1; seed <= 12; seed++) {
          const st = pricedSpot({ hole, board: BOARD, potBefore, bet });
          const on = whole(st, WHOLE, seed);
          if (on.fires.includes('omaha_priced_pressure_raise_resized')) return { st, seed, on };
        }
    return null;
  };
  it('T1: through the whole decision the brain prices and admits the pressure raise, and it is made at the priced size', () => {
    const found = firstResized();
    expect(found).not.toBeNull();
    const { st, seed, on } = found!;
    // the brain asked the price of the pressure raise and the sampled comparison admitted it
    expect(on.fires).toContain('omaha_priced_pressure_raise_admitted');
    expect(['raise', 'all_in']).toContain(on.d.action);
    // the same decision without the size option: the brain's own size, another one
    const off = whole(st, { ...WHOLE, omahaSampledRaiseIsPricedAtEverySize: false }, seed);
    expect(['raise', 'all_in']).toContain(off.d.action);
    expect(off.fires).not.toContain('omaha_priced_pressure_raise_resized');
    expect([on.d.action, on.d.amount]).not.toEqual([off.d.action, off.d.amount]);
    // made at a priced size: the dedicated exact admission and the whole receipt validator
    expect(omahaPricedSampledAdmitsResize(on.now.hero, on.now.gs, on.d.action, on.d.amount)).toBe(
      true
    );
    if (on.d.action === 'raise') {
      expect(on.d.amount!).toBeGreaterThanOrEqual((on.now.gs.minRaiseTo as number) - 1e-9);
      expect(on.d.amount!).toBeLessThanOrEqual((on.now.gs.maxRaiseTo as number) + 1e-9);
    }
    expect(
      horseDecisionReceiptRefusal(structuredClone(on.d), 'plo5', {
        player: on.now.hero,
        gameState: on.now.gs,
        omahaPricedRaise: false,
      })
    ).toBeNull();
    // nothing of the decision is held once it has answered
    expect(omahaDecisionMemosHeld()).toEqual([]);
    // review note C2: the SAME state object decided a second time, its pressure raise not priced (mind off),
    // inherits nothing from the decision just made on it
    enableBrainTelemetry();
    drainFires();
    seedFastRandom(seed);
    HorseLogic.decide(on.now.hero, on.now.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      decisionTimeMs: 1794938400000,
      telemetry: true,
      ...WHOLE,
      mind: false,
    } as never);
    expect(drainFires().map((f) => f.feature)).not.toContain('omaha_priced_pressure_raise_resized');
    expect(omahaDecisionMemosHeld()).toEqual([]);
    // the same decision again answers the same
    expect(wholeBytes(whole(st, WHOLE, seed).d)).toBe(wholeBytes(on.d));
  });
  it('T1: a second decision on the same public spot, its pressure raise not priced, inherits nothing', () => {
    // The second decision keeps the two priced options on, but its brain does not ask the price
    // of the pressure play: omahaPressureNeedsPostflopAggression off (the label admits the play),
    // or the mind off (no pressure read at all).
    const SECOND = [
      { ...WHOLE, omahaPressureNeedsPostflopAggression: false },
      { ...WHOLE, mind: false },
    ] as HorseDecideOpts[];
    let proven = 0;
    // spots no other test of this file decides
    for (const hole of ['QsQd7c4c2s', 'QsQd9c4c2s'])
      for (const [potBefore, bet] of [
        [70, 70],
        [90, 45],
        [80, 40],
        [120, 60],
      ])
        for (let seed = 1; seed <= 6 && proven < 2; seed++) {
          const st = pricedSpot({ hole, board: BOARD, potBefore, bet });
          // what each second decision answers when nothing was decided before it on this spot
          const alone = SECOND.map((opts) => whole(st, opts, seed));
          for (const a of alone) {
            expect(a.fires).not.toContain('omaha_priced_pressure_raise_admitted');
            expect(a.fires).not.toContain('omaha_priced_pressure_raise_resized');
          }
          // first the decision whose pressure raise is priced, admitted and resized ...
          const first = whole(st, WHOLE, seed);
          if (!first.fires.includes('omaha_priced_pressure_raise_resized')) continue;
          expect(omahaDecisionMemosHeld()).toEqual([]);
          // ... then each second decision, on the same public spot, in the same process
          SECOND.forEach((opts, k) => {
            const after = whole(st, opts, seed);
            expect(after.fires).not.toContain('omaha_priced_pressure_raise_resized');
            expect(wholeBytes(after.d)).toBe(wholeBytes(alone[k].d));
          });
          // not vacuous: the second decision raises too, and would have been resized
          if (alone[0].d.action === 'raise' || alone[0].d.action === 'all_in') proven++;
        }
    expect(proven).toBeGreaterThan(0);
  });

  it('N6: a raise the mix took, not priced above the call, is resized under its own receipt', () => {
    const MIX = { ...DRAW_ON, omahaPricedMix: true } as HorseDecideOpts;
    let mixed = 0;
    let priced = 0;
    // the nut flush draw facing 20 into 100 is within the sampling noise of the call and its size
    // of highest value is not the minimum; the flush draw with a wrap is priced above the call
    for (const hole of ['AhTh8c4d2d', 'JhTh8c7d2d'])
      for (const [potBefore, bet] of [
        [100, 20],
        [100, 50],
      ])
        for (let seed = 1; seed <= 16; seed++) {
          const st = pricedSpot({ hole, board: BOARD, potBefore, bet });
          const decision: HorseDecision = { action: 'raise', amount: 2 * bet, thinkTime: 1000 };
          const plain = ruleOn(st, DRAW_ON, decision, seed);
          const mix = ruleOn(st, MIX, decision, seed);
          if (mix.fires.includes('omaha_priced_draw_raise_mixed_resized')) {
            mixed++;
            // without the mix the same raise is the call: it was not priced above it
            expect(plain.out!.action).toBe('call');
            expect(mix.fires).toContain('omaha_priced_mix_lower_action_taken');
            expect(mix.fires).not.toContain('omaha_priced_draw_raise_resized');
            expect(['raise', 'all_in']).toContain(mix.out!.action);
          }
          if (mix.fires.includes('omaha_priced_draw_raise_resized')) {
            priced++;
            // priced above the call: the mix did not take the lower action
            expect(plain.fires).toContain('omaha_priced_draw_raise_resized');
            expect(mix.fires).not.toContain('omaha_priced_mix_lower_action_taken');
          }
        }
    expect(mixed).toBeGreaterThan(0);
    expect(priced).toBeGreaterThan(0);
  });
  it('N6: under the mix, a raise kept or a call made against the price carries a receipt that says so', () => {
    // omahaPricedMix takes the lower of two actions within the sampling noise of each other. The
    // plain receipts say the raise was priced above the call (kept) or was not (called); where the
    // mix took the other action those words are untrue, so the mixed receipts fire instead.
    let mixedKept = 0;
    let mixedCalled = 0;
    for (const sizeOn of [true, false]) {
      const PLAIN = { ...DRAW_ON, omahaSampledRaiseIsPricedAtEverySize: sizeOn } as HorseDecideOpts;
      const MIX = { ...PLAIN, omahaPricedMix: true } as HorseDecideOpts;
      for (const hole of ['AhTh8c4d2d', 'JhTh8c7d2d'])
        for (const [potBefore, bet] of [
          [100, 20],
          [100, 50],
        ])
          for (let seed = 1; seed <= 8; seed++) {
            const st = pricedSpot({ hole, board: BOARD, potBefore, bet });
            // the legal steps: one of them is the size of highest value, which a stood raise keeps
            for (const to of [
              2 * bet,
              Math.round(2 * bet + 0.5 * (potBefore + bet)),
              potBefore + 3 * bet,
            ]) {
              const decision: HorseDecision = { action: 'raise', amount: to, thinkTime: 1000 };
              const plain = ruleOn(st, PLAIN, decision, seed);
              const mix = ruleOn(st, MIX, decision, seed);
              const took = mix.fires.includes('omaha_priced_mix_lower_action_taken');
              const pricedAbove = plain.out!.action !== 'call';
              if (mix.fires.includes('omaha_priced_draw_raise_mixed_kept')) {
                mixedKept++;
                expect(took).toBe(true);
                expect(pricedAbove).toBe(false);
                expect(mix.out).toBe(decision);
              }
              if (mix.fires.includes('omaha_priced_draw_raise_mixed_called')) {
                mixedCalled++;
                expect(took).toBe(true);
                expect(pricedAbove).toBe(true);
                expect(mix.out!.action).toBe('call');
              }
              // the plain words fire only where they are true
              if (mix.fires.includes('omaha_priced_draw_raise_kept')) {
                expect(took).toBe(false);
                expect(pricedAbove).toBe(true);
              }
              if (mix.fires.includes('omaha_priced_draw_raise_called')) {
                expect(took).toBe(false);
                expect(pricedAbove).toBe(false);
              }
            }
          }
    }
    // not vacuous: the mix took each other action in these spots
    expect(mixedKept).toBeGreaterThan(0);
    expect(mixedCalled).toBeGreaterThan(0);
  });
});
