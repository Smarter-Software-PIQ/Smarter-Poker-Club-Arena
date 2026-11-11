import { describe, expect, it } from 'vitest';
import { wheelV5MainWeights, WHEEL_V5_WEIGHTS } from '../../src/utils/wheelV5Model';
import { wheelV4UpgradeWeights } from '../../src/utils/wheelFairness';
import type { WheelPreviousOutcome } from '../../src/services/DiamondWheelService';
const names = ['plinko', 'crash', 'crossing', 'mines'] as const;
const ords = [1, 4, 7, 10];
const predecessors: Array<WheelPreviousOutcome | null> = [
  null,
  ...Array.from(
    { length: 12 },
    (_, i): WheelPreviousOutcome => ({
      spin_id: 'fixture',
      ord: i + 1,
      game: names[ords.indexOf(i + 1)] ?? null,
      tier: 'main',
    })
  ),
  ...names.map(
    (game): WheelPreviousOutcome => ({ spin_id: 'fixture', ord: 12, game, tier: 'super' })
  ),
];
describe('one in four actual normal or Super games, not one in four Upgrade wedges', () => {
  it.each(predecessors.map((previous, i) => ({ previous, i })))(
    'has exact conditional probability after predecessor $i',
    ({ previous }) => {
      const w = wheelV5MainWeights(previous),
        up = wheelV4UpgradeWeights(previous);
      expect(w).toHaveLength(12);
      expect(w.every((x) => Number.isSafeInteger(x) && x >= 0)).toBe(true);
      expect(w.reduce((a, b) => a + b, 0)).toBe(100000);
      const ordinary = ords.reduce((sum, ord) => sum + w[ord - 1], 0);
      const superNumerator = w[11] * up.slice(0, 4).reduce((a, b) => a + b, 0);
      expect(ordinary * 100000 + superNumerator).toBe(25000 * 100000);
      expect(w[11]).toBe(previous?.ord === 12 ? 0 : 1000);
      if (previous) expect(w[previous.ord - 1]).toBe(0);
      if (previous?.game) expect(w[ords[names.indexOf(previous.game)] - 1]).toBe(0);
      // Back-to-back game awards remain possible, with no forced waiting count.
      expect(ordinary).toBeGreaterThan(0);
    }
  );
  it('retains non-game relative odds to within one integer ticket after exclusions', () => {
    const base = [0, 29600, 6667, 0, 1200, 6666, 0, 240, 6667, 0, 160, 0];
    for (const previous of predecessors) {
      const eligible = base.map((weight, i) => (i + 1 === previous?.ord ? 0 : weight));
      const total = eligible.reduce((a, b) => a + b, 0),
        w = wheelV5MainWeights(previous);
      const budget = eligible.reduce((sum, b, i) => sum + (b ? w[i] : 0), 0);
      eligible.forEach((b, i) => {
        if (b) expect(Math.abs(w[i] - (b * budget) / total)).toBeLessThan(1);
      });
    }
  });
  it('publishes the first-spin law and rejects impossible predecessor identifiers', () => {
    expect(WHEEL_V5_WEIGHTS).toEqual(wheelV5MainWeights(null));
    expect(() => wheelV5MainWeights({ ...predecessors[1]!, ord: 13 })).toThrow();
  });
});
