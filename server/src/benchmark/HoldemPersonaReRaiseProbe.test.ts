/**
 * The persona re-raise probe measures what it says it measures. Each test
 * here would have caught a defect of its first version (review e40d7078):
 * "taken" defined differently in the two arms, and an unpaired comparison.
 *
 *  (i)   Every Horse at scale exactly 1 with the consumed draw as its unit
 *        IS the option off: the paired difference is exactly zero, for all
 *        three behaviours, and the two runs see the same spots.
 *  (ii)  Every Horse at a known scale (0.5): the measured paired reshove
 *        rate is 0.5 of off within its interval, and the 3-bet and squeeze
 *        comparisons fire at 0.5 p where uncapped.
 *  (iii) "Taken" is one definition for both arms.
 *  (iv)  Paired counts are consistent: on = off + up - down on the same spots.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const forced = vi.hoisted(() => ({
  scale: null as number | null,
  drawAsUnit: false,
}));
vi.mock('../engine/HorsePersona.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/HorsePersona.js')>();
  return {
    ...actual,
    holdemPersonaReRaiseScale: (id: string) =>
      forced.scale === null ? actual.holdemPersonaReRaiseScale(id) : forced.scale,
  };
});
vi.mock('../engine/HorsePreflop.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/HorsePreflop.js')>();
  return {
    ...actual,
    decidePreflopV7: (ctx: Parameters<typeof actual.decidePreflopV7>[0]) => {
      const persona = ctx.holdemPersonaReRaise;
      if (!forced.drawAsUnit || !persona) return actual.decidePreflopV7(ctx);
      let last = Number.NaN;
      return actual.decidePreflopV7({
        ...ctx,
        rand: () => (last = ctx.rand()),
        holdemPersonaReRaise: {
          scale: persona.scale,
          get u3bet() {
            return last;
          },
          get uSqueeze() {
            return last;
          },
          uFourBet: 0,
        },
      });
    },
  };
});

import {
  MAX_PERSONA_SCALE,
  ONE_SIDED_P,
  PERSONA_BEHAVIOURS,
  measurePersonaReRaise,
  personaTaken,
  type PersonaReRaiseReport,
} from './HoldemPersonaReRaiseProbe.js';

afterEach(() => {
  forced.scale = null;
  forced.drawAsUnit = false;
});

const consistent = (rep: PersonaReRaiseReport) => {
  for (const b of PERSONA_BEHAVIOURS)
    for (const [row, c] of Object.entries(rep.paired[b])) {
      // (iv) the same spots on both sides of every pair
      expect(c.on.taken, `${b} ${row}`).toBe(c.off.taken + c.up - c.down);
      expect(rep.unpaired[b][row].offEligible, `${b} ${row}`).toBe(c.eligible);
      expect(rep.unpaired[b][row].off.taken, `${b} ${row}`).toBe(c.off.taken);
    }
};

describe('the persona re-raise probe is validated before it is believed', () => {
  it('(iii) "taken" is the final action in both arms, never the persona verdict', () => {
    expect(personaTaken('fourBetReshove', { action: 'all_in', bluffBranch: false })).toBe(true);
    // The persona said shove and a later layer made it a call: not taken.
    expect(personaTaken('fourBetReshove', { action: 'call', bluffBranch: false })).toBe(false);
    expect(personaTaken('fourBetReshove', { action: 'fold', bluffBranch: true })).toBe(false);
    expect(personaTaken('threeBetBluff', { action: 'raise', bluffBranch: true })).toBe(true);
    // A value 3-bet is a raise and not the bluff branch: not taken.
    expect(personaTaken('threeBetBluff', { action: 'raise', bluffBranch: false })).toBe(false);
    expect(personaTaken('squeezeBluff', { action: 'fold', bluffBranch: false })).toBe(false);
  });

  it('the one-sided threshold is 1 over the largest scale a Horse can have', () => {
    expect(MAX_PERSONA_SCALE).toBeCloseTo(0.64 / 0.42143, 10);
    expect(ONE_SIDED_P).toBeCloseTo(0.42143 / 0.64, 10);
  });

  for (const cell of [
    { mode: 'cash', depthBB: [20, 40], seats: 9 },
    { mode: 'tournament', depthBB: [20, 40], seats: 9 },
    { mode: 'cash', depthBB: 100, seats: 6 },
  ] as const)
    it(`(i) ${cell.seats}-handed ${cell.mode} ${String(cell.depthBB)}: scale 1 with the draw as the unit gives a paired difference of exactly zero`, () => {
      forced.scale = 1;
      forced.drawAsUnit = true;
      const rep = measurePersonaReRaise({ ...cell, handsPerRotation: 2, seed: 7 });
      consistent(rep);
      let eligible = 0;
      for (const b of PERSONA_BEHAVIOURS)
        for (const [row, c] of Object.entries(rep.paired[b])) {
          expect(c.up, `${b} ${row}`).toBe(0);
          expect(c.down, `${b} ${row}`).toBe(0);
          expect(c.diff, `${b} ${row}`).toBe(0);
          expect(c.on.taken, `${b} ${row}`).toBe(c.off.taken);
          expect(c.verdictOn, `${b} ${row}`).toBe(c.verdictOff);
          // On is off, so the two separate runs never part: the same spots,
          // the same answers.
          const u = rep.unpaired[b][row];
          expect(u.onEligible, `${b} ${row}`).toBe(u.offEligible);
          expect(u.on.taken, `${b} ${row}`).toBe(u.off.taken);
          if (row === 'pooled') eligible += c.eligible;
        }
      expect(rep.paired.threeBetBluff.pooled.eligible).toBeGreaterThan(100);
      if (cell.depthBB !== 100)
        expect(rep.paired.fourBetReshove.pooled.eligible).toBeGreaterThan(0);
      else expect(rep.paired.squeezeBluff.pooled.eligible).toBeGreaterThan(20);
      expect(eligible).toBeGreaterThan(150);
    });

  it('(ii) every Horse at scale 0.5: the reshove is taken half as often, and the bluffs fire at half p', () => {
    forced.scale = 0.5;
    const rep = measurePersonaReRaise({
      mode: 'cash',
      depthBB: [26, 35],
      seats: 6,
      handsPerRotation: 10,
      seed: 11,
    });
    consistent(rep);
    expect(rep.meanScale).toBe(0.5);
    const reshove = rep.paired.fourBetReshove.pooled;
    expect(reshove.eligible).toBeGreaterThan(40);
    // Today every one shoves; at 0.5 half do, within the interval.
    expect(reshove.off.rate).toBe(100);
    expect(reshove.on.low).toBeLessThan(50);
    expect(reshove.on.high).toBeGreaterThan(50);
    expect(reshove.expectedOn).toBe(50);
    expect(reshove.up).toBe(0);
    for (const b of ['threeBetBluff', 'squeezeBluff'] as const) {
      const c = rep.paired[b].pooled;
      if (b === 'threeBetBluff') expect(c.eligible).toBeGreaterThan(300);
      // 0.5 never caps and is never one-sided against itself.
      expect(c.capped).toBe(0);
      expect(Math.abs(c.expectedOn - c.expectedOff / 2)).toBeLessThan(0.011);
      if (c.eligible < 50) continue;
      // The comparison itself fires at the expected rate, give or take the sample.
      const expected = (c.expectedOn / 100) * c.eligible;
      const sd = Math.sqrt(expected * (1 - c.expectedOn / 100));
      expect(Math.abs(c.verdictOn - expected)).toBeLessThan(3 * sd + 1);
      const expectedOff = (c.expectedOff / 100) * c.eligible;
      const sdOff = Math.sqrt(expectedOff * (1 - c.expectedOff / 100));
      expect(Math.abs(c.verdictOff - expectedOff)).toBeLessThan(3 * sdOff + 1);
      // And so the final action falls: the paired difference is negative.
      if (b === 'threeBetBluff') expect(c.diffHigh).toBeLessThan(0);
    }
  });

  it('(iv) the real persona, paired: counts are consistent and the model figures are reported', () => {
    const rep = measurePersonaReRaise({
      mode: 'tournament',
      depthBB: [20, 40],
      seats: 9,
      handsPerRotation: 1,
    });
    consistent(rep);
    expect(rep.handIdentity).toBe(true);
    expect(rep.modelMin1).toBe(90.5);
    expect(rep.ids).toBe(900);
    expect(rep.archetypeIds).toEqual({
      lag_shark: 225,
      tag_crusher: 360,
      tricky_trap: 180,
      nit_hunter: 135,
    });
    const three = rep.paired.threeBetBluff;
    expect(three.pooled.eligible).toBeGreaterThan(100);
    // The one-sided rows are a subset of the eligible spots.
    expect(three['one-sided'].eligible).toBeLessThanOrEqual(three.pooled.eligible);
    expect(three['p>=1'].eligible).toBeLessThanOrEqual(three['one-sided'].eligible);
  });

  it('a seat count that does not divide the fleet reports only the ids it seats', () => {
    const rep = measurePersonaReRaise({ seats: 7, handsPerRotation: 0 });
    expect(rep.tables).toBe(128);
    expect(rep.ids).toBe(896);
    expect(Object.values(rep.archetypeIds).reduce((a, b) => a + b, 0)).toBe(896);
  });
});
