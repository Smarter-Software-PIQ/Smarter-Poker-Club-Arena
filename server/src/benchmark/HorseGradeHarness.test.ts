import { describe, expect, it } from 'vitest';
import {
  gradeCallerPolicy,
  gradeMirror,
  gradePeoplePloPolicy,
  gradeProbe,
  GradeWorld,
  peoplePloRate,
  PEOPLE_PLO_ANSWERS,
} from './HorseGradeHarness.js';
import { OMAHA_LIVE_OPTIONS_20261126 } from './HorseLeague.js';
import {
  omahaBetReadNewStore,
  omahaBetReadRowCount,
  omahaBetReadUseStore,
} from '../engine/HorseOmahaBetRead.js';

process.env.EQUITY_GOVERNOR = 'off';
const BASE = OMAHA_LIVE_OPTIONS_20261126;

// THE NO-OP LAW: with the option OFF on both sides the honest harness reads 0 within 0.1 bb/100, on two seeds,
// for the mirror and for the probe (forked and unforked), on PLO4 where the shared bet-read store used to drift.
describe('HorseGradeHarness: a same-seed no-op reads zero', () => {
  for (const seed of [20261127, 20261128]) {
    it(`mirror no-op, PLO4 heads-up, seed ${seed}`, async () => {
      const r = await gradeMirror({
        variant: 'plo4',
        seats: 2,
        stackBB: 100,
        pairs: 150,
        seed,
        base: BASE,
        on: {},
        noop: false,
      });
      expect(Math.abs(r.on.mean)).toBeLessThan(0.1);
      expect(r.on.divergent).toBe(0);
    }, 120_000);
    it(`probe no-op, PLO4 heads-up vs a caller, forked and unforked, seed ${seed}`, async () => {
      for (const fork of [true, false]) {
        const r = await gradeProbe({
          variant: 'plo4',
          seats: 2,
          stackBB: 100,
          deals: 200,
          seed,
          base: BASE,
          on: {},
          fork,
          noop: true,
          policy: gradeCallerPolicy(BASE),
        });
        expect(Math.abs(r.on.mean)).toBeLessThan(0.1);
        expect(Math.abs(r.noop!.mean)).toBeLessThan(0.1);
      }
    }, 120_000);
  }
});

describe('HorseGradeHarness: isolation', () => {
  it('a world learns into its own bet-read store and leaves the module store as it was', async () => {
    const mine = omahaBetReadNewStore();
    const before = omahaBetReadUseStore(mine);
    try {
      await gradeProbe({
        variant: 'plo5',
        seats: 2,
        stackBB: 100,
        deals: 40,
        seed: 7,
        base: BASE,
        on: {},
        policy: gradeCallerPolicy(BASE),
      });
      expect(omahaBetReadRowCount()).toBe(0);
    } finally {
      omahaBetReadUseStore(before);
    }
  }, 120_000);
  it('clone is deep: the copy does not see later learning of the original', () => {
    const w = new GradeWorld('t');
    w.rec.set('x', [['river', 'hu', 'big', 1]]);
    const c = w.clone('c');
    w.rec.get('x')!.push(['river', 'hu', 'big', 0]);
    expect(c.rec.get('x')!.length).toBe(1);
  });
});

describe('HorseGradeHarness: people-calibrated PLO responder', () => {
  it('rates are people counts shrunk toward the pooled cell', () => {
    const [c, n] = PEOPLE_PLO_ANSWERS.plo5['turn.hu.fold.l'];
    const r = peoplePloRate('plo5', 'turn', 'hu', 'fold', 'l');
    expect(Math.abs(r - c / n)).toBeLessThan(0.02);
    // a thin cell (PLO4 river multiway small: 1 of 1) sits near the pooled rate, not at 100%
    expect(peoplePloRate('plo4', 'river', 'mw', 'fold', 's')).toBeLessThan(0.95);
  });
  it('plays legal hands as seat 0', async () => {
    const r = await gradeProbe({
      variant: 'plo5',
      seats: 2,
      stackBB: 100,
      deals: 60,
      seed: 3,
      base: BASE,
      on: {},
      policy: gradePeoplePloPolicy(BASE, 'plo5'),
    });
    expect(r.illegal).toBe(0);
    expect(Math.abs(r.on.mean)).toBeLessThan(0.1);
  }, 120_000);
});
