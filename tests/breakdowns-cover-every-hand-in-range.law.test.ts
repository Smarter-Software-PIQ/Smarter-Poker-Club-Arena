/**
 * BREAKDOWNS COVER EVERY HAND IN RANGE (Dan 2026-11-04).
 *
 * The position, game and stake breakdowns on the stats page read the same
 * hand set as the headline totals, never a 750-hand sample of it. Pins the
 * migration that redefines the four overview readers, so a later rewrite
 * cannot quietly put the sample back.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = readFileSync(
  resolve(
    __dirname,
    '..',
    'supabase/migrations/20261104194608_breakdowns_cover_every_hand_in_range.sql'
  ),
  'utf8'
);
/* The header's @live-proof line quotes a FROM clause; count only the SQL. */
const sql = raw
  .split('\n')
  .filter((line) => !line.startsWith('--'))
  .join('\n');

describe('breakdowns cover every hand in range', () => {
  it('redefines all four overview readers in one transaction', () => {
    expect(sql.match(/CREATE OR REPLACE FUNCTION public\.ca_player_stats_overview_/g)?.length).toBe(
      4
    );
    expect(raw.trim().startsWith('-- 20261104194608')).toBe(true);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('no breakdown groups over the sample any more', () => {
    expect(sql).not.toMatch(/FROM scored GROUP BY (position|game_variant)/);
    expect(sql).not.toMatch(
      /FROM scored WHERE (is_cash|tournament_id IS NULL) AND big_blind\s*>\s*0/
    );
    expect(sql.match(/FROM (filtered|source_rows) GROUP BY position/g)?.length).toBe(4);
    expect(sql.match(/FROM (filtered|source_rows) GROUP BY game_variant/g)?.length).toBe(4);
  });

  it('the payload names what still samples', () => {
    expect(sql.match(/'analysis_sampled_sections',jsonb_build_array\('sessions'\)/g)?.length).toBe(
      2
    );
    expect(sql.match(/'analysis_sampled_sections',jsonb_build_array\(\)/g)?.length).toBe(2);
  });
});
