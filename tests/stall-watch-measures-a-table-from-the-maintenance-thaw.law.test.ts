/**
 * A STOPPED TABLE IS MEASURED FROM THE MAINTENANCE THAW (2026-11-07).
 *
 * 33 of the 38 critical TableStoppedDealing alerts of 2026-11-05 were raised
 * 0-60 s after the hourly maintenance thaw, reading the ~600 s since the last
 * hand before the :55 break. Migration 20261107032642 excuses a table whose
 * last hand predates the latest thaw only while that thaw is under 60 s old;
 * after that it is raised as before, with the time measured since the thaw.
 * Dan's rule (2026-10-31: caught within 60 seconds) is kept exactly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261107032642_stall_watch_measures_a_table_from_the_maintenance_thaw.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const root = readFileSync(join(DIR, ROOT), 'utf8');

describe('stall watch measures a table from the maintenance thaw', () => {
  it('the excuse lasts only 60 seconds after the thaw and only for a table silent since before it', () => {
    expect(root).toContain(
      "(p_facts->>''maintenance_thawed_at'')::timestamptz > p_now - interval ''60 seconds''"
    );
    expect(root).toContain('p_now - make_interval(secs => p_ms / 1000.0) < (p_facts->>');
    expect(root).toContain("RETURN ''resuming_after_maintenance''");
  });

  it('the thaw is read from the completed maintenance break log, never assumed', () => {
    expect(root).toMatch(
      /max\(l\.break_ended_at\) INTO v_last_thaw FROM public\.engine_maintenance_break_log l/
    );
    expect(root).toContain("jsonb_build_object(''maintenance_thawed_at'', v_last_thaw)");
  });

  it('the migration proves a silent table 61 s after the thaw is still raised', () => {
    expect(root).toContain("thaw + interval '61 seconds'");
    expect(root).toContain(
      'STALL_THAW_PROOF a table silent 61 s after the thaw was not called stopped'
    );
  });

  it('no later migration redefines the decision without the thaw excuse bound', () => {
    for (const f of files.slice(files.indexOf(ROOT) + 1)) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      if (/FUNCTION public\.fn_ca_table_stall_decide\(/.test(sql)) {
        expect(sql, `${f} redefines the stall decision`).toContain('resuming_after_maintenance');
      }
    }
  });
});
