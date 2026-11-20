/**
 * LAW (2026-11-19, EMERG AUDIT-05, option v21Deep): the V21 deep-stack discipline scales the facing-a-3-bet bars
 * by the EFFECTIVE depth (the smaller of hero's stack and the deepest live opponent's), never by hero's own stack
 * alone. 48h evidence (PLO4/PLO5 cash, hero above 120bb, effective 120bb or less, facing a person's re-raise):
 * hands 59924872, 59926164, 59978540, 60057018, 60097801 (PLO4) and 60008788, 60025757, 60025784 (PLO5).
 */
import { describe, expect, it } from 'vitest';
import { decidePreflopV7 } from './HorsePreflop.js';

const ctx = (
  strength: number,
  effectiveStackBB: number,
  isOmaha: boolean,
  deepDiscipline: boolean,
  effectiveDepth = true
): never =>
  ({
    strength,
    position: 'late',
    raiserPosition: 'bb',
    raises: 2, // hero opened, a blind 3-bet
    limpers: 0,
    callers: 0,
    oppsLeft: 1,
    toCall: 14,
    currentBet: 20,
    pot: 27,
    bigBlind: 2,
    stack: 800, // hero 400bb deep
    stackBB: 400,
    effectiveStackBB,
    tightness: 1,
    bluffFreq: 0,
    aggression: 1,
    slowplayFreq: 0,
    sizingMultiplier: 1,
    isOmaha,
    isPotLimit: isOmaha,
    riskAdd: 0,
    mode: 'cash',
    deepDiscipline,
    deepDisciplineEffectiveDepth: effectiveDepth,
    rand: () => 0.99,
  }) as never;

const sweep = (eff: number, isOmaha: boolean, deep: boolean, effectiveDepth = true): string =>
  Array.from(
    { length: 81 },
    (_, i) => decidePreflopV7(ctx(0.6 + i * 0.005, eff, isOmaha, deep, effectiveDepth)).a
  ).join();

describe('V21 deep discipline reads effective depth', () => {
  for (const isOmaha of [true, false]) {
    it(`${isOmaha ? 'Omaha' : "hold'em"}: a 400bb hero facing a 100bb re-raiser gets no deep tightening`, () => {
      // Effective depth 100bb is under the 120bb start of the scale, so the discipline must change nothing.
      expect(sweep(100, isOmaha, true)).toBe(sweep(100, isOmaha, false));
    });
  }

  it("without deepDisciplineEffectiveDepth (PLO6, hold'em, tournaments: HorseLogic sets it only in PLO4/PLO5 high cash) the own stack, as before", () => {
    for (const isOmaha of [true, false])
      expect(sweep(100, isOmaha, true, false)).not.toBe(sweep(100, isOmaha, false, false));
  });

  it('a truly deep pot (effective 400bb) still carries the discipline', () => {
    expect(sweep(400, true, true)).not.toBe(sweep(400, true, false));
  });
});
