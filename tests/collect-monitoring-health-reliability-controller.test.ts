import { createHash } from 'node:crypto';
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
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

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
  *127.0.0.1:8080/health*)
    if [ -n "\${CASH_POPULATION_FILE:-}" ]; then cat "$CASH_POPULATION_FILE"; exit; fi
    printf '%s' "$CASH_POPULATION_ANSWER" ;;
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
      CASH_POPULATION_ANSWER: JSON.stringify({
        horseWorkSchedule: { cashAdmissionContract: 'cash-population/v1', policyFingerprint: 1 },
      }),
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
  it('binds the full SQL identity and the engine population policy', () => {
    const out = collect([HEALTHY], {
      CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 4503599627370495 }]),
    });
    const combined = Number.parseInt(
      createHash('sha256').update('4503599627370495:1').digest('hex').slice(0, 13),
      16
    );
    expect(out).toContain(`poker_lightning_admission_policy_fingerprint ${combined}\n`);
    expect(out).toMatch(/^poker_lightning_admission_policy_collect_ok 1$/m);
    expect(out).toMatch(/^poker_money_undeclared_triggers 0$/m);
    expect(out).toMatch(/^reliability_controller_collect_ok 1$/m);
  });
  it('streams a health response larger than the OS argument limit', () => {
    const healthFile = join(dir, 'large-health.json');
    writeFileSync(
      healthFile,
      JSON.stringify({
        horseWorkSchedule: { cashAdmissionContract: 'cash-population/v1', policyFingerprint: 1 },
        unrelatedDiagnostics: 'x'.repeat(3 * 1024 * 1024),
      })
    );
    const out = collect([HEALTHY], {
      CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]),
      CASH_POPULATION_FILE: healthFile,
    });
    expect(out).toMatch(/^poker_lightning_admission_policy_collect_ok 1$/m);
    expect(out).toMatch(/^poker_lightning_admission_policy_fingerprint \d+$/m);
  });

  it('recognizes the exact pre-fingerprint serving release as a separate cohort', () => {
    const out = collect([HEALTHY], {
      CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]),
      CASH_POPULATION_ANSWER: JSON.stringify({
        releaseSha: '3529e86663daa427b380a8ab9bd09347270c670e',
        horseWorkSchedule: { lastCycle: { supply: [] } },
      }),
    });
    const combined = Number.parseInt(
      createHash('sha256')
        .update('10:legacy-release:3529e86663daa427b380a8ab9bd09347270c670e')
        .digest('hex')
        .slice(0, 13),
      16
    );
    expect(out).toContain(`poker_lightning_admission_policy_fingerprint ${combined}\n`);
    expect(out).toMatch(/^poker_lightning_admission_policy_collect_ok 1$/m);
  });

  it.each([
    { releaseSha: 'a'.repeat(40), horseWorkSchedule: {} },
    { releaseSha: '3529e866', horseWorkSchedule: {} },
    { releaseSha: '3529e86663daa427b380a8ab9bd09347270c670e' },
    {
      releaseSha: '3529e86663daa427b380a8ab9bd09347270c670e',
      horseWorkSchedule: { cashAdmissionContract: 'cash-population/v1', policyFingerprint: null },
    },
  ])('does not substitute a legacy identity for unknown or corrupt policy: %j', (body) => {
    const out = collect([HEALTHY], {
      CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]),
      CASH_POPULATION_ANSWER: JSON.stringify(body),
    });
    expect(out).not.toMatch(/^poker_lightning_admission_policy_fingerprint /m);
    expect(out).toMatch(/^poker_lightning_admission_policy_collect_ok 0$/m);
  });

  const legacyPolicy = JSON.parse(
    readFileSync(join(ROOT, 'tests/fixtures/cash-policy/legacy-v1.json'), 'utf8')
  );
  const cohortOf = (out: string) =>
    out.match(/^poker_lightning_admission_policy_fingerprint (\d+)$/m)?.[1];

  it('keeps the population fingerprint wire format stable for a fixed complete policy', () => {
    // Recorded from the real immutable predecessor's functions, all 1,440
    // minutes and the full variant/stake matrix. Future policy changes can
    // change those inputs without changing the wire identity of these inputs.
    const emitted = ts.transpileModule(
      readFileSync(join(ROOT, 'server/src/services/HorseCashPopulationPolicy.ts'), 'utf8'),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }
    ).outputText;
    const fingerprintFor = (policy: typeof legacyPolicy) => {
      const exports: Record<string, unknown> = {};
      const blinds = [0.1, 0.5, 1, 2, 5, 10];
      const inputs = {
        './StableHand.js': {
          occupancyTargetForHost: (_n: number, hour: number, minute: number) => {
            const [target, min, max] = policy.curve[hour * 60 + minute];
            return { target, min, max };
          },
          hostSeatCeiling: (_max: number, hour: number, minute: number) =>
            policy.curve[hour * 60 + minute][3],
        },
        './HorseCashSchedule.js': {
          cashActivityScaleAt: () => policy.scale,
          horseCashGameAllowed: (table: { game_variant: string; big_blind: number }) => {
            const row = policy.admission.find((r: unknown[]) => r[0] === table.game_variant);
            const stake = blinds.indexOf(table.big_blind);
            if (!row || stake < 0) throw new Error('Unversioned admission input');
            return row[stake + 1];
          },
        },
        'node:crypto': { createHash },
      };
      runInNewContext(emitted, {
        exports,
        require: (name: keyof typeof inputs) => {
          if (!(name in inputs)) throw new Error('Unexpected dependency ' + name);
          return inputs[name];
        },
      });
      const calculate = exports.horseCashPopulationPolicyFingerprint as (at: number) => number;
      return calculate(Date.parse('2026-11-16T12:00Z'));
    };
    expect(fingerprintFor(legacyPolicy)).toBe(legacyPolicy.fingerprint);
    const changedCurve = structuredClone(legacyPolicy);
    changedCurve.curve[600][3] += 1;
    expect(fingerprintFor(changedCurve)).not.toBe(legacyPolicy.fingerprint);
    const changedAdmission = structuredClone(legacyPolicy);
    changedAdmission.admission[0][1] = !changedAdmission.admission[0][1];
    expect(fingerprintFor(changedAdmission)).not.toBe(legacyPolicy.fingerprint);
  });

  it('keeps the accumulating cohort across legacy-to-modern publication, routine builds and rollback', () => {
    const sql = { CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]) };
    const predecessor = collect([HEALTHY], {
      ...sql,
      CASH_POPULATION_ANSWER: JSON.stringify({
        releaseSha: legacyPolicy.sourceRevision,
        horseWorkSchedule: {},
      }),
    });
    for (const releaseSha of ['a'.repeat(40), 'b'.repeat(40)]) {
      const modern = collect([HEALTHY], {
        ...sql,
        CASH_POPULATION_ANSWER: JSON.stringify({
          releaseSha,
          version: releaseSha.slice(0, 8),
          uptime: 1,
          horseWorkSchedule: {
            cashAdmissionContract: 'cash-population/v1',
            policyFingerprint: legacyPolicy.fingerprint,
          },
          unrelatedStrategyVersion: releaseSha,
        }),
      });
      expect(cohortOf(modern)).toBe(cohortOf(predecessor));
      expect(cohortOf(modern)).toBeDefined();
    }
  });

  it.each([1, 4503599627370495])('modern build metadata never changes policy %s', (fingerprint) => {
    const cohorts = ['a'.repeat(40), 'b'.repeat(40)].map((releaseSha, i) =>
      cohortOf(
        collect([HEALTHY], {
          CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]),
          CASH_POPULATION_ANSWER: JSON.stringify({
            releaseSha,
            version: releaseSha.slice(0, 8),
            uptime: 1 + i * 10000,
            horseWorkSchedule: {
              cashAdmissionContract: 'cash-population/v1',
              policyFingerprint: fingerprint,
            },
            unrelatedStrategyVersion: i,
          }),
        })
      )
    );
    expect(cohorts[0]).toBeDefined();
    expect(cohorts[1]).toBe(cohorts[0]);
  });

  it('still separates real SQL and population policy changes from the compatible cohort', () => {
    const body = JSON.stringify({
      horseWorkSchedule: {
        cashAdmissionContract: 'cash-population/v1',
        policyFingerprint: legacyPolicy.fingerprint,
      },
    });
    const original = collect([HEALTHY], {
      CASH_POPULATION_ANSWER: body,
      CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]),
    });
    const changedSql = collect([HEALTHY], {
      CASH_POPULATION_ANSWER: body,
      CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 11 }]),
    });
    const changedPopulation = collect([HEALTHY], {
      CASH_POPULATION_ANSWER: JSON.stringify({
        horseWorkSchedule: {
          cashAdmissionContract: 'cash-population/v1',
          policyFingerprint: legacyPolicy.fingerprint + 1,
        },
      }),
      CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]),
    });
    expect(cohortOf(original)).toBeDefined();
    expect(cohortOf(changedSql)).not.toBe(cohortOf(original));
    expect(cohortOf(changedPopulation)).not.toBe(cohortOf(original));
  });

  it('a changed engine curve is a different cohort even when SQL pacing is unchanged', () => {
    const extra = { CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]) };
    const first = collect([HEALTHY], extra);
    const next = collect([HEALTHY], {
      ...extra,
      CASH_POPULATION_ANSWER: JSON.stringify({
        horseWorkSchedule: { cashAdmissionContract: 'cash-population/v1', policyFingerprint: 2 },
      }),
    });
    const cohort = (out: string) =>
      out.match(/^poker_lightning_admission_policy_fingerprint (\d+)$/m)?.[1];
    expect(cohort(first)).toBeDefined();
    expect(cohort(next)).not.toEqual(cohort(first));
  });
  it.each([
    {},
    { horseWorkSchedule: {} },
    { horseWorkSchedule: { cashAdmissionContract: 'cash-population/v1', policyFingerprint: '2' } },
  ])(
    'an older or unreadable engine policy never reuses historical SQL-only cohorts: %j',
    (body) => {
      const out = collect([HEALTHY], {
        CASH_POLICY_ANSWER: JSON.stringify([{ fingerprint: 10 }]),
        CASH_POPULATION_ANSWER: JSON.stringify(body),
      });
      expect(out).not.toMatch(/^poker_lightning_admission_policy_fingerprint /m);
      expect(out).toMatch(/^poker_lightning_admission_policy_collect_ok 0$/m);
      expect(out).toMatch(/^poker_money_undeclared_triggers 0$/m);
    }
  );
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

