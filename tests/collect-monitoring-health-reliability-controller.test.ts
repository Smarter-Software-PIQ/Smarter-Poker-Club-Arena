/**
 * The Reliability Controller's health rides the money-health collector
 * (2026-11-09). The controller lives in the database it reports through, so
 * these gauges are how its silence becomes an email. Two things must hold:
 * a read that fails publishes NO controller series (absence is what
 * ReliabilityControllerMetricsAbsent alerts on, and a zero would be an
 * all-clear nobody read), and it never withholds the money gauges.
 * Runs the real script with a stand-in `curl`.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCRIPT = join(ROOT, 'server/scripts/collect-monitoring-health.sh');
const dir = mkdtempSync(join(tmpdir(), 'collect-reliability-'));
const envFile = join(dir, 'engine.env');
writeFileSync(envFile, 'SUPABASE_URL=https://db.invalid\nSUPABASE_SERVICE_ROLE_KEY=test-key\n');
const MONEY = JSON.stringify([
  {
    settlement_failure_rate: 0,
    settlement_window_hands: 10,
    settlement_stuck: 0,
    money_undeclared_triggers: 0,
    financial_alerts_unresolved: 1,
    financial_alerts_stale_critical: 0,
    financial_alerts_distinct_conditions: 1,
    cron_pg_runs: 800,
    cron_pg_failures: 0,
    cron_openclaw_stale: 0,
    cron_openclaw_worst_silence_minutes: 0,
    cron_jobs_skipping_all_work: 0,
  },
]);
const HEALTHY = {
  heartbeat_at_unix: 1794250000.25,
  heartbeat_age_seconds: 21,
  notifications_queued: 2,
  notifications_failed_24h: 1,
  intake_rejections_24h: 3,
  mutation_paused: true,
  notify_mode: 'observe',
};
const bin = join(dir, 'bin');
mkdirSync(bin, { recursive: true });
writeFileSync(
  join(bin, 'curl'),
  `#!/usr/bin/env bash
case "$*" in
  *fn_monitoring_health_snapshot*) printf '%s' '${MONEY}' ;;
  *fn_lightning_admission_policy*)
    if [ -n "\${CASH_POLICY_FAILS:-}" ]; then exit 22; fi
    printf '%s' "$CASH_POLICY_ANSWER" ;;
  *fn_reliability_controller_health*)
    if [ -n "\${RELIABILITY_FAILS:-}" ]; then echo 'curl: (22) 404' >&2; exit 22; fi
    printf '%s' "$RELIABILITY_ANSWER" ;;
  *) exit 7 ;;
esac
`
);
chmodSync(join(bin, 'curl'), 0o755);

function collect(answer: unknown, extra: Record<string, string> = {}): string {
  return execFileSync('bash', [SCRIPT], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      ENGINE_ENV_FILE: envFile,
      DRY_RUN: '1',
      RELIABILITY_ANSWER: JSON.stringify(answer),
      ...extra,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const controllerSeries = (out: string) =>
  out
    .split('\n')
    .filter((l) => l.startsWith('reliability_controller_'))
    .filter((l) => !l.startsWith('reliability_controller_collect_ok'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('collect-monitoring-health reliability controller gauges', () => {
  it('publishes every gauge, the heartbeat time at full precision and the mode as labelled 0/1', () => {
    const out = collect([HEALTHY]);
    expect(out).toMatch(/^reliability_controller_heartbeat_age_seconds 21$/m);
    expect(out).toMatch(/^reliability_controller_heartbeat_timestamp_seconds 1794250000$/m);
    expect(out).toMatch(/^reliability_controller_notifications_queued 2$/m);
    expect(out).toMatch(/^reliability_controller_notifications_failed_24h 1$/m);
    expect(out).toMatch(/^reliability_controller_intake_rejections_24h 3$/m);
    expect(out).toMatch(/^reliability_controller_mutation_paused 1$/m);
    expect(out).toMatch(/^reliability_controller_notify_mode\{mode="observe"\} 1$/m);
    expect(out).toMatch(/^reliability_controller_notify_mode\{mode="critical_only"\} 0$/m);
    expect(out).toMatch(/^reliability_controller_notify_mode\{mode="all"\} 0$/m);
    expect(out).toMatch(/^reliability_controller_collect_ok 1$/m);
    expect(out).toMatch(/^poker_money_undeclared_triggers 0$/m);
  });

  it('an unpaused controller in all mode reads 0 and all', () => {
    const out = collect([{ ...HEALTHY, mutation_paused: false, notify_mode: 'all' }]);
    expect(out).toMatch(/^reliability_controller_mutation_paused 0$/m);
    expect(out).toMatch(/^reliability_controller_notify_mode\{mode="all"\} 1$/m);
    expect(out).toMatch(/^reliability_controller_notify_mode\{mode="observe"\} 0$/m);
  });

  const unreadable: Array<[string, unknown, Record<string, string>]> = [
    ['the read fails', [HEALTHY], { RELIABILITY_FAILS: '1' }],
    [
      'the function does not exist',
      { code: 'PGRST202', message: 'Could not find the function' },
      {},
    ],
    [
      'the heartbeat has never ticked',
      [{ ...HEALTHY, heartbeat_at_unix: null, heartbeat_age_seconds: null }],
      {},
    ],
    ['a column is missing', [{ ...HEALTHY, intake_rejections_24h: undefined }], {}],
    ['the mode is not one the controller defines', [{ ...HEALTHY, notify_mode: 'loud' }], {}],
    ['mutation_paused is not a boolean', [{ ...HEALTHY, mutation_paused: null }], {}],
    ['no row comes back', [], {}],
  ];
  for (const [name, answer, extra] of unreadable) {
    it(`publishes no controller series when ${name}, and keeps the money gauges`, () => {
      const out = collect(answer, extra);
      expect(controllerSeries(out)).toEqual([]);
      expect(out).toMatch(/^reliability_controller_collect_ok 0$/m);
      expect(out).toMatch(/^poker_money_undeclared_triggers 0$/m);
      expect(out).toMatch(/^poker_health_collected_timestamp_seconds \d+$/m);
    });
  }

  it('reads exactly the columns the migration returns, from a service-only function', () => {
    const migration = readFileSync(
      join(
        ROOT,
        'supabase/migrations/20261110045731_reliability_controller_health_function_and_seed_corrections.sql'
      ),
      'utf8'
    );
    const returns =
      /FUNCTION public\.fn_reliability_controller_health\(\)\nRETURNS TABLE \(([^)]*)\)/.exec(
        migration
      );
    expect(returns).not.toBeNull();
    const columns = returns![1]
      .split(',')
      .map((c) => c.trim().split(/\s+/)[0])
      .sort();
    expect(columns).toEqual(Object.keys(HEALTHY).sort());
    const collector = readFileSync(SCRIPT, 'utf8');
    expect(collector).toContain('rest/v1/rpc/fn_reliability_controller_health');
    for (const column of columns) expect(collector, column).toContain(`"${column}"`);
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.fn_reliability_controller_health() FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_reliability_controller_health() TO service_role;'
    );
  });
});

describe('installed cash admission cohort', () => {
  it('preserves every bit of the installed policy fingerprint', () => {
    const out = collect([HEALTHY], {
      CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 4503599627370495 }]),
    });
    expect(out).toMatch(/^poker_lightning_admission_policy_fingerprint 4503599627370495$/m);
    expect(out).toMatch(/^poker_lightning_admission_policy_collect_ok 1$/m);
    expect(out).toMatch(/^poker_money_undeclared_triggers 0$/m);
    expect(out).toMatch(/^reliability_controller_collect_ok 1$/m);
  });
  it.each([
    null,
    [],
    [{ fingerprint: null }],
    [{ fingerprint: true }],
    [{ fingerprint: '123' }],
    [{ fingerprint: -1 }],
    [{ fingerprint: 4503599627370496 }],
    [{ fingerprint: 1.5 }],
    [{ fingerprint: 1 }, { fingerprint: 2 }],
  ])('unknown policy never becomes a zero cohort: %j', (answer) => {
    const out = collect([HEALTHY], { CASH_POLICY_ANSWER: JSON.stringify(answer) });
    expect(out).not.toMatch(/^poker_lightning_admission_policy_fingerprint /m);
    expect(out).toMatch(/^poker_lightning_admission_policy_collect_ok 0$/m);
    expect(out).toMatch(/^poker_money_undeclared_triggers 0$/m);
  });
  it('a refused policy read leaves all other observations intact', () => {
    const out = collect([HEALTHY], { CASH_POLICY_FAILS: '1' });
    expect(out).not.toMatch(/^poker_lightning_admission_policy_fingerprint /m);
    expect(out).toMatch(/^poker_lightning_admission_policy_collect_ok 0$/m);
    expect(out).toMatch(/^poker_money_undeclared_triggers 0$/m);
  });
});

it('cash admission identity is catalog-only, bounded and service-only', () => {
  const sql = readFileSync(
    join(
      ROOT,
      'supabase/migrations/20261112105743_lightning_throughput_baseline_names_the_installed_admission_.sql'
    ),
    'utf8'
  );
  expect(sql).toContain('RETURNS TABLE (fingerprint bigint)');
  expect(sql).toContain(
    "to_regprocedure('public.fn_lightning_horse_admit_paced(uuid,uuid,timestamp with time zone)')"
  );
  expect(sql).toContain('::bit(52)::bigint');
  expect(sql).toContain('SET search_path = pg_catalog');
  expect(sql).toContain("SET statement_timeout = '5s'");
  expect(sql).toContain(
    'REVOKE ALL ON FUNCTION public.fn_lightning_admission_policy() FROM PUBLIC, anon, authenticated;'
  );
  expect(sql).toContain(
    'GRANT EXECUTE ON FUNCTION public.fn_lightning_admission_policy() TO service_role;'
  );
  const body = sql.split('AS $function$')[1].split('$function$;')[0];
  expect(body).not.toMatch(/\b(insert|update|delete|alter|create|drop|call)\b/i);
});
