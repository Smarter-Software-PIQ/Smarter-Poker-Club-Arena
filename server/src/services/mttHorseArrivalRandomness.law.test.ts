import { describe, expect, it } from 'vitest';
import { mttArrivalTarget, mttPlannedField, mttPrestartPlan } from './mttHorseArrivalPlan.js';

const ids = Array.from({ length: 80 }, (_, i) => `event-${i}`);

describe('event-specific Horse registration choices', () => {
  it('varies field counts while preserving guarantee coverage and restart identity', () => {
    const counts = ids.map((id) => mttPlannedField(500, 2.5, id));
    expect(new Set(counts).size).toBeGreaterThan(20);
    for (const id of ids) {
      const count = mttPlannedField(500, 2.5, id);
      expect(count).toBeGreaterThan(200);
      expect(count).toBeLessThanOrEqual(260);
      expect(mttPlannedField(500, 2.5, id)).toBe(count);
    }
    expect(new Set(ids.map((id) => mttPlannedField(250, 0, id))).size).toBeGreaterThan(8);
  });

  it('varies the approximately half-before-start split and preserves published capacity', () => {
    expect(new Set(ids.map((id) => mttPrestartPlan(200, null, id))).size).toBeGreaterThan(15);
    for (const id of ids) {
      const prestart = mttPrestartPlan(200, null, id);
      expect(prestart).toBeGreaterThanOrEqual(80);
      expect(prestart).toBeLessThanOrEqual(120);
      expect(mttPrestartPlan(200, 40, id)).toBeLessThan(40);
      expect(mttPrestartPlan(200, 1, id)).toBe(0);
    }
  });

  it('varies arrival instants by event and phase without rerolling or removing entrants', () => {
    expect(
      new Set(ids.map((id) => mttArrivalTarget(id, 'prestart', 100, 0.5))).size
    ).toBeGreaterThan(15);
    expect(
      ids.some(
        (id) =>
          mttArrivalTarget(id, 'prestart', 100, 0.5) !== mttArrivalTarget(id, 'late', 100, 0.5)
      )
    ).toBe(true);
    for (const id of ids.slice(0, 12)) {
      let previous = 0;
      for (let tick = 0; tick <= 100; tick++) {
        const target = mttArrivalTarget(id, 'late', 100, tick / 100);
        expect(target).toBeGreaterThanOrEqual(previous);
        expect(target).toBeLessThanOrEqual(100);
        expect(mttArrivalTarget(id, 'late', 100, tick / 100)).toBe(target);
        previous = target;
      }
      expect(previous).toBe(100);
    }
  });

  it('requires an event identity instead of silently sharing one fixed seed', () => {
    expect(() => mttPlannedField(500, 2.5, '')).toThrow('Tournament identity');
  });

  it('does not schedule outside the phase or accept invalid plans', () => {
    expect(mttArrivalTarget('event', 'late', 100, 0)).toBe(0);
    expect(mttArrivalTarget('event', 'late', 100, -1)).toBe(0);
    expect(mttArrivalTarget('event', 'late', 100, 1)).toBe(100);
    expect(mttArrivalTarget('event', 'late', 100, NaN)).toBe(0);
    expect(mttArrivalTarget('event', 'late', Infinity, 0.5)).toBe(0);
  });
});
