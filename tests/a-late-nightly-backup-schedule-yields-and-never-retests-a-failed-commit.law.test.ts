/**
 * LAW: a late nightly Backup schedule yields like a push run, keep-serving
 * honors held-migration deferral without forcing a copy, deterministic Backup
 * failures are never re-soaked on identical inputs, and completed-run pending
 * statuses are reported as stale-pending (FM2, FM3, FM4, FM5).
 * ═══════════════════════════════════════════════════════════════════════════
 * Incident 2026-11-28 (missed 07:00 CST & 10:00 CST cutovers):
 *   - FM2: `workflow_dispatch + after_cycle` (46135124209) was exempt from O7
 *     `held=1` when O29 step-down found no selectable fallback, wasting 48m
 *     certifying an unselectable commit on a copy lacking its migrations.
 *   - FM3: late-delivered nightly `schedule` run (46159605943) lacked
 *     pre-lease `SUPERSEDED`, in-place `late_retarget`, mid-soak O1/O35
 *     `YIELDED_OBSOLETE`, and same-day terminal-verdict deferral, starving
 *     fresher push run 46159636068 for 35m.
 *   - FM4: deterministic Backup `failure` verdicts omitted `(comparable_digest,
 *     live_serving, backup_projection)` provenance and `due` had no
 *     already-failed short-circuit, wasting 115m re-soaking `65a64d1f` four
 *     times (`46148552900 -> 46149523970 -> 46153001597 -> 46159605943`), while
 *     `stage-engine-release.yml` hardcoded `refresh=true` on keep-serving.
 *   - FM5: `YIELDED_OBSOLETE` deliberately publishes NO `failure`/`error`
 *     status (O1/O35), leaving an orphaned `pending` status that
 *     `select-daily-engine.py` misreported as actively soaking instead of
 *     `stale-pending (run <id> completed without verdict)`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const backup = parse(read('.github/workflows/backup-engine.yml'));
const stage = parse(read('.github/workflows/stage-engine-release.yml'));
const HELD = '20261128095500';
const temps: string[] = [];

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function temp(prefix: string) {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function runShell(script: string, env: NodeJS.ProcessEnv, cwd?: string) {
  const dir = temp('rc-loop-shell-');
  const output = resolve(dir, 'github-output');
  const summary = resolve(dir, 'summary.md');
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    cwd,
    env: {
      ...cleanEnv(),
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      ...env,
    },
  });
  const readOpt = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return { ...result, out: readOpt(output), summary: readOpt(summary) };
}

type GitFixture = {
  dir: string;
  repo: string;
  remote: string;
  production: string;
  health: string;
  shas: Record<string, string>;
  git: (...args: string[]) => string;
  write: (rel: string, content: string) => void;
  commit: (msg: string, files?: Record<string, string>) => string;
  pushMain: () => void;
};

function makeFixture(opts: { changeControlOnHeld?: boolean } = {}): GitFixture {
  const dir = temp('rc-loop-fixture-');
  const repo = resolve(dir, 'repo');
  const remote = resolve(dir, 'origin.git');
  mkdirSync(repo);
  const env = cleanEnv();
  const rInit = spawnSync('git', ['init', '-q', '--bare', remote], { encoding: 'utf8', env });
  if (rInit.status !== 0) throw new Error(rInit.stderr);
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (rel: string, content: string) => {
    mkdirSync(dirname(resolve(repo, rel)), { recursive: true });
    writeFileSync(resolve(repo, rel), content);
  };
  const commit = (msg: string, files?: Record<string, string>) => {
    if (files) {
      for (const [k, v] of Object.entries(files)) write(k, v);
    }
    git('add', '-A');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Audit Hardening Fixture');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', remote);

  const prequalScript = read('scripts/ci/read-engine-prequalification.py');
  const idScript = read('scripts/ci/engine-source-identity.sh');
  const shas: Record<string, string> = {};
  shas.serving = commit('serving build', {
    'server/src/index.ts': 'export const v = 0;\n',
    'server/Dockerfile': 'FROM node:22@sha256:' + '0'.repeat(64) + '\nCOPY src ./src\n',
    '.github/workflows/backup-engine.yml': 'name: backup\n',
    '.github/workflows/stage-engine-release.yml': 'name: stage-v1\n',
    'scripts/ci/read-engine-prequalification.py': prequalScript,
    'scripts/ci/engine-source-identity.sh': idScript,
    'server/scripts/engine-release-transaction.sh': '#!/bin/sh\n',
  });
  shas.good = commit('good candidate ahead of serving', {
    'server/src/index.ts': 'export const v = 1;\n',
    '.github/workflows/stage-engine-release.yml': 'name: stage-v2\n',
  });
  shas.bad = commit('candidate that fails Backup deterministically', {
    'server/src/index.ts': 'export const v = 2;\n',
  });
  shas.held = commit('commit adding held migration', {
    [`supabase/migrations/${HELD}_held.sql`]: 'SELECT 1;\n',
    ...(opts.changeControlOnHeld
      ? { '.github/workflows/stage-engine-release.yml': 'name: stage-v3\n' }
      : {}),
  });
  git('push', '-q', 'origin', 'main');
  git('fetch', '-q', 'origin');

  const signatures = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      'import importlib.util,json,sys;s=importlib.util.spec_from_file_location("se",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps({"migrations":[["20260101000000","fixture"]],"functions":{k:k for k in m.SIGNATURES}}))',
      resolve(ROOT, 'server/standby/schema-evidence.py'),
    ],
    { encoding: 'utf8', env }
  );
  if (signatures.status !== 0) throw new Error(signatures.stderr);
  const production = resolve(dir, 'production.json');
  writeFileSync(production, signatures.stdout);
  const health = resolve(dir, 'health.json');
  writeFileSync(health, JSON.stringify({ running: true, releaseSha: shas.serving }));
  return {
    dir,
    repo,
    remote,
    production,
    health: pathToFileURL(health).href,
    shas,
    git,
    write,
    commit,
    pushMain: () => {
      git('push', '-q', 'origin', 'main');
      git('fetch', '-q', 'origin');
    },
  };
}

function backupProjection12(repo: string, sha: string): string {
  const r = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      'import hashlib,runpy,sys; m=runpy.run_path("scripts/ci/read-engine-prequalification.py"); print(hashlib.sha256(m["backup_projection"](sys.argv[1]).encode("utf-8")).hexdigest()[:12])',
      sha,
    ],
    { encoding: 'utf8', cwd: repo, env: cleanEnv() }
  );
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function comparableDigest(f: GitFixture, control: string, sha: string): string {
  const r = spawnSync(
    'python3',
    [
      '-B',
      resolve(ROOT, 'server/scripts/engine-release-installed-migrations.py'),
      'refresh-due',
      '--copy-evidence',
      '/dev/null',
      '--control',
      control,
      '--sha',
      sha,
      '--wait',
      '1',
      '--production',
      f.production,
    ],
    { encoding: 'utf8', cwd: f.repo, env: cleanEnv() }
  );
  if (r.status !== 0) throw new Error(r.stderr);
  const match = /^comparable=([0-9a-f]{64})$/m.exec(r.stdout);
  if (!match) throw new Error(`no comparable digest in:\n${r.stdout}\n${r.stderr}`);
  return match[1];
}

function runDueStep(
  f: GitFixture,
  envOverrides: Record<string, string>,
  opts: {
    statuses?: Record<
      string,
      { state: string; description: string; target_url?: string; rehearsedServingSha?: string }
    >;
    prequal?: Record<string, 'passed' | 'failed' | 'pending' | 'absent'>;
    copyMatchesProduction?: boolean;
    dateStub?: string;
    liveServing?: string | 'FAIL';
  } = {}
) {
  const dueStep = backup.jobs.refresh.steps.find((s: any) => s.id === 'due');
  const dir = temp('rc-loop-due-');
  const binDir = resolve(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const calls = resolve(dir, 'calls');
  const statusFile = resolve(dir, 'statuses.json');
  const prequalFile = resolve(dir, 'prequal.json');
  writeFileSync(statusFile, JSON.stringify(opts.statuses ?? {}));
  writeFileSync(prequalFile, JSON.stringify(opts.prequal ?? {}));
  writeFileSync(
    resolve(binDir, 'gh'),
    `#!/usr/bin/env python3
import io, json, os, re, sys, zipfile
args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as f:
    f.write('gh ' + ' '.join(args) + '\\n')
url = args[1] if len(args) > 1 else ''
jq_expr = args[args.index('--jq') + 1] if '--jq' in args else None
statuses = json.load(open(${JSON.stringify(statusFile)}))
prequal = json.load(open(${JSON.stringify(prequalFile)}))
if 'engine-release-prequalification.yml/runs' in url:
    m = re.search(r'head_sha=([0-9a-f]{40})', url)
    entry = prequal.get(m.group(1)) if m else None
    if entry == 'passed':
        print(json.dumps({'workflow_runs': [{'id': 901, 'head_sha': m.group(1), 'status': 'completed', 'conclusion': 'success'}]}))
    elif entry == 'failed':
        print(json.dumps({'workflow_runs': [{'id': 902, 'head_sha': m.group(1), 'status': 'completed', 'conclusion': 'failure'}]}))
    elif entry == 'pending':
        print(json.dumps({'workflow_runs': [{'id': 903, 'head_sha': m.group(1), 'status': 'in_progress', 'conclusion': None}]}))
    else:
        print(json.dumps({'workflow_runs': []}))
    sys.exit(0)
m_art = re.search(r'actions/runs/([0-9]+)/artifacts', url)
if m_art:
    rid = m_art.group(1)
    for e in statuses.values():
        if str(e.get('target_url', '')).endswith('/actions/runs/' + rid) and e.get('rehearsedServingSha'):
            print(rid)
            sys.exit(0)
    print('')
    sys.exit(0)
m_zip = re.search(r'actions/artifacts/([0-9]+)/zip', url)
if m_zip:
    rid = m_zip.group(1)
    for e in statuses.values():
        if str(e.get('target_url', '')).endswith('/actions/runs/' + rid) and e.get('rehearsedServingSha'):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w') as zf:
                zf.writestr('certificate.json', json.dumps({'rehearsedServingSha': e['rehearsedServingSha']}))
            sys.stdout.buffer.write(buf.getvalue())
            sys.exit(0)
    sys.exit(1)
m = re.search(r'commits/([0-9a-f]{40})/statuses', url)
if m:
    entry = statuses.get(m.group(1))
    rows = [] if entry is None else [{
        'context': 'backup-engine/certified',
        'state': entry['state'],
        'description': entry.get('description', ''),
        'target_url': entry.get('target_url', 'https://github.com/o/r/actions/runs/555'),
    }]
    if jq_expr is not None:
        if rows:
            r = rows[0]
            print(f"{r['state']}|{r['target_url']}|{r['description']}")
        sys.exit(0)
    print(json.dumps(rows))
    sys.exit(0)
sys.exit(1)
`,
    { mode: 0o755 }
  );

  let copyEvidenceFile = '';
  let copyEvidenceSha = '';
  if (opts.copyMatchesProduction) {
    const prod = JSON.parse(readFileSync(f.production, 'utf8'));
    const body = JSON.stringify({
      schema: 'club-arena-schema-evidence/v1',
      migrations: prod.migrations,
      functions: Object.fromEntries(
        Object.entries(prod.functions as Record<string, string>).map(([sig, defn]) => [
          sig,
          createHash('sha256').update(defn).digest('hex'),
        ])
      ),
      dumpSha256: 'a'.repeat(64),
    });
    copyEvidenceFile = resolve(dir, 'copy-evidence.json');
    writeFileSync(copyEvidenceFile, body);
    copyEvidenceSha = createHash('sha256').update(body).digest('hex');
  }

  const liveServing = opts.liveServing ?? f.shas.serving;
  const curlStub =
    liveServing === 'FAIL'
      ? 'return 1'
      : `printf '%s\\n' ${JSON.stringify(JSON.stringify({ running: true, releaseSha: liveServing }))}`;
  const dateStub = opts.dateStub ?? 'date() { echo "2026-11-28"; }';

  const harness = `sha256sum() { echo "0000000000000000000000000000000000000000000000000000000000000000  $1"; }
ssh() {
  echo "ssh $*" >> "$CALLS"
  case "$*" in
    *"python3 - '"*) cat > /dev/null; echo "LEASE_RELEASED" >> "$CALLS" ;;
    *"restoredAt"*) echo "2026-11-28T14:00:00Z" ;;
    *"schemaEvidenceSha256"*) echo "\${COPY_EVIDENCE_SHA:-}" ;;
    *"schema-evidence.json"*) [ -n "\${COPY_EVIDENCE_FILE:-}" ] && cat "$COPY_EVIDENCE_FILE" || echo "" ;;
    *) echo "" ;;
  esac
}
curl() {
  echo "curl $*" >> "$CALLS"
  ${curlStub}
}
${dateStub}
python3() {
  if [ "\${1:-}" = -B ] && [ "\${2:-}" = scripts/release/step-down-past-held-migration.py ]; then
    shift 2
    local is_check=0
    for arg in "$@"; do
      if [ "$arg" = --check-prequal-only ]; then is_check=1; break; fi
    done
    if [ "$is_check" = 1 ]; then
      command python3 -B ${JSON.stringify(resolve(ROOT, 'scripts/release/step-down-past-held-migration.py'))} "$@"
    else
      command python3 -B ${JSON.stringify(resolve(ROOT, 'scripts/release/step-down-past-held-migration.py'))} "$@" \\
        --prequal ${JSON.stringify(resolve(ROOT, 'scripts/ci/read-engine-prequalification.py'))} \\
        --installed-tool ${JSON.stringify(resolve(ROOT, 'server/scripts/engine-release-installed-migrations.py'))} \\
        --production "$PRODUCTION" --health-url "$HEALTH_URL"
    fi
    return
  fi
  if [ "\${1:-}" = -B ] && [ "\${2:-}" = server/scripts/engine-release-installed-migrations.py ]; then
    shift 2
    local args=() prev=''
    for arg in "$@"; do
      if [ "$prev" = --wait ]; then args+=(1); else args+=("$arg"); fi
      prev="$arg"
    done
    command python3 -B ${JSON.stringify(resolve(ROOT, 'server/scripts/engine-release-installed-migrations.py'))} "\${args[@]}" --production "$PRODUCTION"
    return
  fi
  command python3 "$@"
}
`;
  const r = runShell(
    harness + String(dueStep.run),
    {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      HOME: dir,
      CALLS: calls,
      PRODUCTION: f.production,
      HEALTH_URL: f.health,
      COPY_EVIDENCE_FILE: copyEvidenceFile,
      COPY_EVIDENCE_SHA: copyEvidenceSha,
      SSH_KEY: 'fixture-key-not-a-credential',
      STANDBY_HOST: '192.0.2.1',
      STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
      STATUS_CONTEXT: 'backup-engine/certified',
      DATABASE_URL: 'postgres://fixture',
      GITHUB_REPOSITORY: 'o/r',
      MODE: 'auto',
      EVENT: 'push',
      RUN_ID: '888',
      RUN_ATTEMPT: '1',
      FREEZE_BASELINE: '',
      PLAN_PRIORITY: 'none',
      POST_SEAL: '',
      SEALED_SHA: '',
      INPUT_SHA: '',
      AFTER_CYCLE: '',
      ...envOverrides,
    },
    f.repo
  );
  return { ...r, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
}

describe('FM2: workflow_dispatch + after_cycle honors O7 held=1 deferral when O29 finds no selectable fallback', () => {
  it('defers cleanly and releases the host lease for after_cycle without INPUT_SHA, while keeping explicit manual workflow_dispatch unaffected', () => {
    const f = makeFixture({ changeControlOnHeld: true });
    const { held } = f.shas;

    // Backup after keep-serving (after_cycle set, no INPUT_SHA): O29 cannot step
    // down past a release-control change, so FM2 MUST honor held=1 deferral.
    const afterCycle = runDueStep(f, {
      EVENT: 'workflow_dispatch',
      MODE: 'auto',
      AFTER_CYCLE: '2026-11-28T07',
      SHA: held,
      CONTROL: held,
      GITHUB_SHA: held,
    });
    expect(afterCycle.status, afterCycle.stderr).toBe(0);
    expect(afterCycle.stdout).toContain(
      `DEFERRED: ${held} carries uninstalled ordinary migration(s)`
    );
    expect(afterCycle.out).toContain('deferred=1\n');
    expect(afterCycle.out).toContain('due=false\n');
    expect(afterCycle.calls).toContain('LEASE_RELEASED');

    // Manual workflow_dispatch WITHOUT after_cycle, or WITH explicit INPUT_SHA, stays unaffected.
    for (const manualEnv of [
      { AFTER_CYCLE: '', INPUT_SHA: '' },
      { AFTER_CYCLE: '', INPUT_SHA: held },
      { AFTER_CYCLE: '2026-11-28T07', INPUT_SHA: held },
    ]) {
      const manual = runDueStep(f, {
        EVENT: 'workflow_dispatch',
        MODE: 'auto',
        SHA: held,
        CONTROL: held,
        GITHUB_SHA: held,
        ...manualEnv,
      });
      expect(manual.status, manual.stderr).toBe(0);
      expect(manual.stdout).not.toContain('DEFERRED:');
      expect(manual.out).not.toContain('deferred=1');
      expect(manual.calls).not.toContain('LEASE_RELEASED');
    }
  }, 60_000);
});

describe('FM3: late-delivered nightly schedule runs participate in supersession, in-place retarget, mid-soak yield, and same-day terminal-verdict skip', () => {
  const turnStep = backup.jobs.refresh.steps.find((s: any) => s.id === 'turn');
  const lateRetargetStep = backup.jobs.refresh.steps.find((s: any) => s.id === 'late_retarget');
  const certifyStep = backup.jobs.certify.steps.find((s: any) => s.id === 'certify');

  it('includes schedule (when freeze_baseline != 1) in turn SUPERSEDED, late_retarget, and mid-soak O1/O35 yield, while keeping freeze_baseline exempt', () => {
    // 1. late_retarget step `if:` admits push and schedule (not workflow_dispatch / repository_dispatch).
    expect(String(lateRetargetStep.if)).toContain("github.event_name == 'schedule'");
    expect(String(lateRetargetStep.if)).toContain("needs.plan.outputs.freeze_baseline != '1'");
    expect(String(lateRetargetStep.if)).not.toContain('workflow_dispatch');
    expect(String(lateRetargetStep.if)).not.toContain('repository_dispatch');

    // 2. select-daily-engine.py admits producer provenance for schedule retargets too.
    const selector = read('scripts/ci/select-daily-engine.py');
    expect(selector).toContain("run.get('event') not in ('push', 'schedule')");

    // 3. Pre-lease SUPERSEDED: non-freeze schedule run yields to a newer active push run with different engine source.
    const f = makeFixture();
    const callsDir = temp('rc-loop-turn-');
    const calls = resolve(callsDir, 'calls');
    const turnHarness = `
ssh_count=0
ssh() {
  ssh_count=$((ssh_count + 1))
  if [ "$ssh_count" -eq 1 ]; then echo "held:424242"; else echo "acquired"; fi
}
sleep() { echo "sleep $*" >> "$CALLS"; }
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *actions/workflows/backup-engine.yml/runs*) printf '%s\\n' ${JSON.stringify(f.shas.bad)} ;;
    *contents/scripts/ci/backup-candidate-priority.py*) printf '%s\\n' "print('priority=none')" ;;
    *) return 1 ;;
  esac
}
`;
    const superseded = runShell(
      turnHarness + String(turnStep.run),
      {
        CALLS: calls,
        HOME: callsDir,
        SSH_KEY: 'fixture-key',
        STANDBY_HOST: '192.0.2.1',
        STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_SHA: f.shas.good,
        SHA: f.shas.good,
        EVENT: 'schedule',
        RUN_ID: '100',
        RUN_ATTEMPT: '1',
        FREEZE_BASELINE: '',
        PLAN_PRIORITY: 'none',
        POST_SEAL: '',
        KEEP_SERVING: '',
      },
      f.repo
    );
    expect(superseded.status, superseded.stderr).toBe(0);
    expect(superseded.stdout).toContain('SUPERSEDED: 1 newer active push run(s)');
    expect(superseded.out).toContain('superseded=1\n');
    expect(superseded.out).not.toContain('acquired=1');

    // 4. Mid-soak O1/O35 yield: non-freeze schedule yields when prequal fails or controls diverge.
    const soakDir = temp('rc-loop-soak-');
    const soakCalls = resolve(soakDir, 'calls');
    const soakBin = resolve(soakDir, 'bin');
    mkdirSync(soakBin, { recursive: true });
    writeFileSync(
      resolve(soakBin, 'gh'),
      `#!/usr/bin/env python3
import json, sys
url = sys.argv[2] if len(sys.argv) > 2 else ''
if 'engine-release-prequalification.yml/runs' in url:
    print(json.dumps({'workflow_runs': [{'id': 909, 'head_sha': ${JSON.stringify(f.shas.good)}, 'status': 'completed', 'conclusion': 'failure'}]}))
    sys.exit(0)
sys.exit(1)
`,
      { mode: 0o755 }
    );
    const soakHarness = `
ssh() {
  case "$*" in
    *"standby-engine certify"*) sleep 10; echo '{"verdict":"pass"}' ;;
    *"stop_for_restore"*) echo "CLEANUP_CALLED" >> "$CALLS" ;;
  esac
}
curl() { return 1; }
python3() {
  if [ "\${1:-}" = -B ] && [ "\${2:-}" = scripts/release/step-down-past-held-migration.py ]; then
    shift 2
    command python3 -B ${JSON.stringify(resolve(ROOT, 'scripts/release/step-down-past-held-migration.py'))} "$@"
    return
  fi
  command python3 "$@"
}
`;
    const yielded = runShell(
      soakHarness + String(certifyStep.run),
      {
        PATH: `${soakBin}:${process.env.PATH ?? ''}`,
        CALLS: soakCalls,
        HOME: soakDir,
        SSH_KEY: 'fixture-key',
        STANDBY_HOST: '192.0.2.1',
        STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
        GITHUB_REPOSITORY: 'o/r',
        STATUS_CONTEXT: 'backup-engine/certified',
        DATABASE_URL: 'postgres://fixture',
        SHA: f.shas.good,
        CONTROL_SHA: f.shas.good,
        REFRESH_RESULT: 'success',
        EVENT: 'schedule',
        FREEZE_BASELINE: '',
        PLAN_PRIORITY: 'none',
        POST_SEAL: '',
        SEALED_SHA: '',
        KEEP_SERVING: '',
        RUN_ID: '100',
        YIELD_CHECK_INTERVAL: '1',
      },
      f.repo
    );
    expect(yielded.status, yielded.stderr).toBe(0);
    expect(yielded.stdout).toContain('YIELDED_OBSOLETE: prequalification_failed');
    expect(yielded.out).toContain('yielded=1\n');
    expect(readFileSync(soakCalls, 'utf8')).toContain('CLEANUP_CALLED');

    // Freeze baseline schedule stays exempt from mid-soak yield.
    const freezeKept = runShell(
      soakHarness.replace('sleep 10', 'sleep 2') + String(certifyStep.run),
      {
        PATH: `${soakBin}:${process.env.PATH ?? ''}`,
        CALLS: resolve(soakDir, 'freeze-calls'),
        HOME: soakDir,
        SSH_KEY: 'fixture-key',
        STANDBY_HOST: '192.0.2.1',
        STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
        GITHUB_REPOSITORY: 'o/r',
        STATUS_CONTEXT: 'backup-engine/certified',
        DATABASE_URL: 'postgres://fixture',
        SHA: f.shas.good,
        CONTROL_SHA: f.shas.good,
        REFRESH_RESULT: 'success',
        EVENT: 'schedule',
        FREEZE_BASELINE: '1',
        PLAN_PRIORITY: 'none',
        POST_SEAL: '',
        SEALED_SHA: '',
        KEEP_SERVING: '',
        RUN_ID: '100',
        YIELD_CHECK_INTERVAL: '1',
      },
      f.repo
    );
    expect(freezeKept.status, freezeKept.stderr).toBe(0);
    expect(freezeKept.out).not.toContain('yielded=1');
    expect(freezeKept.stdout).not.toContain('YIELDED_OBSOLETE');
  }, 60_000);

  it('defers a same-day schedule run (copy_day == today && contents_due == false) when SHA already has a deterministic failure for identical inputs, while still running on a new Chicago day', () => {
    const f = makeFixture();
    const { serving, bad } = f.shas;
    const comp = comparableDigest(f, bad, bad);
    const proj12 = backupProjection12(f.repo, bad);
    const failDesc = `Backup Engine refused: hand_gap_unintended_delay_exceeded; installed migrations ${comp.slice(0, 12)} serving ${serving.slice(0, 12)} proj ${proj12}`;

    const sameDay = runDueStep(
      f,
      { EVENT: 'schedule', SHA: bad, CONTROL: bad, GITHUB_SHA: bad },
      {
        copyMatchesProduction: true,
        statuses: { [bad]: { state: 'failure', description: failDesc } },
        dateStub: 'date() { echo "2026-11-28"; }',
      }
    );
    expect(sameDay.status, sameDay.stderr).toBe(0);
    expect(sameDay.stdout).toContain(
      `DEFERRED: ${bad} already failed Backup certification deterministically`
    );
    expect(sameDay.out).toContain('deferred=1\n');
    expect(sameDay.out).toContain('due=false\n');
    expect(sameDay.calls).toContain('LEASE_RELEASED');

    // New Chicago day (copy_day != today): nightly refresh still runs!
    const newDay = runDueStep(
      f,
      { EVENT: 'schedule', SHA: bad, CONTROL: bad, GITHUB_SHA: bad },
      {
        copyMatchesProduction: true,
        statuses: { [bad]: { state: 'failure', description: failDesc } },
        dateStub:
          'date() { if [ "$1" = -d ]; then echo "2026-11-27"; else echo "2026-11-28"; fi; }',
      }
    );
    expect(newDay.status, newDay.stderr).toBe(0);
    expect(newDay.out).toContain('due=true\n');
    expect(newDay.out).not.toContain('deferred=1');
    expect(newDay.calls).not.toContain('LEASE_RELEASED');
  }, 60_000);
});

describe('FM4: deterministic failure provenance <= 140 chars, duplicate-soak short-circuit, and stage refresh=false', () => {
  const publishStep = backup.jobs.certify.steps.find((s: any) =>
    /Publish the verdict/.test(s.name)
  );

  it('Publish records installed migrations, serving, and proj in deterministic failure descriptions strictly <= 140 chars', () => {
    const dir = temp('rc-loop-pub-');
    const calls = resolve(dir, 'calls');
    const sha = 'a'.repeat(40);
    const digest64 = 'b'.repeat(64);
    const serving40 = 'c'.repeat(40);
    const proj12 = 'd'.repeat(12);
    writeFileSync(
      resolve(dir, 'certificate.json'),
      JSON.stringify({
        reasons: [
          'hand_gap_unintended_delay_exceeded',
          'extra_very_long_reason_that_exceeds_budget_significantly',
        ],
      })
    );
    const fakeGh = `gh() {
  for a in "$@"; do
    case "$a" in
      description=*) printf '%s\\n' "\${a#description=}" > "$CALLS" ;;
    esac
  done
}
`;
    const r = runShell(
      fakeGh + String(publishStep.run),
      {
        CALLS: calls,
        SHA: sha,
        RC: '1',
        YIELDED: '',
        JOB_STATUS: 'success',
        INSTALLED: '',
        FAILED_INSTALLED: digest64,
        FAILED_SERVING: serving40,
        FAILED_PROJ: proj12,
        PENDING: 'success',
        WROTE_PENDING: '1',
        POLICY: 'success',
        REFRESH: 'success',
        TURN: '1',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '999',
        STATUS_CONTEXT: 'backup-engine/certified',
      },
      dir
    );
    expect(r.status).toBe(1);
    const desc = readFileSync(calls, 'utf8').trim();
    expect(desc.length).toBeLessThanOrEqual(140);
    expect(desc).toContain('Backup Engine refused: hand_gap_unintended_delay_exceeded');
    expect(desc).toContain(
      `; installed migrations ${digest64.slice(0, 12)} serving ${serving40.slice(0, 12)} proj ${proj12}`
    );
    expect(publishStep.env.FAILED_INSTALLED).toBe('${{ steps.certify.outputs.failed_installed }}');
    expect(publishStep.env.FAILED_SERVING).toBe('${{ steps.certify.outputs.failed_serving }}');
    expect(publishStep.env.FAILED_PROJ).toBe('${{ steps.certify.outputs.failed_proj }}');
  });

  it('due steps down (or defers cleanly) on deterministic failure for identical inputs on push and after_cycle, and retries on error, changed migrations, changed serving, changed projection, or manual dispatch', () => {
    const f = makeFixture();
    const { serving, good, bad } = f.shas;
    const comp = comparableDigest(f, bad, bad);
    const proj12 = backupProjection12(f.repo, bad);
    const failDesc = `Backup Engine refused: hand_gap_unintended_delay_exceeded; installed migrations ${comp.slice(0, 12)} serving ${serving.slice(0, 12)} proj ${proj12}`;

    // 1. Push on `bad` with shippable `good` below -> steps down `bad -> good` instead of re-soaking `bad`!
    const stepped = runDueStep(
      f,
      { EVENT: 'push', SHA: bad, CONTROL: bad, GITHUB_SHA: bad },
      {
        copyMatchesProduction: true,
        prequal: { [bad]: 'passed', [good]: 'passed' },
        statuses: { [bad]: { state: 'failure', description: failDesc } },
      }
    );
    expect(stepped.status, stepped.stderr).toBe(0);
    expect(stepped.stdout).toContain(
      `STEPPED DOWN: ${bad} already failed Backup certification deterministically`
    );
    expect(stepped.out).toContain(`sha=${good}\n`);
    expect(stepped.out).not.toContain('deferred=1');

    // 2. Push and after_cycle when BOTH `bad` and `good` already failed -> defers cleanly and releases lease!
    for (const ev of [
      { EVENT: 'push', AFTER_CYCLE: '' },
      { EVENT: 'workflow_dispatch', AFTER_CYCLE: '2026-11-28T07' },
    ]) {
      const deferred = runDueStep(
        f,
        { SHA: bad, CONTROL: bad, GITHUB_SHA: bad, ...ev },
        {
          copyMatchesProduction: true,
          prequal: { [bad]: 'passed', [good]: 'passed' },
          statuses: {
            [bad]: { state: 'failure', description: failDesc },
            [good]: { state: 'failure', description: failDesc },
          },
        }
      );
      expect(deferred.status, deferred.stderr).toBe(0);
      expect(deferred.stdout).toContain(
        `DEFERRED: ${bad} already failed Backup certification deterministically`
      );
      expect(deferred.out).toContain('deferred=1\n');
      expect(deferred.calls).toContain('LEASE_RELEASED');
    }

    // 3. NEVER skip on `error`, changed migrations, changed serving, changed backup_projection, or manual dispatch!
    const retryCases: Array<{
      label: string;
      env?: Record<string, string>;
      status: { state: string; description: string };
      liveServing?: string;
    }> = [
      {
        label: 'error status',
        status: { state: 'error', description: failDesc },
      },
      {
        label: 'changed migrations digest',
        status: {
          state: 'failure',
          description: `Backup Engine refused: hand_gap_unintended_delay_exceeded; installed migrations ${'0'.repeat(12)} serving ${serving.slice(0, 12)} proj ${proj12}`,
        },
      },
      {
        label: 'changed live serving SHA',
        status: { state: 'failure', description: failDesc },
        liveServing: '9'.repeat(40),
      },
      {
        label: 'changed backup_projection',
        status: {
          state: 'failure',
          description: `Backup Engine refused: hand_gap_unintended_delay_exceeded; installed migrations ${comp.slice(0, 12)} serving ${serving.slice(0, 12)} proj ${'f'.repeat(12)}`,
        },
      },
      {
        label: 'manual workflow_dispatch without after_cycle',
        env: { EVENT: 'workflow_dispatch', AFTER_CYCLE: '', INPUT_SHA: '' },
        status: { state: 'failure', description: failDesc },
      },
      {
        label: 'manual workflow_dispatch with explicit INPUT_SHA',
        env: { EVENT: 'workflow_dispatch', AFTER_CYCLE: '2026-11-28T07', INPUT_SHA: bad },
        status: { state: 'failure', description: failDesc },
      },
    ];
    for (const tc of retryCases) {
      const r = runDueStep(
        f,
        { EVENT: 'push', SHA: bad, CONTROL: bad, GITHUB_SHA: bad, ...(tc.env ?? {}) },
        {
          copyMatchesProduction: true,
          prequal: { [bad]: 'passed', [good]: 'passed' },
          statuses: { [bad]: tc.status, [good]: tc.status },
          liveServing: tc.liveServing,
        }
      );
      expect(r.status, `${tc.label}: ${r.stderr}`).toBe(0);
      expect(r.stdout, tc.label).not.toContain('DEFERRED:');
      expect(r.stdout, tc.label).not.toContain('STEPPED DOWN:');
      expect(r.out, tc.label).not.toContain('deferred=1');
      expect(r.calls, tc.label).not.toContain('LEASE_RELEASED');
    }
  }, 90_000);

  it('stage-engine-release.yml sends refresh=false on Backup after keep-serving (letting due refresh only when contents_due)', () => {
    const nextJob = stage.jobs['next-candidate-after-cycle'];
    const intentStep = nextJob.steps.find((s: any) => s.id === 'intent');
    expect(String(intentStep.run)).toContain(
      '--input "after_cycle=$RELEASE_DATE" --input refresh=false'
    );
    expect(String(intentStep.run)).toContain('.inputs.refresh == "false"');

    const sendJob = stage.jobs['start-backup-as-estate-app'];
    const decideStep = sendJob.steps.find((s: any) => s.id === 'decide');
    const sendStep = sendJob.steps.find((s: any) => String(s.run ?? '').includes('/dispatches'));
    expect(String(decideStep.run)).toContain('.inputs.refresh == "false"');
    expect(String(sendStep.run)).toContain('refresh: "false"');
    expect(String(sendStep.run)).toContain('.inputs.refresh == "false"');
  });
});

describe('FM5: select-daily-engine.py classifies completed-run orphaned pending as stale-pending while preserving O1/O35 no-failure-on-yield', () => {
  it('reports stale-pending when the pending status run has completed, keeps pending when active or unreadable, and preserves YIELDED_OBSOLETE no-status invariant', () => {
    const publishStep = backup.jobs.certify.steps.find((s: any) =>
      /Publish the verdict/.test(s.name)
    );
    expect(String(publishStep.run)).toContain('if [ "${YIELDED:-}" = 1 ]; then');
    expect(String(publishStep.run)).toContain('writing no failure or error status');

    const py = `
import importlib.util, json, subprocess
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sel', ${JSON.stringify(resolve(ROOT, 'scripts/ci/select-daily-engine.py'))})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

base = {
    'state': 'PENDING',
    'createdAt': '2026-11-28T10:00:00Z',
    'description': 'Backup Engine is building, booting and soaking this version',
    'targetUrl': 'https://github.com/o/r/actions/runs/46159636068',
}
limit = mod.cutoff('2026-11-28T10')

with patch.object(mod, 'api', return_value={'id': 46159636068, 'status': 'completed', 'conclusion': 'success'}):
    completed = mod.refusal_of(base, limit, repo='o/r')
    refused = []
    assert mod.backup('o/r', 'a' * 40, limit, base, refused) is None
    backup_completed = refused[0]

with patch.object(mod, 'api', return_value={'id': 46159636068, 'status': 'in_progress', 'conclusion': None}):
    active = mod.refusal_of(base, limit, repo='o/r')

with patch.object(mod, 'api', side_effect=subprocess.CalledProcessError(1, ['gh'])):
    unreadable = mod.refusal_of(base, limit, repo='o/r')

print(json.dumps({
    'completed': completed,
    'backup_completed': backup_completed,
    'active': active,
    'unreadable': unreadable,
}))
`;
    const r = spawnSync('python3', ['-B', '-c', py], { encoding: 'utf8', env: cleanEnv() });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.completed).toBe(
      'Backup certificate is stale-pending (run 46159636068 completed without verdict)'
    );
    expect(out.backup_completed).toBe(
      'Backup certificate is stale-pending (run 46159636068 completed without verdict)'
    );
    expect(out.active).toBe(
      'Backup certificate is pending: Backup Engine is building, booting and soaking this version'
    );
    expect(out.unreadable).toBe(
      'Backup certificate is pending: Backup Engine is building, booting and soaking this version'
    );
  });
});
