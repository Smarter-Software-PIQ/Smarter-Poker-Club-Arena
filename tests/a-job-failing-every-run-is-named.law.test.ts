import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dan, 2026-11-07: pg_cron job 117 (sp_prune_hand_history_10m) failed on every
// run from 19:56 UTC. PgCronFailuresElevated said only "103 pg_cron failures in
// the last hour" (a warning naming no job); the per-job watch raised at 00:37,
// 4 h 41 m in, because it waited for two hours with no success at all and the
// job still succeeded now and then. A job failing run after run is now named
// within ten minutes, by one rule shared by the watch and the collector.
// Behaviour is proved on PostgreSQL 17 by scripts/ci/test-cron-failing-jobs.py.

const migration = readFileSync(
  'supabase/migrations/20261108020000_a_job_failing_every_run_is_named.sql',
  'utf8'
);
const collector = readFileSync('server/scripts/collect-monitoring-health.sh', 'utf8');
const rules = readFileSync('infra/monitoring/alert-rules.yml', 'utf8');
const workflow = readFileSync('.github/workflows/a-job-failing-every-run-is-named.yml', 'utf8');

function rule(name: string): string {
  const start = rules.indexOf(`- alert: ${name}\n`);
  expect(start, name).toBeGreaterThan(-1);
  const next = rules.indexOf('- alert: ', start + 10);
  return rules.slice(start, next === -1 ? undefined : next);
}

describe('a job failing every run is named', () => {
  it('one rule: a streak of three for ten minutes, or 18 of the last 20 over ten minutes', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.fn_cron_failing_jobs()');
    expect(migration).toContain(
      "WHERE (s.n >= 3 AND s.since <= now() - interval '10 minutes')\n      OR (l.runs = 20 AND l.fails >= 18 AND l.since <= now() - interval '10 minutes')"
    );
    // A success ends the streak: only failures after the job's last success count.
    expect(migration).toContain("WHERE r.status = 'failed' AND r.runid > coalesce(o.ok_runid, 0)");
    // Read by the primary key range, never a scan of the whole run history.
    expect(migration).toContain(
      'SELECT coalesce(max(d.runid), 0) - 20000 AS lo FROM cron.job_run_details d'
    );
    expect(migration).toContain('WHERE d.runid > bound.lo');
  });

  it('only the collector can read it', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.fn_cron_failing_jobs() FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_cron_failing_jobs() TO service_role;'
    );
  });

  it('the per-job watch raises the streak by name, once a day per job, and a broken read is critical', () => {
    expect(migration).toContain('FOR r IN SELECT f.* FROM public.fn_cron_failing_jobs() f');
    expect(migration).toContain('WHERE NOT (f.jobname = ANY (v_raised))');
    expect(
      migration.match(/'cron-failing:' \|\| r\.jobname \|\| ':' \|\| CURRENT_DATE::text/g)
    ).toHaveLength(2);
    expect(migration).toContain("'cron-failing-streak-read-failed:' || CURRENT_DATE::text");
    // Its two original rules are kept, unchanged.
    expect(migration).toContain(
      "AND (day.last_success IS NULL OR day.last_success <= now() - interval '2 hours'))"
    );
    expect(migration).toContain('OR (day.fails >= 5 AND day.fails > day.successes)');
  });

  it('the collector names each failing job and never withholds the fleet gauges for it', () => {
    expect(collector).toContain('rest/v1/rpc/fn_cron_failing_jobs');
    expect(collector).toContain(
      `series.append(f'poker_cron_job_failing_streak{{jobname="{name}",guard="{guard}"}} {streak:g}')`
    );
    expect(collector).toContain("|| CRON_FAILING_RENDERED='poker_cron_failing_collect_ok 0'");
    // Optional half: it runs after the fail-closed snapshot has rendered.
    expect(collector.indexOf('rpc/fn_cron_failing_jobs')).toBeGreaterThan(
      collector.indexOf('|| die "could not render the snapshot"')
    );
  });

  it('the alert says which job, splits guards to critical, and sits out maintenance', () => {
    const warning = rule('PgCronJobFailingRepeatedly');
    // failing_of_last_20, not the streak: a job named by 18 of its last 20 can have a streak of 0.
    expect(warning).toContain(
      'max by (jobname) (poker_cron_job_failing_of_last_20{guard="false"}) > 0'
    );
    expect(warning).toContain('{{ $labels.jobname }}');
    expect(warning).toContain('severity: warning');
    expect(warning).toContain('keep_firing_for: 15m');
    expect(warning).toContain('unless on() max_over_time(poker_maintenance_break_active[6m]) == 1');
    const critical = rule('PgCronGuardJobFailingRepeatedly');
    expect(critical).toContain(
      'max by (jobname) (poker_cron_job_failing_of_last_20{guard="true"}) > 0'
    );
    expect(critical).toContain('severity: critical');
    expect(critical).toContain('{{ $labels.jobname }}');
    expect(rule('CronFailingJobsBlind')).toContain('poker_cron_failing_collect_ok');
  });

  it('CI runs the PostgreSQL proof whenever the rule, the watch or the collector changes', () => {
    expect(workflow).toContain('python3 scripts/ci/test-cron-failing-jobs.py --output');
    expect(workflow).toContain('- server/scripts/collect-monitoring-health.sh');
    expect(workflow).toContain(
      '- supabase/migrations/20261108020000_a_job_failing_every_run_is_named.sql'
    );
    expect(workflow).not.toMatch(/^\s*schedule:/m);
  });
});
