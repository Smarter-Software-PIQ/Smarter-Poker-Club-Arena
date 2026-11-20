/**
 * LAW: the admission policy is judged on its own (incident 3aabeee7,
 * 2026-11-19 23:02-23:17 CST). The money snapshot timed out under database
 * load, the collector died before writing anything, and the policy's
 * freshness was the snapshot's timestamp, so HorseFleetThroughputPolicyUnknown
 * paged "policy cannot be read" while the catalog-only policy RPC answered.
 * Runs the real collector with a stand-in curl whose snapshot times out.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCRIPT = join(ROOT, 'server/scripts/collect-monitoring-health.sh');
const RULES = readFileSync(join(ROOT, 'infra/monitoring/alert-rules.yml'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'policy-own-'));
const envFile = join(dir, 'engine.env');
writeFileSync(envFile, 'SUPABASE_URL=https://db.invalid\nSUPABASE_SERVICE_ROLE_KEY=test-key\n');
const bin = join(dir, 'bin');
mkdirSync(bin, { recursive: true });
writeFileSync(
  join(bin, 'curl'),
  `#!/usr/bin/env bash
case "$*" in
  *127.0.0.1:8080/health*) printf '%s' '{"horseWorkSchedule":{"cashAdmissionContract":"cash-population/v1","policyFingerprint":1}}' ;;
  *fn_monitoring_health_snapshot*) echo 'PostgREST error: canceling statement due to statement timeout' >&2; exit 28 ;;
  *fn_lightning_admission_policy*) printf '%s' '[{"fingerprint":10}]' ;;
  *) exit 7 ;;
esac
`
);
chmodSync(join(bin, 'curl'), 0o755);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the admission policy is judged on its own', () => {
  it('a timed-out money snapshot still leaves a fresh, readable policy file', () => {
    const textfiles = join(dir, 'textfile');
    const before = Math.floor(Date.now() / 1000);
    const run = spawnSync('bash', [SCRIPT], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        ENGINE_ENV_FILE: envFile,
        TEXTFILE_DIR: textfiles,
      },
      encoding: 'utf8',
    });
    // The snapshot's failure is still a failure: fail closed, money file untouched.
    expect(run.status).not.toBe(0);
    expect(existsSync(join(textfiles, 'club_arena_money_health.prom'))).toBe(false);
    // The policy was read and published anyway, with its own timestamp.
    const policy = readFileSync(join(textfiles, 'club_arena_admission_policy.prom'), 'utf8');
    expect(policy).toMatch(/^poker_lightning_admission_policy_collect_ok 1$/m);
    expect(policy).toMatch(/^poker_lightning_admission_policy_fingerprint \d+$/m);
    const ts = Number(
      /^poker_lightning_admission_policy_collected_timestamp_seconds (\d+)$/m.exec(policy)?.[1]
    );
    expect(ts).toBeGreaterThanOrEqual(before);
  });

  it('readability is judged by the policy timestamp, never the money snapshot timestamp', () => {
    const rule =
      /- record: sp:lightning_admission_policy:readable\n\s+expr: \|\n([\s\S]*?)\n\n/.exec(
        RULES
      )?.[1] ?? '';
    expect(rule).toContain('poker_lightning_admission_policy_collected_timestamp_seconds');
    expect(rule).not.toContain('poker_health_collected_timestamp_seconds');
  });

  it('the policy series are published in exactly one textfile', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const policyAt = src.indexOf('fn_lightning_admission_policy"');
    const snapshotAt = src.indexOf('fn_monitoring_health_snapshot"');
    expect(policyAt).toBeGreaterThan(0);
    expect(policyAt).toBeLessThan(snapshotAt);
    expect(src).not.toMatch(/RENDERED="\$RENDERED\n\$CASH_POLICY_RENDERED"/);
  });
});
