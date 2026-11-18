/**
 * LAW: POST-COMMIT LAG WARNS BEFORE THE CASCADE
 *
 * Incident 075013fd. The only database signal for a slow hand continuation
 * was fn_post_commit_stranded_watchdog, which pages when a committed hand's
 * post-commit work is still unfinished TEN MINUTES later. On 2026-11-17 it
 * paged once, at 23:30 UTC; read back from hand_atomic_commits, the per-table
 * p95 commit -> post_commit_completed_at was over the owner's 2 s hand-gap
 * limit on 16 tables in the 15:00 UTC hour and over 15 s from 19:00 UTC.
 *
 * 20261118084759 adds fn_ca_post_commit_lag_watch(), a DETECTOR (CLAUDE.md
 * 10.11/10.12: it writes alerts and nothing else; it is not presented as the
 * fix - the fixes are #11270/#11266 and the hand-path law). This pins:
 *
 *   1. the thresholds: warning p95 > 2 s with >= 5 hands in 5 minutes;
 *      critical p95 > 15 s with >= 3 hands, or any hand pending > 15 s;
 *   2. the window is bounded by now(), never clock_timestamp() (a volatile
 *      bound cannot use the committed_at index; measured on production);
 *   3. it writes financial_alerts only, guards per table
 *      (context->>'table_id'), escalates, resolves, and opens at most 10 a run;
 *   4. its messages are constant per severity, so the incident trigger folds
 *      every table's critical into one incident;
 *   5. one job, every minute, and the stranded watchdog is left to #11266;
 *   6. the PostgreSQL proof runs it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const FILE = '20261118084759_post_commit_lag_warns_before_the_cascade.sql';
const sql = read('supabase', 'migrations', FILE);
const code = (s: string) => s.replace(/--[^\n]*/g, ' ');
const parts = sql.split('$f$');
const body = code(parts[1] ?? '');

describe('post-commit lag warns before the cascade', () => {
  it('is one function body in one transaction', () => {
    expect(parts.length).toBe(3);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;\s*$/m);
    expect(sql).toMatch(/^-- @live-proof: .*fn_ca_post_commit_lag_watch.*post-commit-lag-watch-1m/m);
  });

  it('pins the thresholds and the window', () => {
    expect(body).toMatch(/c_warn_s\s+constant numeric := 2;/);
    expect(body).toMatch(/c_crit_s\s+constant numeric := 15;/);
    expect(body).toMatch(/c_clear_s\s+constant numeric := 1\.5;/);
    expect(body).toMatch(/c_warn_n\s+constant int\s+:= 5;/);
    expect(body).toMatch(/c_crit_n\s+constant int\s+:= 3;/);
    expect(body).toMatch(/c_max_new constant int\s+:= 10;/);
    expect(body).toContain("h.committed_at >= now() - interval '5 minutes'");
    expect(body).not.toMatch(/clock_timestamp\(\)/);
    // Pending hands of any age count, so a stalled table never auto-resolves.
    expect(body).toMatch(
      /h\.post_commit_completed_at IS NULL\s+AND h\.committed_at < now\(\) - interval '5 minutes'/
    );
  });

  it('writes financial_alerts only, one open alert per table', () => {
    const writes = [...body.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+([a-z_.]+)/gi)]
      .map((m) => m[1].toLowerCase())
      .filter((t) => t !== 'set');
    expect(new Set(writes)).toEqual(new Set(['financial_alerts']));
    expect(body).toContain("fa.context->>'table_id' = j->>'table_id'");
    expect(body).toContain("resolution = 'escalated to critical'");
    expect(body).toContain('CONTINUE WHEN v_new >= c_max_new;');
    expect(body).not.toMatch(/fn_post_commit_stranded_watchdog/);
  });

  it('says the same thing for every table, so one cause is one incident', () => {
    const messages = [...body.matchAll(/WHEN 'critical' THEN '([^']+)'|ELSE '([^']+)'/g)];
    expect(messages.length).toBe(2);
    for (const m of messages) expect(m[1] ?? m[2]).not.toMatch(/\|\||%/);
  });

  it('is a detector on one minute job, not a repair', () => {
    expect(sql).toContain(
      "SELECT cron.schedule('post-commit-lag-watch-1m', '* * * * *', 'select public.fn_ca_post_commit_lag_watch()');"
    );
    expect((sql.match(/cron\.schedule/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/fn_[a-z_]*(repair|backpay|redrive|sweep|catchup|heal)[a-z_]*/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_ca_post_commit_lag_watch\(\) FROM PUBLIC, anon, authenticated;/);
  });

  it('is proved on PostgreSQL', () => {
    const harness = read('scripts', 'ci', 'test-hand-path-shared-writes.py');
    expect(harness).toContain(FILE);
    expect(harness).toContain('G2: a storm opens at most 10 alerts per run');
    expect(read('.github', 'workflows', 'hand-path-shared-writes-proof.yml')).toContain(
      `supabase/migrations/${FILE}`
    );
  });
});
