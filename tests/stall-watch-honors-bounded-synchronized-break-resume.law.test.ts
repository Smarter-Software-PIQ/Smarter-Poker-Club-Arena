/**
 * STALL WATCH HONORS THE BOUNDED SYNCHRONIZED BREAK RESUME BOUNDARY (2026-11-28).
 *
 * Incidents 82f7e3ed / 6139298e / 641a108f (Friday Night Feature, 05:00:51Z)
 * and 20 of the 20 most recent TableStoppedDealing alerts over 7 days all fired
 * in the ~200-500 ms race where /metrics was scraped with paused="1" and
 * 301-362 s of break silence right before TournamentManagerBase.resumeFromBreak()
 * committed clearPersistedBreak() (on_break = false, break_ends_at = null) ahead
 * of engine.resumeDealing().
 *
 * Migration 20261128075816 patches fn_ca_table_stall_decide to return
 * 'tournament_break_resuming' strictly when p_engine_paused = true,
 * break_started_at is within 8 minutes of p_now, and the table's last progress
 * was at or after break_started_at - 2 minutes — keeping the 60 s unpaused
 * stall catch, the 8 m stuck-pause ceiling, and pre-break stall detection intact.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261128075816_stall_watch_honors_bounded_synchronized_break_resume.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const sql = readFileSync(join(DIR, ROOT), 'utf8');

describe('stall watch honors the bounded synchronized break resume boundary', () => {
  it('wraps in BEGIN/COMMIT, declares @live-proof, pins live preimage MD5, and checks single-anchor match', () => {
    expect(sql).toMatch(/^-- @live-proof: /m);
    expect(sql).toMatch(/^\s*BEGIN\s*;/m);
    expect(sql.trim()).toMatch(/COMMIT\s*;$/);
    expect(sql).toContain("md5(v_def) IS DISTINCT FROM '077f272a204d8392dc292a49d1eec168'");
    expect(sql).toContain('STALL_BREAK_RESUME_ANCHOR_DRIFT');
  });

  it('bounds the synchronized break resume excuse strictly to paused=true, <= 8m from break_started_at, and progressing up to the break', () => {
    expect(sql).toContain('IF COALESCE(p_engine_paused, false)');
    expect(sql).toContain("(p_facts->>''break_started_at'')::timestamptz <= p_now");
    expect(sql).toContain(
      "(p_facts->>''break_started_at'')::timestamptz > p_now - interval ''8 minutes''"
    );
    expect(sql).toContain(
      "p_now - make_interval(secs => p_ms / 1000.0) >= (p_facts->>''break_started_at'')::timestamptz - interval ''2 minutes''"
    );
    expect(sql).toContain("RETURN ''tournament_break_resuming'';");
  });

  it('proves all 6 behavioral boundaries inside the migration transaction before COMMIT', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(sql).toContain(`STALL_BREAK_RESUME_PROOF case ${n} failed`);
    }
  });

  it('no later migration redefines fn_ca_table_stall_decide without the synchronized break resume boundary', () => {
    const idx = files.indexOf(ROOT);
    expect(idx).toBeGreaterThanOrEqual(0);
    for (const f of files.slice(idx + 1)) {
      const body = readFileSync(join(DIR, f), 'utf8');
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?fn_ca_table_stall_decide\b/i.test(body)
      ) {
        expect(body, `${f} dropped tournament_break_resuming guard`).toContain(
          'tournament_break_resuming'
        );
      }
    }
  });
});
