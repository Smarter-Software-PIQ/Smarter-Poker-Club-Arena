/**
 * MTT LAUNCH LATENESS MEASURES FROM A BOUNDED MAINTENANCE THAW (2026-11-28).
 *
 * Incident 334c611e-ec44-4006-b557-0ea8a66a1b8c (MttStartedLate, 56 occurrences /
 * 52 recurrences): 33 of 33 late MTT starts over the 6 days after the 2026-11-21
 * three-hourly cutover order were fixed-board :00 starts covered by the total
 * :00-:05 platform maintenance freeze that dealt 1-3 s after the :05:00 thaw.
 *
 * Migration 20261128075041 measures launch lateness from effective_start_time =
 * GREATEST(start_time, covering bounded <= 12 m maintenance thaw) while keeping
 * the 120 s late bar, 120 s headroom, and full alerting for any post-thaw stall,
 * non-break late launch, or unbounded (> 12 m) maintenance freeze.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261128075041_mtt_launch_lateness_measures_from_bounded_maintenance_thaw.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const sql = readFileSync(join(DIR, ROOT), 'utf8');

describe('MTT launch lateness measures from a bounded maintenance thaw', () => {
  it('wraps in BEGIN/COMMIT, declares @live-proof, pins live preimage MD5, and preserves definer search_path + service_role grants', () => {
    expect(sql).toMatch(/^-- @live-proof: /m);
    expect(sql).toMatch(/^\s*BEGIN\s*;/m);
    expect(sql.trim()).toMatch(/COMMIT\s*;$/);
    expect(sql).toContain("md5(v_def) IS DISTINCT FROM 'd4653d96547d94ac68342141e71b360e'");
    expect(sql).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_tournament_launch_lateness_metrics(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_tournament_launch_lateness_metrics(integer, integer, integer, integer) TO service_role;'
    );
  });

  it('bounds maintenance thaw credit strictly to <= 12 minutes covering t.start_time across both break_log and complete v3 thaws', () => {
    expect(sql).toContain(
      'GREATEST(t.start_time, COALESCE(mw.thaw_at, t.start_time)) AS effective_start_time'
    );
    expect(sql).toContain('FROM public.engine_maintenance_break_log l');
    expect(sql).toContain("l.break_ended_at <= l.break_started_at + interval '12 minutes'");
    expect(sql).toContain('FROM public.engine_maintenance_thaws th');
    expect(sql).toContain('th.contract_version = 3');
    expect(sql).toContain("COALESCE((th.shifted->>'complete')::boolean, false)");
    expect(sql).toContain("th.release_target_at <= th.freeze_started_at + interval '12 minutes'");
    expect(sql).toContain('c.first_started > c.effective_start_time + b.late AS late_dealt');
    expect(sql).toContain(
      'c.effective_start_time < b.now_at - b.late - b.headroom AS late_waiting'
    );
  });

  it('no later migration redefines fn_tournament_launch_lateness_metrics without bounded maintenance thaw awareness', () => {
    const idx = files.indexOf(ROOT);
    expect(idx).toBeGreaterThanOrEqual(0);
    for (const f of files.slice(idx + 1)) {
      const body = readFileSync(join(DIR, f), 'utf8');
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?fn_tournament_launch_lateness_metrics\b/i.test(
          body
        )
      ) {
        expect(body, `${f} dropped bounded maintenance thaw measurement`).toContain(
          'effective_start_time'
        );
        expect(body, `${f} dropped 12-minute thaw cap`).toContain("interval '12 minutes'");
      }
    }
  });
});
