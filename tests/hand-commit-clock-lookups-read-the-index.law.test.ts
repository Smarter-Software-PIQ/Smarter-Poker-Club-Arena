import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * HAND COMMIT CLOCK LOOKUPS READ THE INDEX (2026-11-24, 20261124081037).
 * Promo Play Through reads committed_at of thousands of hands per member while
 * process_tournament_rebuy holds the tournament lock. Without the covering
 * index each probe fetched a cold row from the 17 GB hand_atomic_commits heap
 * (7.9-13.8 s cold), the rebuy held its tournament past the engine's 4 s / 8 s
 * deadlines, and DatabaseRepliesLost fired (largest at the Nightly 20K add-on
 * close). This law keeps the index: it must be built by a sanctioned
 * concurrent preamble, verified by name, and never dropped by a later file.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const NAME = 'idx_hand_atomic_commits_hand_id_committed_cover';
const FILE = '20261124081037_hand_commit_clock_lookups_read_the_index.sql';

describe('hand commit clock lookups read the index', () => {
  it('the index is built concurrently with (hand_id) INCLUDE (committed_at) and verified', () => {
    const sql = readFileSync(join(DIR, FILE), 'utf8');
    expect(sql).toMatch(
      new RegExp(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${NAME}\\s+ON public\\.hand_atomic_commits USING btree \\(hand_id\\) INCLUDE \\(committed_at\\);`
      )
    );
    expect(sql).toContain('HAND_COMMIT_CLOCK_COVER_NOT_QUALIFIED');
    expect(sql).toMatch(/^-- @live-proof: .*idx_hand_atomic_commits_hand_id_committed_cover/m);
  });

  it('no later migration drops or replaces the index', () => {
    const later = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f > FILE)
      .filter((f) =>
        new RegExp(`DROP\\s+INDEX[^;]*${NAME}`, 'i').test(readFileSync(join(DIR, f), 'utf8'))
      );
    expect(later).toEqual([]);
  });
});
