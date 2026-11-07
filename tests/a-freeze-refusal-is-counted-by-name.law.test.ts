/**
 * A FREEZE REFUSAL IS COUNTED BY NAME (Dan 2026-11-07).
 *
 * The owner's NLH and PLO Lightning joins were refused eleven times at 19:20
 * UTC by an off-hours engine cutover. His browser reported them, but as P0001
 * (the code every plpgsql RAISE shares), so no gauge and no alarm could count
 * real players refused by a freeze. This law holds the three links: the
 * client files the refusal as PLATFORM_FROZEN, the database counts it on its
 * own columns (horses and automated sessions excluded), and the collector
 * renders it for the info alert PlayersRefusedDuringFreeze without ever
 * risking the original three client gauges.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pickCode } from '../src/utils/errorReporter';

const ROOT = resolve(__dirname, '..');
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/20261107210000_a_freeze_refusal_is_counted_by_name.sql'),
  'utf8'
);
const RULES = readFileSync(join(ROOT, 'infra/monitoring/alert-rules.yml'), 'utf8');
const SCRIPT = join(ROOT, 'server/scripts/collect-monitoring-health.sh');

describe('the client files a freeze refusal by name', () => {
  it('the Lightning rejoin door refusal (P0001 PLATFORM_FROZEN) is PLATFORM_FROZEN', () => {
    expect(pickCode({ code: 'P0001', message: 'PLATFORM_FROZEN' }, undefined)).toBe(
      'PLATFORM_FROZEN'
    );
  });
  it('the freeze guard refusal (55006) is PLATFORM_FROZEN', () => {
    expect(pickCode({ code: '55006', message: 'PLATFORM_FROZEN: refused' }, undefined)).toBe(
      'PLATFORM_FROZEN'
    );
  });
  it('every other error keeps its own code', () => {
    expect(pickCode({ code: 'P0001', message: 'GAME_CLOSED' }, undefined)).toBe('P0001');
    expect(pickCode({ code: '23514' }, { code: 'SEAT_TAKEN' })).toBe('SEAT_TAKEN');
  });
});

describe('the database counts it on its own columns', () => {
  it('adds the two freeze columns after the original three, unchanged', () => {
    expect(MIGRATION).toMatch(
      /client_errors_10m\s+integer,\s+client_error_users_10m\s+integer,\s+client_error_top_code_users_10m integer,\s+client_error_top_code\s+text,\s+freeze_refusals_10m\s+integer,\s+freeze_refusal_users_10m\s+integer/
    );
  });
  it('recognises all three shapes of the refusal and excludes horses and automation', () => {
    expect(MIGRATION).toContain("e.code IN ('PLATFORM_FROZEN', '55006')");
    expect(MIGRATION).toContain(
      "e.code = 'P0001' AND coalesce(e.message, '') LIKE 'PLATFORM\\_FROZEN%'"
    );
    expect(MIGRATION).toContain('AND NOT e.automated');
    expect(MIGRATION).toContain('p.id = r.user_id AND p.is_horse');
  });
  it('keeps the function service-only', () => {
    expect(MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.fn_client_error_health() FROM PUBLIC, anon, authenticated;'
    );
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_client_error_health() TO service_role;'
    );
  });
});

describe('the alarm reads it as a record, not a page', () => {
  it('PlayersRefusedDuringFreeze is info severity on the freeze user gauge', () => {
    // The one rule, bounded by its own structure: from its `- alert:` line to
    // the next rule or group, whichever comes first.
    const start = RULES.indexOf('- alert: PlayersRefusedDuringFreeze');
    expect(start).toBeGreaterThan(-1);
    const rest = RULES.slice(start + 1);
    const ends = ['\n      - alert:', '\n  - name:', '\n  # ═']
      .map((marker) => rest.indexOf(marker))
      .filter((at) => at >= 0);
    const rule = RULES.slice(start, start + 1 + Math.min(...ends));
    expect(rule).toMatch(/expr: poker_client_freeze_refusal_users_10m >= 1/);
    expect(rule).toMatch(/severity: info/);
    expect(rule).not.toMatch(/severity: (warning|critical)|page:/);
  });
});

const dir = mkdtempSync(join(tmpdir(), 'freeze-refusal-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
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
const BASE = {
  client_errors_10m: 20,
  client_error_users_10m: 2,
  client_error_top_code_users_10m: 1,
  client_error_top_code: 'ERROR',
};
const bin = join(dir, 'bin');
execFileSync('mkdir', ['-p', bin]);
writeFileSync(
  join(bin, 'curl'),
  `#!/usr/bin/env bash
case "$*" in
  *fn_monitoring_health_snapshot*) printf '%s' '${MONEY}' ;;
  *fn_client_error_health*) cat "$CLIENT_FILE" ;;
  *) exit 7 ;;
esac
`
);
chmodSync(join(bin, 'curl'), 0o755);

function collect(client: Record<string, unknown>): string {
  const clientFile = join(dir, `client-${Object.keys(client).length}.json`);
  writeFileSync(clientFile, JSON.stringify([client]));
  return execFileSync('bash', [SCRIPT], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      ENGINE_ENV_FILE: envFile,
      DRY_RUN: '1',
      CLIENT_FILE: clientFile,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('the collector renders it without risking the original gauges', () => {
  it("renders today's 19:21 UTC window: 12 refusals from 2 real players", () => {
    const out = collect({ ...BASE, freeze_refusals_10m: 12, freeze_refusal_users_10m: 2 });
    expect(out).toMatch(/^poker_client_freeze_refusals_10m 12$/m);
    expect(out).toMatch(/^poker_client_freeze_refusal_users_10m 2$/m);
    expect(out).toMatch(/^poker_client_error_top_code_users_10m 1$/m);
    expect(out).toMatch(/^poker_client_error_collect_ok 1$/m);
  });
  it('a database before the migration still renders the original three gauges', () => {
    const out = collect(BASE);
    expect(out).toMatch(/^poker_client_errors_10m 20$/m);
    expect(out).toMatch(/^poker_client_error_top_code_users_10m 1$/m);
    expect(out).not.toMatch(/^poker_client_freeze_refusal/m);
    expect(out).toMatch(/^poker_client_error_collect_ok 1$/m);
  });
});
