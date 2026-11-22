/**
 * LAW: a pressure raise admitted by a priced size is made at a priced size.
 * ═══════════════════════════════════════════════════════════════════════════
 * Review note N1 of the omahaSampledRaiseIsPricedAtEverySize review (lane HORSE DECISIONS,
 * 2026-11-19; owner order of 2026-11-17: no blanket rules, every decision is priced, the size of a
 * bet never makes or breaks a decision). With omahaPressureIsPriced and
 * omahaSampledRaiseIsPricedAtEverySize on (both default OFF), the pressure raise is admitted when the
 * priced size of highest value is worth more than the call. The raise then made must be at a size
 * the comparison priced, never the brain's own unpriced size: a minimum raise admitted on the fold
 * share of the pot raise was the defect. Where the raise cannot be priced again, or no longer stands
 * above the call, it is made at the size its admission priced (the admission carries that size), or
 * the draw-raise rule that owns a draw makes it at its priced size or makes the call.
 */
import { describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { omahaNoDrawRaiseFinal, type HorseDecideOpts } from './HorseLogic.js';
import { pricedSpot } from './HorseOmahaPricedRules.test-support.js';
import {
  omahaPricedPressureRaiseSized,
  omahaPricedPressureWithheld,
  omahaPricedSampledAdmitsResize,
  type OmahaPricedPressureAdmission,
} from './HorseOmahaPricedWiring.js';
import type { HorseDecision } from '../types.js';

const BOARD = 'Qh9h3d';
const PRESS = {
  omahaPressureIsPriced: true,
  omahaSampledRaiseIsPricedAtEverySize: true,
  mind: false,
  telemetry: true,
} as HorseDecideOpts;
type St = ReturnType<typeof pricedSpot>;
const raiseTo = (to: number): HorseDecision => ({
  action: 'raise',
  amount: to,
  thinkTime: 1000,
});
const madeTo = (st: St, d: HorseDecision): number =>
  d.action === 'all_in' ? (st.hero.bet ?? 0) + st.hero.stack : (d.amount as number);

describe('a pressure raise admitted by a priced size is made at a priced size', () => {
  it('whatever size the brain gives, the raise is made at the admitted size or at a priced size beside it', () => {
    const made: Array<{
      st: St;
      told: OmahaPricedPressureAdmission;
      given: number;
      step: boolean;
      out: HorseDecision;
    }> = [];
    for (const hole of ['QsQd7c4c2s', 'AhKhJcTc2s', 'Qs9s3c7c2d'])
      for (const [potBefore, bet] of [
        [50, 50],
        [100, 50],
        [60, 60],
        [100, 20],
      ]) {
        const st = pricedSpot({ hole, board: BOARD, potBefore, bet });
        const told: OmahaPricedPressureAdmission = {};
        if (
          omahaPricedPressureWithheld('raise', st.hero, st.gs, PRESS, {} as never, told) !== false
        )
          continue;
        if (told.sampledAtPrice !== true) continue;
        const min = st.gs.minRaiseTo as number;
        const max = st.gs.maxRaiseTo as number;
        const steps = [min, Math.round(min + 0.5 * (st.gs.pot + bet)), max];
        for (const given of [...steps, min + 7]) {
          const out = omahaPricedPressureRaiseSized(raiseTo(given), st.hero, st.gs, PRESS, told);
          made.push({ st, told, given, step: steps.includes(given), out });
        }
      }
    // not vacuous: admitted pressure raises were sized
    expect(made.length).toBeGreaterThan(0);
    for (const { st, told, given, step, out } of made) {
      expect(['raise', 'all_in']).toContain(out.action);
      const to = madeTo(st, out);
      // the admission carries the size it priced above the call
      expect(Number.isFinite(told.sampledTo)).toBe(true);
      // a step is one of the sizes the admission priced: the raise is made at the admitted size;
      // any other size given is priced beside the steps and is kept only where it is the best
      if (step) expect(to).toBe(told.sampledTo);
      else expect([told.sampledTo, given]).toContain(to);
      // a size moved is the exact chips of a priced size (the dedicated validator admission)
      if (to !== given)
        expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, out.action, out.amount)).toBe(true);
    }
  });

  it('where the raise no longer stands above the call when priced again, it is made at the size its admission priced, never at the brain size', () => {
    // No pair, no draw, facing 20 into 100: priced again here, no raise stands above the call. The
    // admission (a stand-in for the record of a decision whose pricing admitted the raise at the
    // pot raise, 160) is what the raise is made at.
    const st = pricedSpot({ hole: '2c3c7s8sKc', board: BOARD, potBefore: 100, bet: 20 });
    const admission: OmahaPricedPressureAdmission = { sampledAtPrice: true, sampledTo: 160 };
    enableBrainTelemetry();
    drainFires();
    const out = omahaPricedPressureRaiseSized(raiseTo(40), st.hero, st.gs, PRESS, admission);
    expect(drainFires().map((f) => f.feature)).toContain('omaha_priced_pressure_raise_resized');
    expect([out.action, out.amount]).toEqual(['raise', 160]);
    expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, 'raise', 160)).toBe(true);
    // given at that size: the decision itself
    const at = raiseTo(160);
    expect(omahaPricedPressureRaiseSized(at, st.hero, st.gs, PRESS, admission)).toBe(at);
    // no admission, or one that names no size: nothing is claimed, the decision itself
    const d = raiseTo(40);
    for (const none of [null, undefined, {}, { sampledAtPrice: true }])
      expect(omahaPricedPressureRaiseSized(d, st.hero, st.gs, PRESS, none)).toBe(d);
  });

  it('a draw the draw-raise rule owns is made at that rule priced size, or becomes the call', () => {
    const OWN = {
      ...PRESS,
      omahaNoDrawRaiseOutOfPosition: true,
      omahaDrawRaiseIsPriced: true,
    } as HorseDecideOpts;
    let seen = 0;
    let raised = 0;
    for (const [potBefore, bet] of [
      [50, 50],
      [100, 20],
      [100, 50],
    ]) {
      const st = pricedSpot({ hole: 'AhKhJcTc2s', board: BOARD, potBefore, bet });
      const told: OmahaPricedPressureAdmission = {};
      if (omahaPricedPressureWithheld('raise', st.hero, st.gs, OWN, {} as never, told) !== false)
        continue;
      if (told.sampledAtPrice !== true) continue;
      seen++;
      const given = raiseTo(st.gs.minRaiseTo as number);
      const out = omahaNoDrawRaiseFinal(
        omahaPricedPressureRaiseSized(given, st.hero, st.gs, OWN, told),
        st.hero,
        st.gs,
        OWN
      );
      if (out.action === 'call') continue;
      raised++;
      expect(['raise', 'all_in']).toContain(out.action);
      // moved off the size given: the exact chips of a priced size
      if (madeTo(st, out) !== st.gs.minRaiseTo)
        expect(omahaPricedSampledAdmitsResize(st.hero, st.gs, out.action, out.amount)).toBe(true);
    }
    expect(seen).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
  });
});
