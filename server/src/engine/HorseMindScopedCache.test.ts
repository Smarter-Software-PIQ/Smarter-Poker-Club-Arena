import { afterEach, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';

afterEach(() => HorseMind.reset());

it('retires evicted scoped dirty keys while preserving every surviving dirty observation', () => {
  HorseMind.reset();
  HorseMind.setDecisionScope('omaha:short', 'plo5', 'cash');
  // Cross the existing 4,000-player/four-scope capacity through real observations.
  // Eviction must bound its own bookkeeping without an intervening persistence flush.
  for (let i = 0; i < 16_002; i++) {
    HorseMind.observe(
      [
        {
          userId: `opponent-${i}`,
          seat: 1,
          stage: 'preflop',
          action: 'raise',
          amount: 4,
          timestamp: i + 1,
        },
      ],
      []
    );
  }
  const dirtyBeforeExport = HorseMind.dirtyScopedCount();
  const rows = HorseMind.exportDirtyScoped();
  expect(HorseMind.getScopedStats('opponent-0', 'omaha:short')).toBeUndefined();
  expect(HorseMind.getScopedStats('opponent-16001', 'omaha:short')?.hands).toBe(1);
  // Dirty bookkeeping must contain real retained rows, not keys of evicted rows.
  expect(dirtyBeforeExport).toBe(rows.length);
  expect(rows).toContainEqual(
    expect.objectContaining({ user_id: 'opponent-16001', scope: 'omaha:short', hands: 1 })
  );
  expect(HorseMind.dirtyScopedCount()).toBe(0);
  HorseMind.requeueDirtyScoped([
    { user_id: 'opponent-0', scope: 'omaha:short' },
    { user_id: 'opponent-16001', scope: 'omaha:short' },
  ]);
  expect(HorseMind.dirtyScopedCount()).toBe(1);
});
