/**
 * LAW: Backup Engine certification fails closed on candidate lifecycle fatal
 * events and unintended between-hand delays during soak.
 * ============================================================================
 * Incident 075013fd (Wave 2 Hardening, Lane W5):
 *   1. `cmd_certify` in `server/standby/standby-engine.sh` ALWAYS calls
 *      `check_engine_lifecycle_logs` across the candidate's boot/soak window
 *      (when `public.engine_lifecycle_logs` exists on the Backup DB), prints
 *      the exact error and stack from the table to stderr, and fails closed
 *      on any `fatal_error`, `shutdown_failed`, `shutdown_deadline`,
 *      unexpected `leadership_shutdown`, or `level = 'fatal'` row, as well as
 *      on any unreadable DB/JSON response.
 *   2. After the steady-state soak, `cmd_certify` calls
 *      `check_soak_hand_gap_delay` using `fn_ca_hand_gap_unintended_delay`
 *      (when installed on the Backup DB) and fails closed if any graded shape
 *      with >= 5 graded hands exceeds `budget_ms` (250 ms) at p95, or if the
 *      check is unreadable.
 *   3. Both structured summaries (`lifecycleLogCheck`, `handGapCheck`) are
 *      recorded in `certificate.json`, and `backup-engine.yml` installs
 *      `server/standby/standby-engine.sh` on every certification run.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const STANDBY_PATH = join(ROOT, 'server/standby/standby-engine.sh');
const standby = readFileSync(STANDBY_PATH, 'utf8');
const workflow = readFileSync(join(ROOT, '.github/workflows/backup-engine.yml'), 'utf8');

const VALID_SHA = 'a'.repeat(40);
const VALID_SINCE = '1763600000';

function runStandbyFn(call: string, mockPsqlOutput: string, mockPsqlExit = 0) {
  const script = `
set -Eeuo pipefail
source ${JSON.stringify(STANDBY_PATH)}
psql_db() {
  cat >/dev/null || true
  printf '%s' ${JSON.stringify(mockPsqlOutput)}
  return ${mockPsqlExit}
}
${call}
`;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

describe('Backup certification wires lifecycle log and hand-gap gates', () => {
  const certify = standby.slice(standby.indexOf('cmd_certify() {'));

  it('installs server/standby/standby-engine.sh on every certification run', () => {
    expect(workflow).toMatch(
      /server\/standby\/standby-engine\.sh > \/usr\/local\/sbin\/standby-engine/
    );
  });

  it('always checks engine_lifecycle_logs in cmd_certify and fails closed', () => {
    const fatalScan = certify.indexOf('fatals=$(count_fatal_logs "$started" "$sha")');
    const lifecycleCall = certify.indexOf(
      'lifecycle_check=$(check_engine_lifecycle_logs "$started" "$sha")'
    );
    expect(fatalScan).toBeGreaterThan(0);
    expect(lifecycleCall).toBeGreaterThan(fatalScan);
    expect(certify).toContain('record "lifecycle_fatal_events:$lc_count"');
    expect(certify).toContain("record 'lifecycle_logs_unreadable'");
    expect(certify).toContain('"lifecycleLogCheck": json.loads(sys.argv[6])');
  });

  it('checks fn_ca_hand_gap_unintended_delay after soak and fails closed', () => {
    const soakStart = certify.indexOf('soak_started=$(date +%s)');
    const handGapCall = certify.indexOf(
      'hand_gap_check=$(check_soak_hand_gap_delay "$soak_started" "$soak_window_min")'
    );
    expect(soakStart).toBeGreaterThan(0);
    expect(handGapCall).toBeGreaterThan(soakStart);
    expect(certify).toContain("record 'hand_gap_unintended_delay_exceeded'");
    expect(certify).toContain("record 'hand_gap_check_unreadable'");
    expect(certify).toContain('"handGapCheck": json.loads(sys.argv[7])');
  });

  it('SQL checks guard table/function existence and pass psql variables via set_config outside DO blocks', () => {
    const lcSql = standby.slice(
      standby.indexOf("<<'SQL_LIFECYCLE_LOGS'"),
      standby.indexOf('SQL_LIFECYCLE_LOGS\n  )')
    );
    const hgSql = standby.slice(
      standby.indexOf("<<'SQL_HAND_GAP'"),
      standby.indexOf('SQL_HAND_GAP\n  )')
    );

    expect(lcSql).toContain("to_regclass('public.engine_lifecycle_logs') IS NULL");
    for (const ev of ['fatal_error', 'shutdown_failed', 'shutdown_deadline', 'leadership_shutdown']) {
      expect(lcSql).toContain(`'${ev}'`);
    }
    expect(lcSql).toContain("level = 'fatal'");
    const lcDo = lcSql.slice(lcSql.indexOf('DO $chk$'), lcSql.indexOf('$chk$;'));
    expect(lcDo).not.toContain(":'");

    expect(hgSql).toContain(
      "to_regprocedure('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)') IS NULL"
    );
    expect(hgSql).toContain('COALESCE(budget_ms, 250)');
    expect(hgSql).toContain('graded IS TRUE');
    expect(hgSql).toContain('hands >= 5');
    expect(hgSql).toContain('unintended_p95_ms > budget_ms');
    const hgDo = hgSql.slice(hgSql.indexOf('DO $gap$'), hgSql.indexOf('$gap$;'));
    expect(hgDo).not.toContain(":'");
  });
});

describe('check_engine_lifecycle_logs runtime behavior', () => {
  it('passes when the table is not yet installed (not_armed)', () => {
    const res = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      JSON.stringify({ status: 'not_armed', count: 0, rows: [] })
    );
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ status: 'not_armed', count: 0 });
  });

  it('passes when zero fatal/shutdown rows were recorded', () => {
    const res = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      JSON.stringify({ status: 'pass', count: 0, rows: [] })
    );
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ status: 'pass', count: 0 });
  });

  it('fails and prints exact error and stack when fatal_error is recorded', () => {
    const payload = {
      status: 'fail',
      count: 1,
      rows: [
        {
          id: 42,
          createdAt: '2026-11-20T20:00:00Z',
          instanceId: '1-abcd1234',
          releaseSha: VALID_SHA,
          level: 'fatal',
          event: 'fatal_error',
          message: 'Cannot read properties of undefined',
          kind: 'GameServer.Uncaught_exception',
          errorName: 'TypeError',
          errorMessage: 'Cannot read properties of undefined',
          stack: 'TypeError: Cannot read properties of undefined\n    at boot (index.ts:10:5)',
        },
      ],
    };
    const res = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      JSON.stringify(payload)
    );
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({ status: 'fail', count: 1 });
    expect(res.stderr).toContain('event=fatal_error');
    expect(res.stderr).toContain('TypeError: Cannot read properties of undefined');
    expect(res.stderr).toContain('at boot (index.ts:10:5)');
  });

  it('fails on unexpected leadership_shutdown row', () => {
    const payload = {
      status: 'fail',
      count: 1,
      rows: [
        {
          id: 43,
          createdAt: '2026-11-20T20:01:00Z',
          instanceId: '1-abcd1234',
          releaseSha: VALID_SHA,
          level: 'warn',
          event: 'leadership_shutdown',
          message: 'lease expired during soak',
          kind: null,
          errorName: null,
          errorMessage: null,
          stack: null,
        },
      ],
    };
    const res = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      JSON.stringify(payload)
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('event=leadership_shutdown');
    expect(res.stderr).toContain('lease expired during soak');
  });

  it('fails closed (exit 2) when psql_db fails or output is unreadable', () => {
    const dbErr = runStandbyFn(`check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`, '', 1);
    expect(dbErr.status).toBe(2);

    const badJson = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      'not-json'
    );
    expect(badJson.status).toBe(2);

    const badSha = runStandbyFn(`check_engine_lifecycle_logs ${VALID_SINCE} notasha`, '{}');
    expect(badSha.status).toBe(2);
  });
});

describe('check_soak_hand_gap_delay runtime behavior', () => {
  it('passes when fn_ca_hand_gap_unintended_delay is not installed (not_armed)', () => {
    const res = runStandbyFn(
      `check_soak_hand_gap_delay ${VALID_SINCE} 15`,
      JSON.stringify({
        status: 'not_armed',
        windowMinutes: 15,
        handsInSoak: 0,
        breaches: [],
        shapes: [],
      })
    );
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout).status).toBe('not_armed');
  });

  it('passes when no graded shape breaches unintended_p95_ms > budget_ms', () => {
    const res = runStandbyFn(
      `check_soak_hand_gap_delay ${VALID_SINCE} 15`,
      JSON.stringify({
        status: 'pass',
        windowMinutes: 15,
        handsInSoak: 42,
        breaches: [],
        shapes: [
          {
            kind: 'cash',
            shape: 'fold',
            graded: true,
            hands: 30,
            unintended_p50_ms: 40,
            unintended_p95_ms: 120,
            unintended_p99_ms: 180,
            over_budget: 0,
            budget_ms: 250,
          },
        ],
      })
    );
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: 'pass',
      handsInSoak: 42,
      breachCount: 0,
    });
  });

  it('fails and prints offending shapes when a graded shape breaches p95 > 250ms with >= 5 hands', () => {
    const res = runStandbyFn(
      `check_soak_hand_gap_delay ${VALID_SINCE} 15`,
      JSON.stringify({
        status: 'fail',
        windowMinutes: 15,
        handsInSoak: 50,
        breaches: [
          {
            kind: 'cash',
            shape: 'fold',
            graded: true,
            hands: 12,
            unintended_p50_ms: 180,
            unintended_p95_ms: 620,
            unintended_p99_ms: 810,
            over_budget: 4,
            budget_ms: 250,
          },
        ],
        shapes: [],
      })
    );
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toMatchObject({ status: 'fail', breachCount: 1 });
    expect(res.stderr).toContain('kind=cash shape=fold hands=12');
    expect(res.stderr).toContain('unintended_p95_ms=620');
    expect(res.stderr).toContain('budget_ms=250');
  });

  it('fails closed (exit 2) when psql_db fails or output is unreadable', () => {
    const dbErr = runStandbyFn(`check_soak_hand_gap_delay ${VALID_SINCE} 15`, '', 1);
    expect(dbErr.status).toBe(2);

    const badJson = runStandbyFn(`check_soak_hand_gap_delay ${VALID_SINCE} 15`, 'corrupt');
    expect(badJson.status).toBe(2);
  });
});
