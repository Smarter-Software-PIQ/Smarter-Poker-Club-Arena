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

/**
 * Hardening after review of #10794 (2026-11-14): the cutoffs pinned at their
 * exact edges, on spots where every other rule says yes, so moving a cutoff
 * by any amount fails a test. Below about 0.13 equity prefersRunItTwice
 * already says no, so a test at 0.10 does not pin the lopsided bound; the
 * cases at 0.20 and 0.80 do.
 */
describe('horseRunItTwiceRuns at its exact cutoffs', () => {
  const JUST = 1e-9;
  const run = (horseId: string, handNumber: number, equity: number, maxRuns: 1 | 2 | 3 = 2) =>
    horseRunItTwiceRuns({ horseId, handNumber, potBB: 100, equity, maxRuns });

  /** A Horse and hand where the persona says yes at `equity` and the hand gate says yes. */
  function spotWhereOnlyTheCutoffSaysNo(equity: number): { horseId: string; handNumber: number } {
    for (const horseId of ids(2000)) {
      if (!prefersRunItTwice(horseId, 100, equity)) continue;
      for (let handNumber = 1; handNumber <= 50; handNumber++) {
        // The gate does not read the equity: a yes at 0.5 is a yes everywhere.
        if (prefersRunItTwice(horseId, 100, 0.5) && run(horseId, handNumber, 0.5) === 2) {
          return { horseId, handNumber };
        }
      }
    }
    throw new Error(`no willing spot at ${equity}`);
  }

  it('0.20 and 0.80 run once even where the persona and the gate both say yes', () => {
    for (const equity of [0.2, 0.8]) {
      const { horseId, handNumber } = spotWhereOnlyTheCutoffSaysNo(equity);
      // Without the lopsided cutoff this spot would run twice.
      expect(prefersRunItTwice(horseId, 100, equity)).toBe(true);
      expect(run(horseId, handNumber, equity)).toBe(1);
    }
  });

  it('exactly 0.25 and exactly 0.75 run once; just inside runs per the gate', () => {
    const low = spotWhereOnlyTheCutoffSaysNo(0.25 + JUST);
    expect(run(low.horseId, low.handNumber, 0.25)).toBe(1);
    expect(run(low.horseId, low.handNumber, 0.25 + JUST)).toBe(2);
    const high = spotWhereOnlyTheCutoffSaysNo(0.75 - JUST);
    expect(run(high.horseId, high.handNumber, 0.75)).toBe(1);
    expect(run(high.horseId, high.handNumber, 0.75 - JUST)).toBe(2);
  });

  it('just inside the cutoffs a willing Horse answers exactly as the hand gate does', () => {
    const willing = ids(2000).find(
      (id) => prefersRunItTwice(id, 100, 0.25 + JUST) && prefersRunItTwice(id, 100, 0.5)
    )!;
    expect(willing).toBeDefined();
    let yes = 0;
    for (let handNumber = 1; handNumber <= 400; handNumber++) {
      const gate = run(willing, handNumber, 0.5) > 1;
      if (gate) yes++;
      expect(run(willing, handNumber, 0.25 + JUST) > 1).toBe(gate);
      expect(run(willing, handNumber, 0.75 - JUST) > 1).toBe(gate);
      expect(run(willing, handNumber, 0.25)).toBe(1);
      expect(run(willing, handNumber, 0.75)).toBe(1);
    }
    expect(yes).toBeGreaterThan(0);
    expect(yes).toBeLessThan(400);
  });

  it('three boards: 0.42 and 0.58 are inside the band, a hair outside is two', () => {
    let checked = 0;
    for (const horseId of ids(2000)) {
      if (!prefersRunItTwice(horseId, 100, 0.42 - JUST)) continue;
      for (let handNumber = 1; handNumber <= 40; handNumber++) {
        if (run(horseId, handNumber, 0.5, 3) !== 3) continue;
        expect(run(horseId, handNumber, 0.42, 3)).toBe(3);
        expect(run(horseId, handNumber, 0.58, 3)).toBe(3);
        expect(run(horseId, handNumber, 0.42 - JUST, 3)).toBe(2);
        expect(run(horseId, handNumber, 0.58 + JUST, 3)).toBe(2);
        // A table that allows only two never gets three, even in the band.
        expect(run(horseId, handNumber, 0.5, 2)).toBe(2);
        checked++;
      }
      if (checked >= 25) break;
    }
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  it('a pot under 40 BB runs once; at exactly 40 BB the other rules decide', () => {
    let atForty = 0;
    for (const horseId of ids(2000)) {
      for (let handNumber = 1; handNumber <= 10; handNumber++) {
        const at = (potBB: number) =>
          horseRunItTwiceRuns({ horseId, handNumber, potBB, equity: 0.5, maxRuns: 3 });
        expect(at(40 - JUST)).toBe(1);
        expect(at(39)).toBe(1);
        expect(at(0)).toBe(1);
        if (at(40) > 1) atForty++;
      }
    }
    // Some Horses still say yes at exactly 40 BB: the bound is 'under 40', not 'up to 40'.
    expect(atForty).toBeGreaterThan(0);
  });

  it('the 5-in-10 gate is fixed per (Horse, hand) and says yes about half the time', () => {
    const willing = ids(3000).filter(
      (id) => prefersRunItTwice(id, 100, 0.5) && prefersRunItTwice(id, 100, 0.45)
    );
    expect(willing.length).toBeGreaterThanOrEqual(100);
    let yes = 0;
    let total = 0;
    for (const horseId of willing.slice(0, 100)) {
      for (let handNumber = 1; handNumber <= 200; handNumber++) {
        const answer = run(horseId, handNumber, 0.5);
        // Same Horse, same hand: same answer, whatever else ran in between.
        expect(run(horseId, handNumber, 0.5)).toBe(answer);
        expect(run(horseId, handNumber, 0.47)).toBe(answer);
        total++;
        if (answer > 1) yes++;
      }
    }
    const share = yes / total;
    console.log(`[rit-gate] yes share over ${total} willing (Horse, hand) spots: ${share}`);
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });

  it('the three-board bucket is fixed per (Horse, hand) and says three on a minority of multi answers', () => {
    const willing = ids(3000).filter(
      (id) => prefersRunItTwice(id, 100, 0.5) && prefersRunItTwice(id, 100, 0.45)
    );
    let three = 0;
    let multi = 0;
    for (const horseId of willing.slice(0, 100)) {
      for (let handNumber = 1; handNumber <= 200; handNumber++) {
        const answer = run(horseId, handNumber, 0.5, 3);
        expect(run(horseId, handNumber, 0.5, 3)).toBe(answer);
        expect(run(horseId, handNumber, 0.45, 3)).toBe(answer);
        if (answer > 1) multi++;
        if (answer === 3) three++;
      }
    }
    const share = three / multi;
    console.log(`[rit-three] three share among ${multi} multi answers: ${share}`);
    // Bounds only: three is a minority of multi answers and never zero. This
    // does not pin the rate as policy. The design text says 1 hand in 4; the
    // measured share here is lower because the gate and this bucket hash the
    // same Horse and hand and are not independent. That gap is an open item
    // recorded outside this test (DISCREPANCY.md for the #10794 follow-up),
    // with no behavior change made here.
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.3);
  });
});
