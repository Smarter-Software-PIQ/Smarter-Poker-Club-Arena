import { describe, expect, it } from 'vitest';
import { draftMatrix } from './featureAblationDraftPlan.js';

describe('held-out plan drafter matrix', () => {
  it('covers every seed with contiguous whole-rotation cells and no gaps', () => {
    const seeds = [28301109, 28302231, 28303347];
    const m = draftMatrix('river_position_defense-nlh-6max-2dealt-100bb', 'nlh', seeds, 8064, 1152);
    expect(m).toHaveLength(21);
    for (const seed of seeds) {
      const cells = m.filter((c) => c.seed === seed).sort((a, b) => a.shard - b.shard);
      expect(cells.map((c) => c.firstPair)).toEqual([0, 1152, 2304, 3456, 4608, 5760, 6912]);
      expect(cells.every((c, i) => c.shard === i && c.pairs === 1152)).toBe(true);
    }
    expect(new Set(m.map((c) => c.key)).size).toBe(m.length);
    expect(m.every((c) => /^[a-z0-9_-]{1,100}$/.test(c.key))).toBe(true);
  });

  it('refuses partial rotation blocks and ragged cells', () => {
    expect(() => draftMatrix('p', 'nlh', [1], 1000, 500)).toThrow();
    expect(() => draftMatrix('p', 'nlh', [1], 1728, 1152)).toThrow();
  });

  it('refuses a matrix over the provider bound', () => {
    expect(() => draftMatrix('p', 'nlh', [1, 2, 3], 576 * 100, 576)).toThrow(/256/);
  });
});