describe('hourly cash admission adoption is a separate throughput cohort', () => {
  const legacyPolicy = JSON.parse(
    readFileSync(join(ROOT, 'tests/fixtures/cash-policy/legacy-v1.json'), 'utf8')
  );
  const sql = { fingerprint: 10, hourly_contract: 'cash-hourly-tables/v1', hourly_fingerprint: 20 };
  const health = (contract: unknown = 'cash-hourly-tables/v1') => ({
    releaseSha: 'a'.repeat(40),
    horseWorkSchedule: {
      policyFingerprint: legacyPolicy.fingerprint,
      cashAdmissionContract: contract,
    },
  });
  const read = (body: unknown, policy: unknown = sql) =>
    collect([HEALTHY], {
      CASH_POPULATION_ANSWER: JSON.stringify(body),
      CASH_POLICY_ANSWER: JSON.stringify([policy]),
    });
  const cohort = (out: string) =>
    out.match(/^poker_lightning_admission_policy_fingerprint (\d+)$/m)?.[1];
  it('distinguishes engine adoption even before the first close enables SQL caps, and restores rollback', () => {
    const oldHealth = { releaseSha: legacyPolicy.sourceRevision, horseWorkSchedule: {} };
    const before = cohort(read(oldHealth, { fingerprint: 10 }));
    expect(before).toBeDefined();
    expect(cohort(read(oldHealth))).toBe(before); // migration-first, predecessor still serving
    const adopted = cohort(read(health()));
    expect(adopted).toBeDefined();
    expect(adopted).not.toBe(before); // same population curve and arrival definition
    expect(cohort(read(oldHealth))).toBe(before); // rollback still has new SQL installed
    expect(cohort(read({ ...health(), instanceId: 'different', uptime: 0 }))).toBe(adopted);
    expect(cohort(read(health(), { ...sql, hourly_fingerprint: 21 }))).not.toBe(adopted);
  });
  it.each([
    { fingerprint: 10 },
    { ...sql, hourly_fingerprint: null },
    { ...sql, hourly_fingerprint: '20' },
    { ...sql, hourly_fingerprint: true },
    { ...sql, hourly_fingerprint: -1 },
    { ...sql, hourly_contract: 'unknown' },
  ])('partial or unknown SQL adoption never uses the legacy key: %j', (policy) => {
    expect(cohort(read(health(), policy))).toBeUndefined();
  });
  it.each([undefined, null, '', 'cash-hourly-tables/v2'])(
    'missing/unknown engine contract is not legacy: %j',
    (contract) => {
      const body = health(null);
      body.horseWorkSchedule.cashAdmissionContract = contract;
      expect(cohort(read(body))).toBeUndefined();
    }
  );
});
