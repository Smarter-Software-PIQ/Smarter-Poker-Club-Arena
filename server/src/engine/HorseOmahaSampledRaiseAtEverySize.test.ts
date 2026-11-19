/**
 * omahaSampledRaiseIsPricedAtEverySize (default OFF; verifier defect of 2026-11-19 on
 * HorseOmahaPricedRules.omahaPricedSampledRaise, the flop and turn raise of omahaDrawRaiseIsPriced
 * and omahaPressureIsPriced).
 *
 * The defect: the sampled comparison priced ONE raise size and read the opponent's fold to a raise
 * size-blind (his fold to a bet times 0.42, or the street read's fold-to-raise cell, both measured
 * over raises of every size). A 20-chip minimum raise into 120 was priced with the fold share of a
 * pot raise, and no size was ever compared with another.
 *
 * With the option on: the fold, the call and a raise to each legal size are priced, each raise's
 * fold share at the price that raise lays, and the action of highest value is chosen. With it off,
 * every decision is byte-identical.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OMAHA_BIG_DRAW_OOP_REALISATION } from './HorseOmahaBigDrawAggression.js';
import {
  OMAHA_PRICED_NO_READ,
  OMAHA_PRICED_SAMPLED_MARGIN,
  OMAHA_PRICED_SAMPLED_REFERENCE_FOLD,
  omahaPricedSampledFoldAtPrice,
  omahaPricedSampledRaise,
  omahaPricedShrunk,
  type OmahaPricedSampledInput,
} from './HorseOmahaPricedRules.js';
import {
  LIVE_OPTIONS,
  allPriced,
  cards,
  decideAt,
  pricedSpot,
  type PricedSpot,
} from './HorseOmahaPricedRules.test-support.js';
import {
  omahaPricedDrawRaiseRule,
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
              (OMAHA_BIG_DRAW_OOP_REALISATION * v.equities.raise * (pot + cost + x) - cost);
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
        }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[sampled raise at every size, whole decision] decisions changed by the option: ${changed}`
    );
  });
});
