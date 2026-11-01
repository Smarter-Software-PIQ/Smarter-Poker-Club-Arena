import { describe, expect, it } from 'vitest';
import {
  mttArrivalTarget,
  mttPlannedField,
  mttPrestartPlan,
  mttPrestartArrivalTarget,
} from './mttHorseArrivalPlan.js';

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

  it('keeps regular prestart fields small regardless of guarantee and varies free fields', () => {
    expect(new Set(ids.map((id) => mttPrestartPlan(200, null, id))).size).toBeGreaterThan(8);
    for (const id of ids) {
      const prestart = mttPrestartPlan(200, null, id);
      expect(prestart).toBeGreaterThanOrEqual(12);
      expect(prestart).toBeLessThanOrEqual(28);
      expect(mttPrestartPlan(2000, null, id)).toBe(prestart);
      expect(mttPrestartPlan(200, 9, id)).toBeLessThan(9);
      expect(mttPrestartPlan(200, 1, id)).toBe(0);
      const free = mttPrestartPlan(200, null, id, true);
      expect(free).toBeGreaterThanOrEqual(80);
      expect(free).toBeLessThanOrEqual(120);
    }
  });

  it('opens with a random handful and increases arrivals near the start', () => {
    const openings = new Set<number>();
    for (const id of ids) {
      const total = mttPrestartPlan(200, null, id);
      const opening = mttPrestartArrivalTarget(id, total, 0);
      openings.add(opening);
      expect(opening).toBeGreaterThanOrEqual(3);
      expect(opening).toBeLessThanOrEqual(7);
      let prior = opening;
      for (let tick = 1; tick <= 100; tick++) {
        const target = mttPrestartArrivalTarget(id, total, tick / 100);
        expect(target).toBeGreaterThanOrEqual(prior);
        expect(target).toBeLessThanOrEqual(total);
        prior = target;
      }
      expect(prior).toBe(total);
      expect(mttPrestartArrivalTarget(id, total, -0.01)).toBe(0);
    }
    expect(openings.size).toBeGreaterThan(3);
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
