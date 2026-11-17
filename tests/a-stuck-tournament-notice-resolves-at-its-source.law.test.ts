/**
 * A STUCK TOURNAMENT NOTICE RESOLVES AT ITS SOURCE (2026-11-17).
 *
 * CriticalPage.stuck_tournament (sp-critical-pager) and
 * DailyDigest.stuck_tournament (sp-daily-digest) only ever wrote 'firing', so
 * Reliability Controller incidents 5d8a2c02 and 24c9bbaf stayed escalated
 * after Nightly 20K 10d3c9b3 completed and paid. 20261117173255 makes
 * fn_sp_critical_scan(), the subsystem's 5-minute evaluator of the stuck
 * predicate, move both notices of an ended condition to 'resolved' in place.
 * The behaviour is proven natively by
 * scripts/ci/test-stuck-tournament-notices-resolve.py; this law keeps every
 * later rewrite of fn_sp_critical_scan carrying the resolution step.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'supabase/migrations';
const FIX = '20261117173255_stuck_tournament_notices_resolve_at_source.sql';
const MARK = 'STUCK TOURNAMENT NOTICES RESOLVE AT THEIR SOURCE (20261117173255)';
const fix = readFileSync(`${DIR}/${FIX}`, 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('a stuck tournament notice resolves at its source', () => {
  it('resolves both sp notices of the condition, in place, only when the tournament stopped RUNNING', () => {
    const f = flat(fix);
    expect(f).toContain(MARK);
    expect(f).toContain(
      "(e.source = ''sp-critical-pager'' AND e.alertname = ''CriticalPage.stuck_tournament'')"
    );
    expect(f).toContain(
      "(e.source = ''sp-daily-digest'' AND e.alertname = ''DailyDigest.stuck_tournament'')"
    );
    expect(f).toContain("(t.id IS NULL OR t.status IS DISTINCT FROM ''RUNNING'')");
    expect(f).toContain("SET status = ''resolved''");
    expect(f).toContain("WHERE e.id = x.id AND e.status = ''firing''");
    expect(f).toContain("pg_input_is_valid(e.payload#>>''{detail,tournament_id}'', ''uuid'')");
  });

  it('installs only over the exact captured preimage and reads the result back', () => {
    expect(fix).toContain("md5(v_def) <> 'ef4c2c3dfdcba816c46a1e360c71a3d1'");
    expect(fix).toContain('SP_CRITICAL_SCAN_PREIMAGE_CHANGED');
    expect(fix).toContain('resolution step did not land');
    expect(fix).not.toMatch(/cron\.schedule|CREATE TRIGGER/i);
  });

  it('no later migration rewrites fn_sp_critical_scan without the resolution step', () => {
    const later = readdirSync(DIR)
      .filter((n) => n.endsWith('.sql') && n > FIX)
      .filter((n) =>
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_sp_critical_scan\s*\(/i.test(
          readFileSync(`${DIR}/${n}`, 'utf8')
        )
      );
    for (const n of later) expect(readFileSync(`${DIR}/${n}`, 'utf8'), n).toContain(MARK);
  });
});
