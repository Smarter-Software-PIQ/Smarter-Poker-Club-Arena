import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * table_seats keeps ~800 live rows among millions. At the default ANALYZE
 * sample (30,000 rows) the live fraction rounds to zero, every partial index on
 * `left_at IS NULL` is recorded with reltuples = 0, and the planner then scans
 * those indexes whole once per outer row. That turned the tournament stack
 * cross-check in fn_ca_settle_hand_stacks_absolute into an 8 s statement under
 * the tournament settlement lane and stalled every game (issue #10361,
 * 2026-11-10). The fix is a statistics target of at least 1000 on left_at;
 * this pins that the newest migration touching it never lowers it.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');
const STATEMENT =
  /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?table_seats\s+ALTER\s+(?:COLUMN\s+)?left_at\s+SET\s+STATISTICS\s+(-?\d+)/gi;

describe('table_seats live partial indexes keep a real row estimate', () => {
  it('the latest statistics target on table_seats.left_at is at least 1000', () => {
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    let latest: { file: string; target: number } | null = null;
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      for (const m of sql.matchAll(STATEMENT)) latest = { file, target: Number(m[1]) };
    }
    expect(latest, 'no migration sets table_seats.left_at statistics').not.toBeNull();
    expect(
      latest!.target,
      `${latest!.file} lowers table_seats.left_at statistics`
    ).toBeGreaterThanOrEqual(1000);
  });
});
