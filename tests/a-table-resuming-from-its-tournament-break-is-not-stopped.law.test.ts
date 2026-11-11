/**
 * A TABLE RESUMING FROM ITS TOURNAMENT BREAK IS NOT STOPPED (2026-11-11).
 *
 * Operational alert 376615 (and 247 like it in 14 days): at the first stall
 * watch tick after the hourly synchronized tournament break was released, the
 * table's ms-since-progress still counted from its last hand before :55 and
 * tournaments.on_break was already false, so TableStoppedDealing was raised
 * ("no progress for 309 seconds") before the table had a second to deal.
 * 20261107032642 had fixed the same shape for the maintenance thaw only.
 *
 * Migration 20261111074922 records the watch's own last sight of the break
 * (ca_table_stall_watch.tournament_break_seen_at) and excuses a table silent
 * since before it for 60 seconds after it, never longer. Dan's rule
 * (2026-10-31: a stopped table is caught within 60 seconds) is kept exactly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261111074922_a_table_resuming_from_its_tournament_break_is_not_stopped.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

describe('a table resuming from its tournament break is not stopped', () => {
  it('the migration exists', () => {
    expect(files).toContain(ROOT);
  });

  const root = files.includes(ROOT) ? read(ROOT) : '';

  it('the excuse needs the break to be over, lasts 60 s after the break was last seen, and covers only a table silent since before it', () => {
    expect(root).toContain("IF NOT COALESCE((p_facts->>''on_break'')::boolean, false)");
    expect(root).toContain(
      "(p_facts->>''tournament_break_seen_at'')::timestamptz > p_now - interval ''60 seconds''"
    );
    expect(root).toContain(
      "p_now - make_interval(secs => p_ms / 1000.0) < (p_facts->>''tournament_break_seen_at'')::timestamptz"
    );
    expect(root).toContain("RETURN ''resuming_after_tournament_break''");
  });

  it('the end of the break is the watch observing it, never a guessed duration', () => {
    expect(root).toContain('ADD COLUMN IF NOT EXISTS tournament_break_seen_at timestamptz');
    expect(root).toContain("CASE WHEN v_reason = ''tournament_break'' THEN p_now END");
    expect(root).toContain(
      'COALESCE(EXCLUDED.tournament_break_seen_at, w.tournament_break_seen_at)'
    );
    expect(root).not.toMatch(/break_started_at''\)::timestamptz \+ interval ''(5|6|7) minutes/);
  });

  it('the migration proves a table still silent 61 s after its break is raised, and the thaw excuse is unchanged', () => {
    expect(root).toContain("seen + interval '61 seconds'");
    expect(root).toContain(
      'STALL_BREAK_PROOF a table silent 61 s after its tournament break was not called stopped'
    );
    expect(root).toContain(
      'STALL_BREAK_PROOF a table that dealt after its break and then stopped was excused'
    );
    expect(root).toContain('STALL_BREAK_PROOF the maintenance-thaw excuse moved');
  });

  it('the migration is gated on the live pre-image and carries a live proof', () => {
    expect(root).toContain('STALL_BREAK_PREIMAGE_DRIFT');
    expect(root).toMatch(/^-- @live-proof: .*resuming_after_tournament_break/m);
  });

  it('no later migration redefines the decision without the tournament-break bound', () => {
    for (const f of files.filter((f) => f > ROOT)) {
      const sql = read(f);
      if (/FUNCTION public\.fn_ca_table_stall_decide\(/.test(sql)) {
        expect(sql, `${f} redefines the stall decision`).toContain(
          'resuming_after_tournament_break'
        );
      }
    }
  });
});
