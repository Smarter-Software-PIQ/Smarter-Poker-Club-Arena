import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('fn_opponent_hud_hands_page lower-bound index predicate regression guard', () => {
  it('migration 20261122202000 pushes h.created_at >= p_after_at while preserving keyset order, public projection, service_role grants, and probe', () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          '../../../supabase/migrations/20261122202000_opponent_hud_hands_page_index_lower_bound.sql',
          import.meta.url
        )
      ),
      'utf8'
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_opponent_hud_hands_page\(/);
    expect(sql).toMatch(/WHERE h\.game_variant IN \('plo4','plo5','nlh'\)/);
    expect(sql).toMatch(/AND h\.created_at >= p_after_at/);
    expect(sql).toMatch(
      /AND \(h\.created_at > p_after_at OR \(h\.created_at = p_after_at AND h\.id > p_after_id\)\)/
    );
    expect(sql).toMatch(/AND h\.created_at <= p_until/);
    expect(sql).toMatch(/ORDER BY h\.created_at, h\.id/);
    // Public fields only: never project hole cards
    expect(sql).not.toMatch(/->\s*'cards'/);
    // Strict service_role-only EXECUTE grant + function probe
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_opponent_hud_hands_page\(/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_opponent_hud_hands_page\(/);
    expect(sql).toMatch(/-- @probe-for: public\.fn_opponent_hud_hands_page/);
  });
});
