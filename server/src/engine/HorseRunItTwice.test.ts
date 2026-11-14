/**
 * Horses run it twice only sometimes, and never when the all-in is lopsided
 * (Dan 2026-11-13). Each rule of horseRunItTwiceRuns, and the rate it gives.
 */
import { describe, expect, it } from 'vitest';
import { horseRunItTwiceRuns, type HorseRunItTwiceInput } from './HorseRunItTwice.js';
import { prefersRunItTwice } from './HorsePersona.js';

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `${(i * 2654435761) >>> 0}-horse-${i}-seat`);

/** A Horse and a hand on which every earlier rule says yes. */
function willingSpot(): HorseRunItTwiceInput {
  for (const horseId of ids(500)) {
    for (let handNumber = 1; handNumber <= 50; handNumber++) {
      const input = { horseId, handNumber, potBB: 100, equity: 0.5, maxRuns: 2 as const };
      if (horseRunItTwiceRuns(input) === 2) return input;
    }
  }
  throw new Error('no willing spot');
}

function multiShare(equity: number, potBB: number): number {
  let multi = 0;
  let total = 0;
  for (const horseId of ids(300)) {
    for (let handNumber = 1; handNumber <= 10; handNumber++) {
      total++;
      if (horseRunItTwiceRuns({ horseId, handNumber, potBB, equity, maxRuns: 3 }) > 1) multi++;
    }
  }
  return multi / total;
}

describe('horseRunItTwiceRuns', () => {
  it('runs once when the equity is unknown: a Horse never agrees blind', () => {
    const spot = willingSpot();
    expect(horseRunItTwiceRuns({ ...spot, equity: null })).toBe(1);
    expect(horseRunItTwiceRuns({ ...spot, equity: Number.NaN })).toBe(1);
    expect(horseRunItTwiceRuns({ ...spot, equity: Number.POSITIVE_INFINITY })).toBe(1);
  });

  it('runs once when the all-in is lopsided, either way round', () => {
    const spot = willingSpot();
    for (const equity of [0, 0.02, 0.1, 0.25, 0.75, 0.9, 0.98, 1]) {
      expect(horseRunItTwiceRuns({ ...spot, equity })).toBe(1);
    }
  });

  it('runs once when the persona preference says no (small pot, low preference)', () => {
    const spot = willingSpot();
    expect(horseRunItTwiceRuns({ ...spot, potBB: 39 })).toBe(1);
    const reluctant = ids(500).find((id) => !prefersRunItTwice(id, 100, 0.5))!;
    expect(reluctant).toBeDefined();
    for (let handNumber = 1; handNumber <= 50; handNumber++) {
      expect(
        horseRunItTwiceRuns({ horseId: reluctant, handNumber, potBB: 100, equity: 0.5, maxRuns: 3 })
      ).toBe(1);
    }
  });

  it('a willing Horse still says yes on only some hands (the per-hand gate)', () => {
    const willing = ids(500).find((id) => prefersRunItTwice(id, 100, 0.5))!;
    const answers = Array.from({ length: 200 }, (_, i) =>
      horseRunItTwiceRuns({
        horseId: willing,
        handNumber: i + 1,
        potBB: 100,
        equity: 0.5,
        maxRuns: 2,
      })
    );
    const yes = answers.filter((r) => r > 1).length;
    expect(yes).toBeGreaterThan(60);
    expect(yes).toBeLessThan(140);
  });

  it('picks 3 only on a near coin flip at a table that allows 3, and never above maxRuns', () => {
    let threes = 0;
    for (const horseId of ids(300)) {
      for (let handNumber = 1; handNumber <= 10; handNumber++) {
        const base = { horseId, handNumber, potBB: 100 };
        const at = (equity: number, maxRuns: 1 | 2 | 3) =>
          horseRunItTwiceRuns({ ...base, equity, maxRuns });
        if (at(0.5, 3) === 3) threes++;
        expect(at(0.5, 2)).toBeLessThanOrEqual(2);
        expect(at(0.5, 1)).toBe(1);
        expect(at(0.35, 3)).toBeLessThanOrEqual(2);
        expect(at(0.65, 3)).toBeLessThanOrEqual(2);
        // The 3-board answer is a subset of the 2-board answer.
        if (at(0.5, 3) === 3) expect(at(0.5, 2)).toBe(2);
      }
    }
    expect(threes).toBeGreaterThan(0);
  });

  it('is deterministic: the same hand replays to the same answer', () => {
    for (const horseId of ids(50)) {
      for (let handNumber = 1; handNumber <= 20; handNumber++) {
        const input = { horseId, handNumber, potBB: 120, equity: 0.47, maxRuns: 3 as const };
        expect(horseRunItTwiceRuns(input)).toBe(horseRunItTwiceRuns({ ...input }));
      }
    }
  });

  it('says multi only sometimes at a coin flip, and never when lopsided or the pot is small', () => {
    const coinFlip = multiShare(0.5, 100);
    // Printed for the evidence log.
    console.log(`[rit-rate] multi share at equity 0.50, 100 BB, 3000 spots: ${coinFlip}`);
    expect(coinFlip).toBeGreaterThanOrEqual(0.15);
    expect(coinFlip).toBeLessThanOrEqual(0.45);
    expect(multiShare(0.1, 100)).toBe(0);
    expect(multiShare(0.9, 100)).toBe(0);
    expect(multiShare(0.5, 39)).toBe(0);
    expect(multiShare(0.5, 20)).toBe(0);
  });
});
