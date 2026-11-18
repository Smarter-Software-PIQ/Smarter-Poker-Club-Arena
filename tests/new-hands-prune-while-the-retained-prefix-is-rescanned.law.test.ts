/**
 * LAW: NEW HANDS PRUNE WHILE THE RETAINED PREFIX IS RESCANNED (2026-11-18).
 *
 * sp_prune_hand_history resets its pass cursor to -infinity an hour after a
 * pass starts, so a hand whose guard released is found again. That rescan
 * walks every retained row older than the boundary, 250 a page, and on
 * production took 30-35 hours; until it finished no newly eligible hand was
 * pruned, and the backlog was then deleted back to back (2,300-3,200 s of
 * database time an hour, measured 2026-11-18 05:45 UTC, cursor 26 hours
 * behind the eight-day boundary).
 *
 * Migration 20261118061009 adds a forward-only frontier cursor: whenever it is
 * more than five minutes behind the boundary the page scans from it instead
 * of the pass, and the pass is restored untouched afterwards. A frontier still
 * two hours behind after its page is recorded in the alert store. The native
 * proof is scripts/ci/fixtures/hand-prune-frontier.sql (CI shard 4): the old
 * body prunes none of 100 new hands in two pages, the new one prunes all 100
 * on its first.
 *
 * This pins the frontier in whichever migration last redefines the pruner, and
 * keeps the native proof wired into CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'supabase', 'migrations');
const INSTALLS =
  '20261118061009_new_hand_history_prunes_while_the_retained_prefix_is_rescanned.sql';
const FIXTURE = 'scripts/ci/fixtures/hand-prune-frontier.sql';
const files = fs
  .readdirSync(DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const codeOnly = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const DEFINES = /create\s+or\s+replace\s+function\s+public\.sp_prune_hand_history\s*\(/i;

function livePruner(): { file: string; body: string } {
  const file = files.filter((f) => DEFINES.test(read(f))).pop() as string;
  const sql = read(file);
  const start = sql.search(DEFINES);
  return { file, body: codeOnly(sql.slice(start, sql.indexOf('$function$;', start))) };
}

describe('new hands prune while the retained prefix is rescanned', () => {
  it('the installing migration exists, creates the frontier and pins pre- and post-image', () => {
    expect(files).toContain(INSTALLS);
    const sql = read(INSTALLS);
    expect(codeOnly(sql)).toContain('CREATE TABLE smarter_private.hand_history_prune_frontier(');
    expect(sql).toContain(
      'ALTER TABLE smarter_private.hand_history_prune_frontier ENABLE ROW LEVEL SECURITY;'
    );
    expect(sql).toContain(
      'REVOKE ALL ON smarter_private.hand_history_prune_frontier FROM PUBLIC,anon,authenticated,service_role;'
    );
    expect(codeOnly(sql)).not.toMatch(/REFERENCES\s+public\./i);
    expect(sql).toContain("md5(pg_get_functiondef(p.oid))='637890ae88e74d2cc436f2ca602843f3'");
    expect(sql).toContain("md5(pg_get_functiondef(p.oid))='a1c3d74086b7d42a2cdc8ab3bd58a666'");
    expect(sql).not.toMatch(/cron\.(alter_job|schedule|unschedule)/);
  });

  it('a page scans from the frontier whenever it is behind, and the pass is restored after it', () => {
    const { file, body } = livePruner();
    expect(body, file).toContain(
      'FROM smarter_private.hand_history_prune_frontier f WHERE f.singleton FOR UPDATE'
    );
    expect(body, file).toContain(
      'v_frontier_turn := v_frontier_after<now()-v_window-v_frontier_slack;'
    );
    expect(body, file).toMatch(
      /IF v_frontier_turn THEN\s+v_rescan_after := v_resume_after;\s+v_rescan_id := v_resume_id;\s+v_resume_after := v_frontier_after;\s+v_resume_id := v_frontier_id;/
    );
    expect(body, file).toMatch(
      /IF v_frontier_turn THEN\s+v_frontier_after := v_resume_after;\s+v_frontier_id := v_resume_id;\s+v_resume_after := v_rescan_after;\s+v_resume_id := v_rescan_id;/
    );
    expect(body, file).toMatch(
      /UPDATE smarter_private\.hand_history_prune_frontier\s+SET frontier_after=v_frontier_after,frontier_id=v_frontier_id/
    );
    // the frontier is persisted before RETURN, in the same transaction as the deletes
    expect(body.indexOf('UPDATE smarter_private.hand_history_prune_frontier')).toBeLessThan(
      body.lastIndexOf('RETURN v_deleted;')
    );
  });

  it('a frontier left behind is recorded in the alert store for the fleet', () => {
    const { file, body } = livePruner();
    expect(body, file).toContain("public.fn_record_operational_alert('hand-history-retention',");
    expect(body, file).toContain("'HandHistoryPruneFrontierBehind','firing','warning'");
    expect(body, file).toContain("'target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca'");
  });

  it('the native proof binds the installing body and runs in CI', () => {
    const fixture = fs.readFileSync(path.join(ROOT, FIXTURE), 'utf8');
    expect(fixture).toContain('old pruner did not reproduce the starved frontier');
    expect(fixture).toContain('frontier did not prune the newly eligible hands first');
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain(`--fixture ${FIXTURE} --candidate supabase/migrations/${INSTALLS}`);
  });
});
