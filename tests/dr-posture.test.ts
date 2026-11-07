/**
 * DR posture stays wired (2026-09-01, audit phase 4).
 *
 * The disaster-recovery story is only real while its pieces exist and point
 * at each other. This does not touch any secret or any live system; it pins
 * that the runbook and the secret-backup script are present, name the one
 * component that lives on a single disk, and never leak a value.
 */
import { createHash } from 'node:crypto';
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
  'database.json': {
    restoredAt: '2026-11-06T17:00:00Z',
    restoreErrors: 0,
    restoreValidated: true,
    ownersSha256: createHash('sha256')
      .update(readFileSync(root('server/standby/standby-owners.sql')))
      .digest('hex'),
  },
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

  it('qualifies real sequence ownership in the required native accounting job', () => {
    const workflow = readFileSync(root('.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toContain(
      'python3 -B scripts/verification-harness/standby-sequence-owners.py --pg-bin /usr/lib/postgresql/17/bin --scratch-root'
    );
    expect(classifyChangedPaths(['server/standby/standby-owners.sql']).server).toBe(true);
    expect(
      classifyChangedPaths(['scripts/verification-harness/standby-sequence-owners.py']).server
    ).toBe(true);
  });

  it('aligns standalone sequences after owning tables without broadening grants', () => {
    const sql = readFileSync(root('server/standby/standby-owners.sql'), 'utf8');
    expect(sql).toContain("c.relkind IN ('r','p','v','m','f','S')");
    expect(sql).toContain("ORDER BY (c.relkind = 'S'), n.nspname, c.relname");
    expect(sql).toContain("WHEN 'S' THEN 'SEQUENCE'");
    expect(sql).not.toMatch(/GRANT\s/i);
  });

  it.each(['success', 'ssh-failure', 'tee-failure'])(
    'retains a certificate verdict under bash errexit (%s)',
    (mode) => {
      const workflow = readFileSync(root('.github/workflows/backup-engine.yml'), 'utf8');
      const start = workflow.indexOf(
        '          if ssh -i ~/.ssh/standby -o ServerAliveInterval=30'
      );
      const end = workflow.indexOf('          exit 0', start);
      const body = workflow.slice(start, end);
      const result = standbyShell(`
      cd "$STATE_DIR"
      STANDBY_HOST=fixture SHA=fixture GITHUB_OUTPUT="$STATE_DIR/output"
      ssh() { printf '%s\\n' '{"reasons":["fixture_refusal"]}'; [ '${mode}' != ssh-failure ]; }
      tee() { command tee "$@"; [ '${mode}' != tee-failure ]; }
      ${body}
      cat "$GITHUB_OUTPUT" certificate.json
    `);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(mode === 'success' ? 'rc=0' : 'rc=1');
      expect(result.stdout.trim()).toMatch(/\{"reasons":\["fixture_refusal"\]\}$/);
    }
  );

  it('passes Docker a supported epoch timestamp while retaining log read failures', () => {
    const result = standbyShell(`
      docker() { [ "$1" = logs ] && [ "$2" = --since ] && [ "$3" = 1793999125 ] || return 19; echo healthy; }
      count_fatal_logs 1793999125 fixture
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('0');
  });

  it('admits only a zero-error restore with its successful seed', () => {
    expect(standbyShell('assert_valid_copy', validCopy).status).toBe(0);
    for (const files of [
      {},
      { ...validCopy, 'database.json': { ...validCopy['database.json'], ownersSha256: undefined } },
      {
        ...validCopy,
        'database.json': { ...validCopy['database.json'], ownersSha256: '0'.repeat(64) },
      },
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

  it.each(['matching', 'missing', 'changed'])(
    'refresh selection binds the exact owner source (%s)',
    (mode) => {
      const workflow = readFileSync(root('.github/workflows/backup-engine.yml'), 'utf8');
      const stamp = workflow
        .split('\n')
        .find((line) => line.trimStart().startsWith('stamp=$(ssh'))!;
      const database = {
        ...validCopy['database.json'],
        ownersSha256:
          mode === 'matching'
            ? validCopy['database.json'].ownersSha256
            : mode === 'missing'
              ? undefined
              : '0'.repeat(64),
      };
      const result = standbyShell(
        `
      STANDBY_HOST=fixture
      owners_sha='${validCopy['database.json'].ownersSha256}'
      ssh() {
        local command="\${@: -1}"
        local prefix=/var/lib/club-arena-standby
        command="\${command//$prefix/$STATE_DIR}"
        bash -c "$command"
      }
      ${stamp}
      printf '%s' "$stamp"
    `,
        { ...validCopy, 'database.json': database }
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(
        mode === 'matching' ? validCopy['database.json'].restoredAt : '1970-01-01T00:00:00Z'
      );
    }
  );

  it.each(['restore', 'owners', 'role', 'extension'])(
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
          *'sha256sum /tmp/owners.sql'*) printf '%064d  /tmp/owners.sql\n' 0; return 0;;
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

  it.each(['checks', 'triggers'])(
    'refuses seed certification when final %s installation fails',
    (fault) => {
      const result = standbyShell(
        `
      assert_isolated() { return 0; }; log() { :; }
      mkdir "$STATE_DIR/seed"
      printf '%s' '{"copied":[]}' > "$STATE_DIR/seed/manifest.json"
      printf 'id\\n' > "$STATE_DIR/seed/public.clubs.csv"
      docker() {
        case "$*" in
          *'pg_restore'*) [ '${fault}' != checks ] || return 19;;
          *'CREATE EVENT TRIGGER'*) [ '${fault}' != triggers ] || return 19;;
        esac
        return 0
      }
      if cmd_seed "$STATE_DIR/seed"; then exit 42; fi
      [ ! -e "$STATE_DIR/seed.json" ]
    `,
        validCopy
      );
      expect(result.status, result.stderr).toBe(0);
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

  it.each(['absent', 'stopped', 'daemon-failure', 'stop-failure', 'still-running'])(
    'requires a confirmed isolated stop before restore (%s)',
    (mode) => {
      const result = standbyShell(`
      docker() {
        case "$1" in
          ps) [ '${mode}' != daemon-failure ] || return 19; [ '${mode}' = absent ] || echo "$CONTAINER";;
          stop) [ '${mode}' != stop-failure ];;
          inspect) [ '${mode}' != still-running ] && echo false || echo true;;
        esac
      }
      stop_for_restore
    `);
      expect(result.status === 0).toBe(mode === 'absent' || mode === 'stopped');
    }
  );

  it('retains all ordinary schema entries and defers only pg_dump post-data checks', () => {
    const result = standbyShell(`
      assert_isolated() { return 0; }
      log() { :; }
      psql_db() { case "$*" in *'select count'*) echo 4;; esac; return 0; }
      sha256sum() { echo fixture; }
      docker() {
        case "$*" in
          *'sha256sum /tmp/owners.sql'*) printf '%064d  /tmp/owners.sql\\n' 0;;
          *'pg_restore --list'*) printf '%s\\n' '5; 2615 2200 SCHEMA - public postgres' '6; 1259 1 TABLE public existing postgres' '7; 2606 2 CHECK CONSTRAINT public existing historical_not_valid postgres' '8; 2606 3 FK CONSTRAINT public existing existing_fk postgres' '9; 0 0 COMMENT public CONSTRAINT historical_not_valid ON existing postgres';;
        esac
        return 0
      }
      cmd_restore "$STATE_DIR/schema.dump"
      cat "$STATE_DIR/restore-before-seed.list"
      echo DEFERRED
      cat "$STATE_DIR/restore-after-seed.list"
    `);
    expect(result.status, result.stderr).toBe(0);
    const [before, after] = result.stdout.split('DEFERRED');
    expect(before).toContain('8; 2606 3 FK CONSTRAINT');
    expect(before).toContain(';7; 2606 2 CHECK CONSTRAINT');
    expect(after.trim()).toBe(
      '7; 2606 2 CHECK CONSTRAINT public existing historical_not_valid postgres\n9; 0 0 COMMENT public CONSTRAINT historical_not_valid ON existing postgres'
    );
  });

  it('restores each trigger mode transactionally instead of enabling retired guards', () => {
    const seed = readFileSync(root(STANDBY), 'utf8');
    const placeholders = readFileSync(root('server/standby/standby-placeholders.sql'), 'utf8');
    for (const source of [seed, placeholders]) {
      expect(source).toContain('t.tgrelid,t.tgname,t.tgenabled');
      expect(source).toContain("WHEN 'D' THEN 'DISABLE' WHEN 'O' THEN 'ENABLE'");
      expect(source).toContain("WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS'");
      expect(source).toContain('ALTER TABLE ONLY %s %s TRIGGER %I');
      expect(source).toContain('FROM pg_inherits i JOIN relations r');
      expect(source).not.toMatch(/ENABLE TRIGGER (ALL|USER)/);
      expect(source).toContain('ON COMMIT DROP');
    }
    expect(seed.indexOf('BEGIN;\nCREATE TEMP TABLE _seed_trigger_modes')).toBeGreaterThan(-1);
    expect(placeholders.indexOf('BEGIN;')).toBeLessThan(
      placeholders.indexOf('DISABLE TRIGGER USER')
    );
    expect(placeholders.trim().endsWith('COMMIT;')).toBe(true);
    expect(placeholders).toContain('WHERE NOT t.tgisinternal');
  });

  it('wires restore dependencies, strict errors and the actual restart mechanism into the owning route', () => {
    const script = readFileSync(root(STANDBY), 'utf8');
    expect(script).toContain('CREATE EXTENSION IF NOT EXISTS pg_cron');
    expect(script).toContain('supabase_backup_admin ca_record_gateway');
    expect(script).toContain('CREATE ROLE $role NOLOGIN');
    expect(script).toContain('--no-owner --exit-on-error');
    expect(script.indexOf('stop_for_restore || return 1')).toBeLessThan(
      script.indexOf('DROP SCHEMA IF EXISTS')
    );
    expect(script).toContain('local seed_files=("$dir/public.clubs.csv")');
    expect(script).toContain('--use-list /tmp/restore-after-seed.list --schema-only');
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
    expect(workflow).toContain('sha256sum server/standby/standby-owners.sql');
    expect(workflow).toContain('ownersSha256');
    expect(workflow).toContain('tablesFailed');
  });
});

describe('standby seat proof observes the protected interval', () => {
  for (const trial of ['swap', 'break']) {
    it.each([
      'legitimate-boundary-activity',
      'frozen-mutation',
      'unreadable',
      'different-window',
      'early-thaw',
      'receipt-refused',
      'arbitrary-owner',
      'semantic-change',
      'second-rotation',
      'tail-incomplete',
      'tail-foreign',
      'tail-malformed',
      'tail-early-unfrozen',
      'tail-seat-mutation',
      'tail-missing',
      'tail-clock-crossing',
      'tail-foreign-boundary',
      ...(trial === 'swap'
        ? [
            'process-restart',
            'delayed-first-tail',
            'delayed-first-incomplete',
            'delayed-first-foreign',
            'delayed-first-window',
          ]
        : []),
    ])(`${trial} refuses invalid frozen evidence (%s)`, (mode) => {
      const sha = 'a'.repeat(40);
      const frozen = {
        frozen: true,
        evidenceKind: 'active',
        observedAt: '2026-11-06T22:13:12.000+00:00',
        observationStartedAt: '2026-11-06T22:13:12.000+00:00',
        token: '1135e041-af7d-417b-9121-32e30090652a',
        declaredBy: trial === 'swap' ? 'bbbbbbbb' : sha.slice(0, 8),
        phase: 'counting_down',
        announcedAt: '2026-11-06T22:11:11.748+00:00',
        reason: 'urgent',
        startedAt: '2026-11-06T22:13:11.748+00:00',
        releaseAt: '2026-11-06T22:18:11.748+00:00',
        count: 1,
        fingerprint: 'b'.repeat(32),
      };
      const successor =
        trial === 'swap'
          ? {
              ...frozen,
              token: '2135e041-af7d-417b-9121-32e30090652a',
              declaredBy: sha.slice(0, 8),
            }
          : frozen;
      const tail = {
        ...successor,
        evidenceKind: 'certified_tail',
        phase: null,
        reason: null,
        observedAt: '2026-11-06T22:16:42.000+00:00',
        activeReleaseAt: successor.releaseAt,
        tailContractVersion: 3,
        tailComplete: true,
        tailRequiredSteps: true,
      };
      const badTail =
        mode === 'tail-clock-crossing'
          ? {
              ...tail,
              activeReleaseAt: null,
              observationStartedAt: '2026-11-06T22:18:11.000+00:00',
              observedAt: '2026-11-06T22:18:12.000+00:00',
            }
          : mode === 'tail-foreign-boundary'
            ? { ...tail, activeReleaseAt: '2026-11-06T22:19:11.748+00:00' }
            : mode === 'tail-incomplete'
              ? { ...tail, tailRequiredSteps: false }
              : mode === 'tail-foreign'
                ? { ...tail, token: '4135e041-af7d-417b-9121-32e30090652a' }
                : mode === 'tail-malformed'
                  ? { ...tail, tailComplete: 'true' }
                  : mode === 'tail-early-unfrozen'
                    ? { ...tail, frozen: false }
                    : mode === 'tail-seat-mutation'
                      ? { ...tail, fingerprint: 'f'.repeat(32) }
                      : { ...tail, evidenceKind: 'absent', token: null };
      const changed = { ...successor, fingerprint: 'c'.repeat(32) };
      const different = { ...successor, startedAt: '2026-11-06T22:13:12.748+00:00' };
      const arbitrary = { ...successor, declaredBy: 'cccccccc' };
      const semantic = { ...successor, reason: 'other' };
      const rotated = { ...successor, token: '3135e041-af7d-417b-9121-32e30090652a' };
      const thawed = {
        ...changed,
        frozen: false,
        observedAt: '2026-11-06T22:18:12.000+00:00',
        token: null,
        startedAt: null,
        releaseAt: null,
      };
      const result = standbyShell(`
        source '${root('server/standby/standby-trials.sh')}'
        cmd_run() { :; }; cmd_build() { :; }; wait_live() { :; }; wait_dealing() { :; }; wait_no_break() { :; }
        maintenance_field() { echo 0; }
        health() { echo '${JSON.stringify({ releaseSha: sha, version: sha.slice(0, 8), instanceId: 'candidate-instance', liveness: 'ok' })}'; }
        sleep() { :; }; docker() { if [ "$1" = inspect ]; then case "$*" in *'.Id'*) local n=0; [ ! -f "$STATE_DIR/inspect" ] || n=$(cat "$STATE_DIR/inspect"); echo $((n+1)) > "$STATE_DIR/inspect"; if [ '${mode}' = process-restart ] && [ "$n" -gt 0 ]; then echo '${'d'.repeat(64)} ${sha} true 1'; else echo '${'d'.repeat(64)} ${sha} true 0'; fi;; *) echo '${sha}';; esac; fi; }
        # Old proof would compare a pre-announcement A against post-thaw C.
        seat_fingerprint() { echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; }
        request_break() { echo 0 > "$STATE_DIR/sample"; }
        psql_db() {
          case "$*" in *'-v version='*) [ '${mode}' = receipt-refused ] && echo f || echo t; return 0;; esac
          local n; n=$(cat "$STATE_DIR/sample"); n=$((n+1)); echo "$n" > "$STATE_DIR/sample"
          if [ '${mode}' = unreadable ]; then return 19; fi
          if [ "$n" -eq 2 ]; then
            case '${mode}' in
              delayed-first-tail) printf '%s' '${JSON.stringify(tail)}'; return 0;;
              delayed-first-incomplete) printf '%s' '${JSON.stringify({ ...tail, tailComplete: false })}'; return 0;;
              delayed-first-foreign) printf '%s' '${JSON.stringify({ ...tail, declaredBy: 'cccccccc' })}'; return 0;;
              delayed-first-window) printf '%s' '${JSON.stringify({ ...tail, releaseAt: '2026-11-06T22:19:11.748+00:00' })}'; return 0;;
              frozen-mutation) printf '%s' '${JSON.stringify(changed)}'; return 0;;
              different-window) printf '%s' '${JSON.stringify(different)}'; return 0;;
              arbitrary-owner) printf '%s' '${JSON.stringify(arbitrary)}'; return 0;;
              semantic-change) printf '%s' '${JSON.stringify(semantic)}'; return 0;;
              early-thaw) printf '%s' '${JSON.stringify(thawed)}'; return 0;;
            esac
          fi
          if [ "$n" -eq 3 ] && [ '${mode}' = second-rotation ]; then printf '%s' '${JSON.stringify(rotated)}'; return 0; fi
          if [ "$n" -eq 3 ]; then
            case '${mode}' in tail-*) printf '%s' '${JSON.stringify(badTail)}';; *) printf '%s' '${JSON.stringify(tail)}';; esac
            return 0
          fi
          if [ "$n" -gt 1 ] && [ "$n" -lt 4 ]; then printf '%s' '${JSON.stringify(successor)}'; return 0; fi
          if [ "$n" -ge 4 ]; then printf '%s' '${JSON.stringify(thawed)}'; else printf '%s' '${JSON.stringify(frozen)}'; fi
        }
        trial_${trial} '${sha}' '${sha}'
      `);
      // Break has no engine boot and can legitimately release on its second sample.
      const passing =
        mode === 'legitimate-boundary-activity' ||
        mode === 'delayed-first-tail' ||
        mode === 'tail-clock-crossing' ||
        (trial === 'break' && mode === 'early-thaw');
      expect(result.status === 0, result.stderr + result.stdout).toBe(passing);
      if (passing) expect(result.stdout).toContain('"frozenSeatBoundary":');
      if (mode.startsWith('tail-') && !passing) {
        const verdict = JSON.parse(result.stdout.trim());
        expect(verdict.rejectedSeatObservation.observation).toEqual(badTail);
        expect(verdict.rejectedSeatObservation.reason).toContain('frozen_seat_boundary:');
      }
    });
  }
});

describe('standby adoption authority and timing', () => {
  it.each(['exact', 'wrong-label', 'wrong-health', 'wrong-version'])(
    'binds the controlled candidate (%s)',
    (mode) => {
      const sha = 'a'.repeat(40);
      const result = standbyShell(`source '${root('server/standby/standby-trials.sh')}'
      docker() { echo '${'d'.repeat(64)} ${mode === 'wrong-label' ? 'b'.repeat(40) : sha} true 0'; }
      health() { echo '${JSON.stringify({ releaseSha: mode === 'wrong-health' ? 'b'.repeat(40) : sha, version: mode === 'wrong-version' ? 'bbbbbbbb' : 'aaaaaaaa', instanceId: 'candidate-instance', liveness: 'ok' })}'; }
      # Exercise the real JSON consumer with the producer delayed.
      printf() { sleep 0.02; builtin printf "$@"; }
      swap_target_identity '${sha}'
    `);
      expect(result.status === 0, result.stderr + result.stdout).toBe(mode === 'exact');
    }
  );
  it('consumes health JSON even when the pipeline producer is delayed', () => {
    const sha = 'a'.repeat(40);
    const result = standbyShell(`source '${root('server/standby/standby-trials.sh')}'
      docker() { echo '${'d'.repeat(64)} ${sha} true 0'; }
      health() { echo '${JSON.stringify({ releaseSha: sha, version: sha.slice(0, 8), instanceId: 'candidate-instance', liveness: 'ok' })}'; }
      printf() { sleep 0.05; builtin printf "$@"; }
      swap_target_identity '${sha}'
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).instanceId).toBe('candidate-instance');
  });

  it('reports unknown and reversed observations as null', () => {
    const result = standbyShell(`source '${root('server/standby/standby-trials.sh')}'
      trial_elapsed 100 ''; echo; trial_elapsed '' 105; echo; trial_elapsed 105 100; echo; trial_elapsed 100 105
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('null\nnull\nnull\n5');
  });
});

it('table-kill compares running state and restart count separately', () => {
  const script = readFileSync(root('server/standby/standby-trials.sh'), 'utf8');
  const trial = script.slice(script.indexOf('trial_table_kill()'), script.indexOf('cmd_trial()'));
  expect(trial).toContain("docker inspect -f '{{.State.Running}}'");
  expect(trial).not.toContain('{{.State.Running}} {{.RestartCount}}');
  expect(trial).toContain('"$restarts_before" ] || reasons="$reasons,engine_process_restarted"');
});
