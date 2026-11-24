/**
 * STALL WATCH HONORS THE BOUNDED V3 MAINTENANCE THAW BOUNDARY (2026-11-24).
 *
 * Incident 6684eba0-e78b-4872-b968-1858d8ece5f7: during the final 70 seconds
 * of a scheduled 5-minute maintenance break, v3 thaw deletes
 * engine_maintenance_break while handing the freeze to
 * engine_maintenance_thaws.release_target_at. A pg_cron tick that captured
 * v_now before http_get('/metrics') then straddled the 04:05:00Z thaw and saw
 * poker_maintenance_break_active=0 before engine_maintenance_break_log
 * committed, raising 15 false TableStoppedDealing alerts (2 critical).
 *
 * Migration 20261124041800 closes both holes without weakening the 60s
 * post-thaw stall catch:
 *   1. fn_ca_table_stall_watch_tick refreshes v_now after http_get and skips
 *      bounded (<= 5 minutes) complete v3 thaws while fn_platform_frozen().
 *   2. fn_ca_table_stall_watch_ingest computes v_last_thaw as GREATEST of
 *      engine_maintenance_break_log.break_ended_at and bounded complete v3
 *      engine_maintenance_thaws.release_target_at.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261124041800_stall_watch_v3_thaw_boundary.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const root = readFileSync(join(DIR, ROOT), 'utf8');

describe('stall watch honors bounded complete v3 maintenance thaw boundaries', () => {
  it('opens with BEGIN, closes with COMMIT, declares @live-proof, and pins exact live preimages', () => {
    expect(root).toMatch(/^-- @live-proof: /m);
    expect(root).toMatch(/^\s*BEGIN\s*;/m);
    expect(root.trim()).toMatch(/COMMIT\s*;$/);
    expect(root).toContain("md5(v_tick_def) IS DISTINCT FROM '87164ec27781d0534559e80a6fd16bf4'");
    expect(root).toContain("md5(v_ingest_def) IS DISTINCT FROM '91feca7e2e98b63f1f28777cda57b67a'");
    expect(root).toMatch(/anchor found % times/);
  });

  it('tick refreshes v_now after http_get and bounds v3 thaw freeze skipping to 5 minutes', () => {
    expect(root).toContain(
      'v_now := clock_timestamp();\\n  RETURN public.fn_ca_table_stall_watch_ingest(v_body, v_now, p_threshold_ms);'
    );
    expect(root).toContain('FROM public.engine_maintenance_thaws t');
    expect(root).toContain('t.contract_version = 3');
    expect(root).toContain("COALESCE((t.shifted->>'complete')::boolean, false)");
    expect(root).toContain("t.release_target_at <= t.freeze_started_at + interval '5 minutes'");
  });

  it('ingest takes GREATEST of break_log and bounded complete v3 thaw release_target_at', () => {
    expect(root).toContain('SELECT GREATEST(');
    expect(root).toContain(
      'SELECT max(l.break_ended_at) FROM public.engine_maintenance_break_log l'
    );
    expect(root).toContain(
      'SELECT max(t.release_target_at) FROM public.engine_maintenance_thaws t'
    );
    expect(root).toContain('AND t.release_target_at <= p_now');
    expect(root).toContain("AND t.release_target_at > p_now - interval '1 day'");
  });

  it('no later migration drops v3 thaw awareness or post-HTTP v_now refresh', () => {
    const rootIndex = files.indexOf(ROOT);
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    for (const f of files.slice(rootIndex + 1)) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?fn_ca_table_stall_watch_tick\b/i.test(sql)
      ) {
        expect(sql, `${f} redefines tick without v3 thaw guard`).toContain(
          'engine_maintenance_thaws'
        );
        expect(sql, `${f} redefines tick without post-HTTP v_now refresh`).toContain(
          'v_now := clock_timestamp();'
        );
      }
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?fn_ca_table_stall_watch_ingest\b/i.test(
          sql
        )
      ) {
        expect(sql, `${f} redefines ingest without v3 thaw GREATEST`).toContain(
          'engine_maintenance_thaws'
        );
      }
    }
  });
});
