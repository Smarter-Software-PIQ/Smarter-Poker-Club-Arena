/**
 * DR posture stays wired (2026-09-01, audit phase 4).
 *
 * The disaster-recovery story is only real while its pieces exist and point
 * at each other. This does not touch any secret or any live system; it pins
 * that the runbook and the secret-backup script are present, name the one
 * component that lives on a single disk, and never leak a value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyChangedPaths } from '../scripts/ci/classify-ci-changes.mjs';

const root = (p: string) => resolve(__dirname, '..', p);
const RUNBOOK = 'docs/dr/RESTORE-RUNBOOK.md';
const BACKUP = 'scripts/dr/backup-engine-secrets.sh';

describe('disaster recovery is documented and wired', () => {
  it('the restore runbook exists and covers the three loss scenarios', () => {
    expect(existsSync(root(RUNBOOK))).toBe(true);
    const t = readFileSync(root(RUNBOOK), 'utf8');
    expect(t).toMatch(/engine box is gone/i);
    expect(t).toMatch(/database corruption/i);
    expect(t).toMatch(/the mac is gone/i);
    // Configuration is verifiable through the provider; a restore needs isolation.
    expect(t).toMatch(/PITR/);
    expect(t).toContain('GET /v1/projects/{ref}/database/backups');
    expect(t).toContain('Disabling these after startup is not isolation.');
    expect(t).toContain('Not a restore drill.');
    expect(t).not.toMatch(/agent cannot (?:check|toggle)|human action/i);
  });

  it('the engine-secret backup is explicit, pinned and never reads local env authority', () => {
    expect(existsSync(root(BACKUP))).toBe(true);
    const s = readFileSync(root(BACKUP), 'utf8');
    expect(s).toContain('openssl enc -aes-256-cbc');
    expect(s).toContain('.dr-backups');
    expect(s).toContain('security find-generic-password');
    expect(s).toContain('--authorized-offline-backup');
    expect(s).toContain('DR_ENGINE_SSH_KEY_FILE');
    expect(s).toContain('DR_ENGINE_HOST_KEY');
    expect(s).toContain('StrictHostKeyChecking=yes');
    expect(s).toContain('UserKnownHostsFile="$DR_TMP_DIR/known_hosts"');
    expect(s).toContain('GlobalKnownHostsFile=/dev/null');
    expect(s).toContain('IdentitiesOnly=yes');
    expect(s).not.toContain('StrictHostKeyChecking=accept-new');
    expect(s).not.toMatch(/source\s+.*\.env|hetzner_engine_key|ENGINE_HOST:-engine/);
  });

  it('.dr-backups is gitignored so an encrypted secret can never be committed', () => {
    const gi = readFileSync(root('.gitignore'), 'utf8');
    expect(gi).toMatch(/^\.dr-backups\/?$/m);
  });

  it('the runbook names the single-copy component explicitly', () => {
    const t = readFileSync(root(RUNBOOK), 'utf8');
    expect(t).toMatch(/server\/\.env/);
    expect(t).toMatch(/only one disk|single copy|Hetzner disk only/i);
  });

  it('native recovery qualification runs in the existing required accounting jobs', () => {
    for (const path of [
      'scripts/dr/native-supabase-export.py',
      'scripts/dr/build-native-export-client.py',
      'scripts/ci/test_native_supabase_export.py',
      'scripts/ci/test_launch_reporting_prearchive.py',
      'scripts/ci/fixtures/launch-reset/derived-prearchive/source-pins.json',
      'scripts/verification-harness/leaderboard-native-function-batch.mjs',
    ]) {
      expect(classifyChangedPaths([path]).server).toBe(true);
    }
    const workflow = readFileSync(root('.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toContain(
      'python3 -B -m unittest discover -s scripts/ci -p test_native_supabase_export.py'
    );
    expect(workflow).toContain('python3 -B scripts/dr/build-native-export-client.py');
    expect(workflow).toContain('pkg-config libssl-dev libzstd-dev');
    const guide = readFileSync(root('docs/dr/NATIVE-LOGICAL-EXPORT.md'), 'utf8');
    expect(guide).toContain('restore_qualified: false');
    expect(guide).toContain('pre-execution external-effect containment');
    const builder = readFileSync(root('scripts/dr/build-native-export-client.py'), 'utf8');
    expect(builder).toContain("'production_restore_qualified': False");
    expect(builder).toContain('actual-restore-qualification');
  });
});

// Exercise the actual standby shell functions with bounded command doubles.
// Hosted backup qualification separately proves the real Docker/Postgres path.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const STANDBY = 'server/standby/standby-engine.sh';
function standbyShell(body: string, files: Record<string, unknown> = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'standby-regression-'));
  mkdirSync(resolve(dir, 'logs'));
  writeFileSync(resolve(dir, 'schema.dump'), 'fixture');
  for (const [name, value] of Object.entries(files))
    writeFileSync(resolve(dir, name), JSON.stringify(value));
  try {
    return spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; STATE_DIR="$2"; LOG_DIR="$2/logs"; ' + body,
        'regression',
        root(STANDBY),
        dir,
      ],
      { encoding: 'utf8', timeout: 15000 }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const validCopy = {
  'database.json': { restoredAt: '2026-11-06T17:00:00Z', restoreErrors: 0, restoreValidated: true },
  'seed.json': { seededAt: '2026-11-06T17:01:00Z', tablesFailed: 0 },
};

describe('the Backup Engine refuses partial restores and proves automatic recovery', () => {
  it('runs qualification admission regressions in the existing required DR suite', () => {
    const result = spawnSync(
      'python3',
      [
        '-B',
        '-m',
        'unittest',
        'discover',
        '-s',
        root('server/standby'),
        '-p',
        'test_qualify_tournament_freeze_fixes.py',
      ],
      { encoding: 'utf8', timeout: 15000 }
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it('admits only a zero-error restore with its successful seed', () => {
    expect(standbyShell('assert_valid_copy', validCopy).status).toBe(0);
    for (const files of [
      {},
      { ...validCopy, 'database.json': { ...validCopy['database.json'], restoreErrors: 7 } },
      { ...validCopy, 'database.json': { ...validCopy['database.json'], restoreValidated: false } },
      { ...validCopy, 'seed.json': { ...validCopy['seed.json'], tablesFailed: 1 } },
      {
        ...validCopy,
        'seed.json': { ...validCopy['seed.json'], seededAt: '2026-11-05T00:00:00Z' },
      },
    ])
      expect(standbyShell('assert_valid_copy', files).status).not.toBe(0);
  });

  it.each(['restore', 'owners', 'triggers', 'role', 'extension'])(
    'propagates %s failure and invalidates the previous receipt even under a conditional caller',
    (fault) => {
      const result = standbyShell(
        `
      assert_isolated() { return 0; }
      log() { :; }
      psql_db() {
        case "$*" in
          *'CREATE ROLE'*) [ '${fault}' != role ] || return 19;;
          *'CREATE EXTENSION'*) [ '${fault}' != extension ] || return 19;;
        esac
        case "$*" in *'select count'*) echo 4;; esac
        return 0
      }
      docker() {
        case "$*" in
          *'pg_restore --list'*) echo '5; 2615 2200 SCHEMA - public postgres'; return 0;;
          *'pg_restore -U'*) [ '${fault}' != restore ] || return 19;;
          *'-f /tmp/owners.sql'*) [ '${fault}' != owners ] || return 19;;
          *'CREATE EVENT TRIGGER'*) [ '${fault}' != triggers ] || return 19;;
        esac
        return 0
      }
      if cmd_restore "$STATE_DIR/schema.dump"; then exit 42; fi
      [ ! -e "$STATE_DIR/database.json" ] && [ ! -e "$STATE_DIR/seed.json" ]
    `,
        validCopy
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    }
  );

  it('never starts a runtime when its copy validation fails', () => {
    const result = standbyShell(`
      assert_isolated() { return 0; }
      docker() { echo forbidden-docker-call; return 0; }
      if cmd_run 1111111111111111111111111111111111111111; then exit 42; fi
    `);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('forbidden-docker-call');
  });

  it.each([
    ['same', '2', 'qualified', 0],
    ['different', '2', 'qualified', 1],
    ['same', '1', 'qualified', 1],
    ['same', '2', 'stale', 1],
  ])(
    'requires same container, increased restart count and exact SHA (%s/%s/%s)',
    (id, count, sha, expected) => {
      const result = standbyShell(`
      echo 0 > "$STATE_DIR/clock"
      date() { n=$(cat "$STATE_DIR/clock"); echo $((n+1)) > "$STATE_DIR/clock"; echo "$n"; }
      sleep() { :; }
      docker() { case "$*" in *RestartCount*) echo '${count}';; *) echo '${id}';; esac; }
      health() { echo '{"liveness":"ok","releaseSha":"${sha}"}'; }
      wait_auto_recovery qualified same 1 4
    `);
      expect(result.status).toBe(expected);
    }
  );

  it('refuses unreadable container logs instead of reporting zero fatal lines', () => {
    expect(standbyShell('docker() { return 19; }; count_fatal_logs 0 fixture').status).toBe(1);
    expect(
      standbyShell('docker() { echo healthy; }; count_fatal_logs 0 fixture').stdout.trim()
    ).toBe('0');
  });

  it.each([false, true])('binds the host PID signal to the exact container (%s)', (changed) => {
    const script = readFileSync(root(STANDBY), 'utf8');
    const crash = script.split("<<'PY_CRASH'\n")[1].split('\nPY_CRASH')[0];
    const program = `
import os, signal, subprocess, sys
from unittest.mock import patch
from types import SimpleNamespace
sys.argv = ['crash', 'standby', 'expected']
with patch.object(subprocess, 'run', side_effect=[SimpleNamespace(stdout='"expected" 123'), SimpleNamespace(stdout='"${changed ? 'replaced' : 'expected'}" 123')]), patch.object(os, 'pidfd_open', create=True, return_value=9), patch.object(os, 'close'), patch.object(signal, 'pidfd_send_signal', create=True) as send:
    try:
        exec(${JSON.stringify(crash)})
    except RuntimeError:
        pass
    assert send.call_count == ${changed ? 0 : 1}
`;
    const result = spawnSync('python3', ['-c', program], { encoding: 'utf8', timeout: 15000 });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('wires restore dependencies, strict errors and the actual restart mechanism into the owning route', () => {
    const script = readFileSync(root(STANDBY), 'utf8');
    expect(script).toContain('CREATE EXTENSION IF NOT EXISTS pg_cron');
    expect(script).toContain('supabase_backup_admin ca_record_gateway');
    expect(script).toContain('CREATE ROLE $role NOLOGIN');
    expect(script).toContain('--no-owner --exit-on-error');
    expect(script).not.toContain('GRANT EXECUTE ON ALL FUNCTIONS');
    expect(script).toContain("record 'tournament_freeze_qualification_failed'");
    expect(script).toContain('$4 == "SCHEMA" && $5 == "-" && $6 == "public"');
    expect(script).toContain('--restart unless-stopped');
    expect(script).toContain('signal.pidfd_send_signal(fd, signal.SIGKILL)');
    expect(script).toContain('if binding() != (expected, pid):');
    expect(script).not.toContain('process.kill(1');
    expect(script).not.toContain('docker start "$CONTAINER"');
    expect(script).toContain("record 'restarted_during_soak'");
    const workflow = readFileSync(root('.github/workflows/backup-engine.yml'), 'utf8');
    expect(workflow).toContain('REFRESH_RESULT: ${{ needs.refresh.result }}');
    expect(workflow).toContain('if [ "$REFRESH_RESULT" != success ]; then');
    expect(workflow).toContain('database_refresh_failed');
    expect(workflow).toContain(
      'name: Publish the verdict on the exact commit\n        if: always()'
    );
    expect(workflow).toContain('restoreValidated');
    expect(workflow).toContain('tablesFailed');
  });
});
