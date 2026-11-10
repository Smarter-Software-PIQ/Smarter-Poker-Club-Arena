import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canQuickCheckFold, facingShovePrice } from './HorseQuickCheckFold.js';

describe('the fixed tournament check/fold cohort', () => {
  it('admits precisely the selected half of the canonical account manifest', () => {
    const source = readFileSync(
      new URL(
        '../../../supabase/migrations/20261102141229_horses_belong_to_one_assigned_club.sql',
        import.meta.url
      ),
      'utf8'
    );
    const ids = Array.from(source.matchAll(/\('([a-f0-9-]{36})','[DF]'\)/g), (m) => m[1]);
    const rank = (id: string) =>
      createHash('sha256')
        .update('tournament-quick-check-fold:' + id)
        .digest('hex');
    expect(new Set(ids).size).toBe(1000);
    const expected = ids
      .slice()
      .sort((a, b) => rank(a).localeCompare(rank(b)))
      .slice(0, 500)
      .sort();
    expect(ids.filter(canQuickCheckFold).sort()).toEqual(expected);
    expect(canQuickCheckFold('unknown-account')).toBe(false);
  });

  it('recognizes a live all-in at the price owed, including after another seat calls', () => {
    const players = [{ bet: 10, is_all_in: true }, { bet: 10 }];
    expect(facingShovePrice(10, 2, players)).toBe(true);
    expect(facingShovePrice(10, 10, players)).toBe(false);
    expect(facingShovePrice(20, 2, players)).toBe(false);
    expect(facingShovePrice(10, 2, [{ bet: 10, is_all_in: true, is_folded: true }])).toBe(false);
  });
});
