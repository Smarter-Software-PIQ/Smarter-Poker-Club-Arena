/** Owner 2026-11-06: isolated Backup qualification, daily-only replacement. */
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
// A pre-push hook exports GIT_DIR and friends; a step reading a disposable
// fixture repository must not be pointed at the repository being pushed.
const hookFreeEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
function planShell(script: string, env: NodeJS.ProcessEnv, cwd?: string) {
  const dir = mkdtempSync(resolve(tmpdir(), 'backup-plan-'));
  const output = resolve(dir, 'github-output');
  try {
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      cwd,
      env: { ...hookFreeEnv(), ...env, GITHUB_OUTPUT: output },
    });
    let emitted = '';
    try {
      emitted = readFileSync(output, 'utf8');
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { ...result, stdout: result.stdout + emitted };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const receiver = parse(read('.github/workflows/auto-deploy-hetzner.yml'));
const backup = parse(read('.github/workflows/backup-engine.yml'));
const stage = parse(read('.github/workflows/stage-engine-release.yml'));
const transaction = read('server/scripts/engine-release-transaction.sh');
const gate = receiver.jobs.preflight.steps.find((s: any) => s.id === 'daily_release');
const clock = transaction
  .split('daily_cutover_clock() {\n')[1]
  .split("python3 -c '\n")[1]
  .split("\n'\n}")[0];
function clockAt(stamp: string) {
  const prefix = `import datetime\noriginal=datetime.datetime\nclass Clock(original):\n @classmethod\n def now(cls,tz=None):\n  return original.fromisoformat(${JSON.stringify(stamp)}).astimezone(tz)\ndatetime.datetime=Clock\n`;
  return spawnSync('python3', ['-c', prefix + clock], { encoding: 'utf8' });
}
describe('Backup qualification and the daily release are separate authorities', () => {
  it('requires the exact Backup certificate before daily or protected November 7 admission', () => {
    const steps = receiver.jobs.preflight.steps;
    expect(steps.indexOf(gate)).toBe(
      steps.findIndex((s: any) => s.id === 'backup_certificate') + 1
    );
    expect(gate.if).toBeUndefined();
    expect(gate['continue-on-error']).toBeUndefined();
    expect(gate.run).toContain('now.hour == 3 and 30 <= now.minute < 50');
    expect(gate.run).toContain('policy.get("phase1Status") not in ("off", "complete")');
    expect(gate.env.CONTROL_SHA).toBe('${{ github.sha }}');
    expect(gate.run).toContain(
      'git merge-base --is-ancestor "$CONTROL_SHA" refs/remotes/origin/main'
    );
    expect(gate.run).toContain(
      'git show "$CONTROL_SHA:server/scripts/engine-release-activation-floor.py"'
    );
    expect(gate.run).toContain('nov7-owner --repo . --target "$TARGET_SHA"');
    expect(gate.run).toContain('*) exit "$gate_status" ;;');
    expect(receiver.jobs.deploy.needs).toContain('preflight');
  });
  it.each([
    ['2026-11-06T09:30:00+00:00', 'off', 0],
    ['2026-11-06T09:49:59+00:00', 'complete', 0],
    ['2026-03-08T08:30:00+00:00', 'off', 0],
    ['2026-11-06T09:29:59+00:00', 'off', 3],
    ['2026-11-06T09:50:00+00:00', 'off', 3],
    ['2026-11-06T20:00:00+00:00', 'off', 3],
    ['2026-11-06T09:30:00+00:00', 'active', 1],
  ])('executes receiver admission for %s / %s', (stamp, status, expected) => {
    const code = gate.run.split("<<'PYTHON' || gate_status=$?\n")[1].split('\nPYTHON')[0];
    const prefix = `import datetime, subprocess, os\noriginal=datetime.datetime\nclass Clock(original):\n @classmethod\n def now(cls,tz=None):\n  return original.fromisoformat(${JSON.stringify(stamp)}).astimezone(tz)\ndatetime.datetime=Clock\nos.environ['TARGET_SHA']='a'*40\nsubprocess.check_output=lambda *a,**k: ${JSON.stringify(JSON.stringify({ phase1Status: status }))}\n`;
    const result = spawnSync('python3', ['-c', prefix + code], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(expected);
  });
  it.each([
    [0, 91, 0, false],
    [1, 0, 1, false],
    [3, 91, 91, true],
    [3, 0, 0, true],
  ])(
    'propagates the owner validator result only outside daily preparation',
    (daily, owner, exit, called) => {
      const dir = mkdtempSync(resolve(tmpdir(), 'receiver-owner-'));
      try {
        const harness = `git() { return 0; }
python3() {
  if [ "$1" = - ]; then cat >/dev/null; return "$DAILY_RESULT"; fi
  [ "$1" = -B ] && [ "$3" = nov7-owner ] && [ "$6" = --target ] && [ "$7" = "$TARGET_SHA" ] &&
    [ "$8" = --control ] && [ "$9" = "$CONTROL_SHA" ] || return 92
  echo owner-validator
  return "$OWNER_RESULT"
}
`;
        const result = spawnSync('bash', ['-c', harness + gate.run], {
          encoding: 'utf8',
          env: {
            ...process.env,
            RUNNER_TEMP: dir,
            CONTROL_SHA: 'a'.repeat(40),
            TARGET_SHA: 'b'.repeat(40),
            DAILY_RESULT: String(daily),
            OWNER_RESULT: String(owner),
          },
        });
        expect(result.status, result.stderr).toBe(exit);
        expect(result.stdout.includes('owner-validator')).toBe(called);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  it('removes hourly publication and runtime policy without claiming programme completion', () => {
    expect(stage.on.schedule.every((s: any) => s.cron !== '30 * * * *')).toBe(true);
    const admission = stage.jobs.detect.steps.find((s: any) => s.id === 'admission').run;
    expect(admission).toContain('[ "$daily_preparation" = true ] && allowed=true');
    expect(admission).not.toContain('allowed=true\n          elif');
    const policy = JSON.parse(read('server/src/maintenance/maintenanceSchedulePolicy.json'));
    expect(policy.phase1Status).toBe('off');
    expect(policy.completionEvidence).toContain('Hourly exception revoked');
  });
  it.each([
    '2026-11-06T10:00:00+00:00',
    '2026-11-06T10:04:59+00:00',
    '2026-03-08T09:00:00+00:00',
    '2026-11-01T10:00:00+00:00',
  ])('admits the Chicago daily boundary %s', (stamp) => {
    expect(clockAt(stamp).status).toBe(0);
  });
  it.each([
    '2026-11-06T09:59:59+00:00',
    '2026-11-06T10:05:00+00:00',
    '2026-11-06T11:00:00+00:00',
    '2026-11-06T20:00:00+00:00',
    '2026-03-08T10:00:00+00:00',
    '2026-11-01T09:00:00+00:00',
  ])('refuses all other windows %s', (stamp) => {
    expect(clockAt(stamp).status).toBe(1);
  });
  it('checks the host clock before checkpoint, certificate and actual replacement', () => {
    expect(transaction).toContain(
      'maintenance_certificate() {\n  daily_cutover_clock || nov7_owner_admitted || return 1'
    );
    expect(transaction).toContain(
      'legacy_checkpoint_countdown() {\n  daily_cutover_clock || return 1'
    );
    expect(transaction).toContain(
      "PREPARED=1\nrequire_backup_certificate || die 'exact target Backup certificate is not currently successful; no replacement authorized'\ndaily_cutover_clock || nov7_owned_countdown || die 'engine replacement requires the daily window or the reserved Nov 7 countdown'"
    );
    expect(transaction).toContain('request_recovery_window() {\n  nov7_owner_admitted || return 0');
  });
  it('ordinary releases never request an extra pause', () => {
    const request = transaction.slice(
      transaction.indexOf('request_recovery_window() {'),
      transaction.indexOf('persist_break_deadline() {')
    );
    const result = spawnSync(
      'bash',
      [
        '-c',
        `set -eu\n${transaction.slice(transaction.indexOf('nov7_owner_admitted() {'), transaction.indexOf('nov7_owned_countdown() {'))}\n${request}\ncurl() { echo forbidden-read; return 99; }\ndaily_cutover_clock() { echo forbidden-clock; return 99; }\nrequest_recovery_window`,
      ],
      { encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
  });
  it.each([
    ['valid', true, true],
    ['replay', true, false],
    ['foreign attempt', false, false],
    ['unsealed', false, false],
    ['missing receipt job', false, false],
    ['stale instance', false, false],
    ['unreadable custody', false, false],
  ])('checks the post-release clone request for %s', (scenario, ok, claimed) => {
    const sha = 'b'.repeat(40);
    const instance = '123-abcd1234';
    const parent = {
      path: '.github/workflows/auto-deploy-hetzner.yml',
      event: 'repository_dispatch',
      head_branch: 'main',
      display_title: 'Engine Release ' + sha,
      run_attempt: scenario === 'foreign attempt' ? 2 : 1,
      created_at: '2026-11-09T19:28:00Z',
    };
    const jobs = {
      jobs: [
        {
          name: 'Record The Append-Only Engine Release Receipt',
          conclusion: scenario === 'missing receipt job' ? 'failure' : 'success',
        },
        {
          name: 'Publish Through Hetzner Club Arena',
          conclusion: 'success',
          steps: [
            {
              name: 'Read original sealed runtime for the post-deploy gameplay observer',
              conclusion: 'success',
            },
          ],
        },
      ],
    };
    const runs = {
      workflow_runs:
        scenario === 'unreadable custody'
          ? []
          : [{ id: scenario === 'replay' ? 80 : 99, display_title: 'Backup after seal 11-1' }],
    };
    const shell = `gh() { case "$*" in *workflows/backup-engine.yml*) echo '${JSON.stringify(runs)}';; *jobs?*) echo '${JSON.stringify(jobs)}';; *) echo '${JSON.stringify(parent)}';; esac; }
curl() { echo '${JSON.stringify({ running: true, releaseSha: sha, instanceId: scenario === 'stale instance' ? '111-aaaaaaaa' : instance })}'; }
`;
    const result = planShell(shell + backup.jobs.plan.steps.find((s: any) => s.id === 'seal').run, {
      TARGET: sha,
      RUN_KEY: '11-1',
      RECEIPT: JSON.stringify({
        runId: '11-1',
        sha,
        result: scenario === 'unsealed' ? 'rollback' : 'sealed',
        completionRuntime: { instanceId: instance },
      }),
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '99',
      GITHUB_RUN_ATTEMPT: '1',
    });
    expect(result.status === 0, result.stderr).toBe(ok);
    expect(result.stdout.includes('sha=' + sha)).toBe(claimed);
  });
  it.each(['a'.repeat(40), 'b'.repeat(40)])(
    'keeps queued push candidate %s instead of moving main',
    (candidate) => {
      const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
      const result = planShell(
        'git() { echo unexpected-mutable-main-read >&2; return 99; }\ngh() { echo 0; }\n' + plan,
        {
          EVENT: 'push',
          INPUT_SHA: '',
          INPUT_REFRESH: 'false',
          GITHUB_SHA: candidate,
          RUN_ID: '500',
          GITHUB_REPOSITORY: 'o/r',
        }
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('sha=' + candidate);
      expect(result.stdout).toContain('refresh=auto');
      for (const step of backup.jobs.certify.steps) {
        if (step.env?.SHA) expect(step.env.SHA).toBe('${{ needs.plan.outputs.sha }}');
      }
    }
  );
  // 2026-11-07: a queued push run that a newer push has replaced finishes
  // in seconds with nothing planned, so the Backup host and the post-seal
  // clone refresh never wait hours behind stale certifications.
  describe('a superseded push run plans nothing and skips the Backup host', () => {
    const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
    const candidate = 'a'.repeat(40);
    const base = {
      INPUT_SHA: '',
      INPUT_REFRESH: 'false',
      GITHUB_SHA: candidate,
      RUN_ID: '500',
      GITHUB_REPOSITORY: 'o/r',
    };
    it('asks GitHub only for newer push runs of this workflow, by run id, and never by reading main', () => {
      expect(plan).toContain('if [ "$EVENT" = push ] && [[ "${RUN_ID:-}" =~ ^[0-9]+$ ]]; then');
      expect(plan).toContain('actions/workflows/backup-engine.yml/runs?event=push&branch=main');
      expect(plan).toContain('select(.id > $RUN_ID and .head_sha != \\"$sha\\")');
      expect(backup.jobs.plan.steps.find((s: any) => s.id === 'plan').env.RUN_ID).toBe(
        '${{ github.run_id }}'
      );
      expect(backup.jobs.plan.steps.find((s: any) => s.id === 'plan').env.GH_TOKEN).toBe(
        '${{ github.token }}'
      );
      expect(backup.jobs.refresh.if).toBe(
        "needs.plan.outputs.sha != '' && (!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && github.triggering_actor == 'github-actions[bot]') || (github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e'))"
      );
      expect(backup.jobs.certify.if).toBe(
        "always() && needs.plan.outputs.sha != '' && (!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && github.triggering_actor == 'github-actions[bot]') || (github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e'))"
      );
    });
    it('skips when a newer push run exists: empty sha, no status, exit 0', () => {
      const result = planShell(
        'git() { echo unexpected-main-read >&2; return 99; }\ngh() { echo 2; }\n' + plan,
        { ...base, EVENT: 'push' }
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('SUPERSEDED: 2 newer push run(s)');
      expect(result.stdout).toMatch(/\nsha=\n/);
      expect(result.stdout).not.toContain('sha=' + candidate);
      expect(result.stdout).not.toContain('refresh=auto');
    });
    it('proceeds as today when GitHub cannot be read', () => {
      const result = planShell('gh() { echo "HTTP 403" >&2; return 1; }\n' + plan, {
        ...base,
        EVENT: 'push',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('could not read this workflow');
      expect(result.stdout).toContain('sha=' + candidate);
      expect(result.stdout).toContain('refresh=auto');
    });
    it('proceeds when the answer is not a count', () => {
      const result = planShell('gh() { echo "not json"; }\n' + plan, { ...base, EVENT: 'push' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('sha=' + candidate);
    });
    it.each([
      ['workflow_dispatch', { INPUT_SHA: candidate }],
      ['schedule', {}],
      ['repository_dispatch', { SEALED_SHA: candidate }],
    ])('never skips a %s run even with newer push runs queued', (event, extra) => {
      const result = planShell(
        `gh() { echo 9; }\ngit() { printf '%s\\trefs/heads/main\\n' ${candidate}; }\ncurl() { printf '%s' '${JSON.stringify({ releaseSha: candidate })}'; }\n` +
          plan,
        { ...base, ...extra, EVENT: event }
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain('SUPERSEDED');
      expect(result.stdout).toContain('sha=' + candidate);
    });
  });
  // 2026-11-07: the push run that does start certifies only what can still
  // ship: main's newest server commit (the stage lane's offered tree), and
  // never a commit that already carries a success certificate.
  describe('a starting push run certifies the newest server commit, once', () => {
    const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
    const pushed = 'a'.repeat(40);
    const newest = 'b'.repeat(40);
    const base = {
      INPUT_SHA: '',
      INPUT_REFRESH: 'false',
      GITHUB_SHA: pushed,
      RUN_ID: '500',
      GITHUB_REPOSITORY: 'o/r',
    };
    // A fake GitHub: no newer push run, main's newest server commit HEAD,
    // compare status REL, and the certificate state per sha in CERT_<sha8>.
    const fakeGh = (head: string, rel: string, certs: Record<string, string> = {}) =>
      `gh() {
  echo "gh $*" >> "$CALLS"
  case "$2" in
    *actions/workflows/backup-engine.yml/runs*) echo 0 ;;
    *'/commits?sha=main&path=server&per_page=1') echo '${head}' ;;
    *'/compare/'*) echo '${rel}' ;;
${Object.entries(certs)
  .map(([sha, state]) => `    *'/commits/${sha}/statuses'*) echo '${state}' ;;`)
  .join('\n')}
    *'/statuses'*) echo missing ;;
    *) return 1 ;;
  esac
}
git() { echo unexpected-main-read >&2; return 99; }
`;
    function run(harness: string, env: Record<string, string>) {
      const dir = mkdtempSync(resolve(tmpdir(), 'backup-calls-'));
      const calls = resolve(dir, 'calls');
      try {
        const result = planShell(harness + plan, { ...env, CALLS: calls });
        const log = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
        return { ...result, calls: log };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    it('reads the same server tree the stage lane offers', () => {
      expect(stage.jobs.detect.steps.find((s: any) => s.id === 'change').run).toContain(
        `TARGET_SHA=$(git log "$AFTER_SHA" -1 --format=%H -- 'server/**')`
      );
      expect(plan).toContain('commits?sha=main&path=server&per_page=1');
      expect(plan).toContain('[ "$rel" = ahead ]');
    });
    it('(a) a stale push run certifies the newest server commit on main instead', () => {
      const result = run(fakeGh(newest, 'ahead'), { ...base, EVENT: 'push' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`RETARGETED: pushed ${pushed} is superseded by ${newest}`);
      expect(result.stdout).toContain('sha=' + newest);
      expect(result.stdout).toContain('control_sha=' + newest);
      expect(result.stdout).not.toContain('sha=' + pushed);
      expect(result.stdout).toContain('refresh=auto');
      expect(result.calls).toContain(`/compare/${pushed}...${newest}`);
      expect(result.calls).toContain(`/commits/${newest}/statuses`);
    });
    it('a migration push retains its exact pair when the newest server commit is older', () => {
      const qualification = parse(
        readFileSync(
          resolve(process.cwd(), '.github/workflows/engine-release-prequalification.yml'),
          'utf8'
        )
      );
      for (const producer of [backup, qualification]) {
        expect(producer.on.push.branches).toEqual(['main']);
        expect(producer.on.push.paths).toContain('supabase/migrations/**');
        expect(producer.on.push.paths).not.toContain('src/**');
      }
      const result = run(fakeGh(newest, 'behind', { [newest]: 'success' }), {
        ...base,
        EVENT: 'push',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('sha=' + pushed);
      expect(result.stdout).toContain('refresh=auto');
      expect(result.stdout).not.toContain('RETARGETED');
      expect(result.stdout).not.toContain('ALREADY CERTIFIED');
      expect(result.calls).toContain(`/commits/${pushed}/statuses`);
      expect(result.calls).not.toContain(`/commits/${newest}/statuses`);
    });
    it.each([
      ['not a descendant', newest, 'diverged'],
      ['unreadable compare', newest, ''],
      ['unreadable main', 'HTTP 502', 'ahead'],
      ['already the newest', pushed, 'identical'],
    ])('keeps the pushed commit when %s', (_label, head, rel) => {
      const result = run(fakeGh(head, rel), { ...base, EVENT: 'push' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain('RETARGETED');
      expect(result.stdout).toContain('sha=' + pushed);
    });
    it('(b) workflow_dispatch with an explicit sha certifies exactly that sha', () => {
      const result = run(fakeGh(newest, 'ahead', { [pushed]: 'success' }), {
        ...base,
        GITHUB_SHA: newest,
        INPUT_SHA: pushed,
        EVENT: 'workflow_dispatch',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('sha=' + pushed);
      expect(result.stdout).not.toContain('RETARGETED');
      expect(result.stdout).not.toContain('ALREADY CERTIFIED');
      expect(result.calls).toBe('');
    });
    it('(c) a target an earlier run already certified is not certified twice', () => {
      for (const [head, rel] of [
        [newest, 'ahead'],
        [pushed, 'identical'],
      ]) {
        const result = run(fakeGh(head, rel, { [head]: 'success' }), { ...base, EVENT: 'push' });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(`ALREADY CERTIFIED: ${head}`);
        expect(result.stdout).toMatch(/\nsha=\n/);
        expect(result.stdout).not.toContain('sha=' + head);
        expect(result.stdout).not.toContain('refresh=auto');
      }
    });
    it('(c) an older run with a newer push run queued retires without certifying', () => {
      const result = run(fakeGh(newest, 'ahead').replace('runs*) echo 0', 'runs*) echo 1'), {
        ...base,
        EVENT: 'push',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('SUPERSEDED: 1 newer push run(s)');
      expect(result.stdout).toMatch(/\nsha=\n/);
      expect(result.calls).not.toContain('/compare/');
    });
    it.each(['failure', 'pending', 'missing', 'HTTP 403'])(
      'certifies again when the target certificate is %s',
      (state) => {
        const result = run(fakeGh(newest, 'ahead', { [newest]: state }), {
          ...base,
          EVENT: 'push',
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('sha=' + newest);
        expect(result.stdout).not.toContain('ALREADY CERTIFIED');
      }
    );
  });
  // 2026-11-07: a certificate follows identical engine source. The plan job
  // inherits backup-engine/certified = success from a first-parent ancestor
  // whose engine source identity (the Dockerfile's COPY set, the Dockerfile
  // and the identity script) equals the candidate's; everything else builds.
  describe('a certificate follows identical engine source', () => {
    const planStep = backup.jobs.plan.steps.find((s: any) => s.id === 'plan');
    const checkout = backup.jobs.plan.steps.find((s: any) =>
      s.uses?.startsWith('actions/checkout')
    );
    const inherit = backup.jobs.plan.steps.find((s: any) => s.id === 'inherit');
    const identityScript = read('scripts/ci/engine-source-identity.sh');
    const candidate = 'a'.repeat(40);
    const pushBase = {
      INPUT_SHA: '',
      INPUT_REFRESH: 'false',
      GITHUB_SHA: candidate,
      RUN_ID: '500',
      GITHUB_REPOSITORY: 'o/r',
    };
    /** A repo whose engine identity is readable at every commit after C0. */
    function fixture(options: { scriptFrom?: 'c1' } = {}) {
      const dir = mkdtempSync(resolve(tmpdir(), 'engine-identity-'));
      const cleanEnv = hookFreeEnv();
      const git = (...args: string[]) => {
        const r = spawnSync('git', args, {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...cleanEnv,
            GIT_AUTHOR_NAME: 't',
            GIT_AUTHOR_EMAIL: 't@t',
            GIT_COMMITTER_NAME: 't',
            GIT_COMMITTER_EMAIL: 't@t',
            GIT_CONFIG_GLOBAL: '/dev/null',
          },
        });
        if (r.status !== 0) throw new Error(r.stderr);
        return r.stdout.trim();
      };
      const write = (p: string, body: string) => {
        mkdirSync(resolve(dir, p, '..'), { recursive: true });
        writeFileSync(resolve(dir, p), body);
      };
      const commit = (msg: string) => {
        git('add', '-A');
        git('commit', '-q', '-m', msg);
        return git('rev-parse', 'HEAD');
      };
      git('init', '-q', '-b', 'main');
      write(
        'scripts/ci/read-engine-prequalification.py',
        read('scripts/ci/read-engine-prequalification.py')
      );
      if (!options.scriptFrom) write('scripts/ci/engine-source-identity.sh', identityScript);
      write(
        'server/Dockerfile',
        [
          'FROM node:22-slim@sha256:abc AS builder',
          'COPY native/kernel.cc ./native/kernel.cc',
          'FROM node:22-slim@sha256:abc',
          'COPY package.json \\',
          '     package-lock.json ./',
          'COPY --from=builder /native-build/kernel.node ./native/kernel.node',
          'COPY --chown=node:node src/ ./src/',
          'COPY release-evidence/ ./release-evidence/',
          'CMD ["node", "dist/index.js"]',
        ].join('\n') + '\n'
      );
      write('server/package.json', '{"name":"engine"}\n');
      write('server/package-lock.json', '{"lockfileVersion":3}\n');
      write('server/native/kernel.cc', 'int main() {}\n');
      write('server/src/index.ts', 'export const v = 1;\n');
      write('server/src/index.test.ts', 'test 1\n');
      write('server/release-evidence/r.json', '{}\n');
      write('server/tests/engine.test.ts', 'test 1\n');
      write('server/standby/standby-engine.sh', 'echo standby 1\n');
      write('server/README.md', 'docs 1\n');
      const shas: Record<string, string> = {};
      shas.c0 = commit('c0: base');
      if (options.scriptFrom) write('scripts/ci/engine-source-identity.sh', identityScript);
      write('server/src/index.ts', 'export const v = 2;\n');
      shas.c1 = commit('c1: engine source changes');
      write('server/tests/engine.test.ts', 'test 2\n');
      shas.c2 = commit('c2: outside the image');
      write('server/README.md', 'docs 2\n');
      shas.c3 = commit('c3: docs only');
      const identity = (sha: string, ...extra: string[]) =>
        spawnSync('bash', ['scripts/ci/engine-source-identity.sh', sha, ...extra], {
          cwd: dir,
          encoding: 'utf8',
          env: cleanEnv,
        });
      return { dir, git, write, commit, shas, identity };
    }
    it('is wired: push-only eligibility, a blobless checkout of the candidate, outputs that plan nothing when inherited', () => {
      expect(backup.permissions.statuses).toBe('write');
      expect(planStep.run).toContain('echo "inherit_eligible=true" >> "$GITHUB_OUTPUT"');
      expect(planStep.run.indexOf('SUPERSEDED:')).toBeLessThan(
        planStep.run.indexOf('inherit_eligible=true')
      );
      expect(checkout.if).toBe("steps.plan.outputs.inherit_eligible == 'true'");
      expect(checkout.with.ref).toBe('${{ steps.plan.outputs.sha }}');
      expect(checkout.with.filter).toBe('blob:none');
      expect(inherit.if).toBe("steps.plan.outputs.inherit_eligible == 'true'");
      expect(inherit.env.SHA).toBe('${{ steps.plan.outputs.sha }}');
      expect(inherit.env.GH_TOKEN).toBe('${{ github.token }}');
      expect(inherit.run).toContain('bash scripts/ci/engine-source-identity.sh "$SHA"');
      expect(inherit.run).toContain(
        'git rev-list --first-parent --skip=1 --max-count="$DEPTH" "$SHA"'
      );
      expect(inherit.run).toContain('-f state=success -f context="$STATUS_CONTEXT"');
      expect(backup.jobs.plan.outputs.sha).toBe(
        "${{ steps.inherit.outputs.inherited != 'true' && steps.plan.outputs.sha || '' }}"
      );
      expect(backup.jobs.plan.outputs.refresh).toBe(
        "${{ steps.inherit.outputs.inherited != 'true' && steps.plan.outputs.refresh || '' }}"
      );
    });
    it('the plan step offers inheritance only to a push run that is not superseded', () => {
      const newest = planShell('gh() { echo 0; }\n' + planStep.run, { ...pushBase, EVENT: 'push' });
      expect(newest.status, newest.stderr).toBe(0);
      expect(newest.stdout).toContain('inherit_eligible=true');
      const superseded = planShell('gh() { echo 2; }\n' + planStep.run, {
        ...pushBase,
        EVENT: 'push',
      });
      expect(superseded.status).toBe(0);
      expect(superseded.stdout).toContain('SUPERSEDED');
      expect(superseded.stdout).not.toContain('inherit_eligible');
    });
    it.each([
      ['workflow_dispatch', { INPUT_SHA: candidate }],
      ['schedule', {}],
      ['repository_dispatch', { SEALED_SHA: candidate }],
    ])('a %s run never inherits', (event, extra) => {
      const result = planShell(
        `gh() { echo 0; }\ngit() { printf '%s\\trefs/heads/main\\n' ${candidate}; }\ncurl() { printf '%s' '${JSON.stringify({ releaseSha: candidate })}'; }\n` +
          planStep.run,
        { ...pushBase, ...extra, EVENT: event }
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('sha=' + candidate);
      expect(result.stdout).not.toContain('inherit_eligible');
    });
    describe('the identity script', () => {
      const f = fixture();
      afterAll(() => rmSync(f.dir, { recursive: true, force: true }));
      it('is deterministic and names only the Dockerfile COPY sources, the Dockerfile and itself', () => {
        const a = f.identity(f.shas.c1, '--manifest');
        expect(a.status, a.stderr).toBe(0);
        const lines = a.stdout.trim().split('\n');
        const identity = lines.pop()!;
        expect(identity).toMatch(/^[0-9a-f]{64}$/);
        expect(lines[0]).toMatch(/^identity-script [0-9a-f]{40}$/);
        expect(lines[1]).toMatch(/^dockerfile [0-9a-f]{40}$/);
        expect(lines.slice(2).map((l) => l.split(' ')[1])).toEqual([
          'native/kernel.cc',
          'package-lock.json',
          'package.json',
          'release-evidence',
          'src',
        ]);
        expect(lines.some((l) => l.includes('kernel.node'))).toBe(false);
        expect(f.identity(f.shas.c1).stdout.trim()).toBe(identity);
      });
      it('changes when an enumerated input changes and not when anything outside it does', () => {
        const id = (s: string) => f.identity(s).stdout.trim();
        expect(id(f.shas.c0)).not.toBe(id(f.shas.c1));
        expect(id(f.shas.c2)).toBe(id(f.shas.c1));
        expect(id(f.shas.c3)).toBe(id(f.shas.c1));
        f.write('server/src/index.test.ts', 'test 2\n');
        const srcTest = f.commit('a test under src ships in the image');
        expect(id(srcTest)).not.toBe(id(f.shas.c3));
        f.write('server/package-lock.json', '{"lockfileVersion":3,"x":1}\n');
        const lock = f.commit('lockfile');
        expect(id(lock)).not.toBe(id(srcTest));
        f.write('server/release-evidence/r.json', '{"a":1}\n');
        const evidence = f.commit('evidence');
        expect(id(evidence)).not.toBe(id(lock));
      });
      it('changes when the Dockerfile COPY set or the script itself changes', () => {
        const id = (s: string) => f.identity(s).stdout.trim();
        const before = f.git('rev-parse', 'HEAD');
        f.write(
          'server/Dockerfile',
          readFileSync(resolve(f.dir, 'server/Dockerfile'), 'utf8') + 'COPY tests/ ./tests/\n'
        );
        const widened = f.commit('copy tests too');
        expect(id(widened)).not.toBe(id(before));
        expect(f.identity(widened, '--manifest').stdout).toContain('copy tests ');
        f.write('scripts/ci/engine-source-identity.sh', identityScript + '# revised\n');
        const revised = f.commit('identity script revised');
        expect(id(revised)).not.toBe(id(widened));
      });
      it('answers nothing for a commit that cannot be read, a non-sha, or one without the script or Dockerfile', () => {
        expect(f.identity('f'.repeat(40)).status).not.toBe(0);
        expect(f.identity('HEAD').status).not.toBe(0);
        expect(f.identity('f'.repeat(40)).stdout).toBe('');
        f.git('rm', '-q', 'server/Dockerfile');
        const noDockerfile = f.commit('dockerfile gone');
        expect(f.identity(noDockerfile).status).not.toBe(0);
        expect(f.identity(noDockerfile).stdout).toBe('');
      });
    });
    describe('the inherit step', () => {
      const f = fixture();
      afterAll(() => rmSync(f.dir, { recursive: true, force: true }));
      const env = (sha: string) => ({
        SHA: sha,
        DEPTH: '60',
        GH_TOKEN: 'fake',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_SERVER_URL: 'https://github.test',
        GITHUB_RUN_ID: '500',
        STATUS_CONTEXT: backup.env.STATUS_CONTEXT,
      });
      /** gh stub: `states` maps ancestor sha -> newest certified state; writes are logged. */
      const gh = (states: Record<string, string>, writeRc = 0) =>
        `gh() {
  echo "gh $*" >&2
  case "$2" in
    repos/o/r/statuses/*) return ${writeRc} ;;
    repos/o/r/commits/*/statuses*) ;;
    *) echo "unexpected gh call: $*" >&2; return 99 ;;
  esac
  local sha; sha=\${2#repos/o/r/commits/}; sha=\${sha%%/*}
  case "$sha" in
${Object.entries(states)
  .map(([s, st]) => `    ${s}) ${st === 'unreadable' ? 'return 1' : `echo ${st}`} ;;`)
  .join('\n')}
    *) echo missing ;;
  esac
}
`;
      it('inherits from the nearest identical ancestor holding success, passing over one with no verdict, never asking about a different identity', () => {
        const result = planShell(
          gh({ [f.shas.c1]: 'success' }) + inherit.run,
          env(f.shas.c3),
          f.dir
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(`identical ancestor ${f.shas.c2} has no verdict (missing)`);
        expect(result.stdout).toContain(
          `INHERITED: Inherited from ${f.shas.c1}: identical engine source (`
        );
        expect(result.stdout).toContain('inherited=true');
        expect(result.stderr).toContain(
          `gh api repos/o/r/statuses/${f.shas.c3} -f state=success -f context=backup-engine/certified -f description=Inherited from ${f.shas.c1}: identical engine source (`
        );
        expect(result.stderr).toContain('-f target_url=https://github.test/o/r/actions/runs/500');
        expect(result.stderr).not.toContain(`commits/${f.shas.c0}/`);
      });
      it.each([
        '.github/workflows/stage-engine-release.yml',
        'server/standby/standby-engine.sh',
        'server/standby/standby-owners.sql',
        'server/standby/seed-extract.py',
        'supabase/migrations/20261108000000.sql',
        'server/release/activation-floor.json',
      ])(
        'certifies in full when qualification input %s changes with identical image bytes',
        (path) => {
          const changed = fixture();
          try {
            changed.write(path, 'changed qualification input\n');
            const sha = changed.commit('qualification change');
            expect(changed.identity(sha).stdout).toBe(changed.identity(changed.shas.c3).stdout);
            const result = planShell(
              gh({ [changed.shas.c3]: 'failure', [changed.shas.c1]: 'success' }) + inherit.run,
              env(sha),
              changed.dir
            );
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout).toContain('qualification inputs differ');
            expect(result.stdout).toContain('inherited=false');
            expect(result.stderr).not.toContain('gh api');
          } finally {
            rmSync(changed.dir, { recursive: true, force: true });
          }
        }
      );
      it('does not reuse restore freshness after a migration tree is reverted', () => {
        const changed = fixture();
        try {
          changed.write('supabase/migrations/20261108000000.sql', 'select 1;\n');
          changed.commit('migration added');
          changed.git('rm', 'supabase/migrations/20261108000000.sql');
          const sha = changed.commit('migration reverted');
          const result = planShell(
            gh({ [changed.shas.c3]: 'success' }) + inherit.run,
            env(sha),
            changed.dir
          );
          expect(result.status, result.stderr).toBe(0);
          expect(result.stdout).toContain('qualification inputs differ');
          expect(result.stdout).toContain('inherited=false');
          expect(result.stderr).not.toContain('repos/o/r/statuses/');
        } finally {
          rmSync(changed.dir, { recursive: true, force: true });
        }
      });
      it('does not inherit when the only certified ancestor has a different identity', () => {
        const result = planShell(
          gh({ [f.shas.c0]: 'success' }) + inherit.run,
          env(f.shas.c1),
          f.dir
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('no inherited certificate: no identical ancestor');
        expect(result.stdout).toContain('inherited=false');
        expect(result.stderr).not.toContain('gh api');
      });
      it.each(['failure', 'error'])(
        'does not inherit past an identical ancestor whose newest certificate is %s, even with an older success behind it',
        (state) => {
          const result = planShell(
            gh({ [f.shas.c2]: state, [f.shas.c1]: 'success' }) + inherit.run,
            env(f.shas.c3),
            f.dir
          );
          expect(result.status, result.stderr).toBe(0);
          expect(result.stdout).toContain(
            `${f.shas.c2} is identical and its newest certificate is ${state}`
          );
          expect(result.stdout).toContain('inherited=false');
          expect(result.stderr).not.toContain(`commits/${f.shas.c1}/`);
          expect(result.stderr).not.toContain('repos/o/r/statuses/');
        }
      );
      it('does not inherit when the statuses cannot be read', () => {
        const result = planShell(
          gh({ [f.shas.c2]: 'unreadable', [f.shas.c1]: 'success' }) + inherit.run,
          env(f.shas.c3),
          f.dir
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('newest certificate is unreadable');
        expect(result.stdout).toContain('inherited=false');
        expect(result.stderr).not.toContain('repos/o/r/statuses/');
      });
      it('certifies in full when the inherited status cannot be written', () => {
        const result = planShell(
          gh({ [f.shas.c1]: 'success' }, 1) + inherit.run,
          env(f.shas.c3),
          f.dir
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('could not write the inherited certificate');
        expect(result.stdout).toContain('inherited=false');
        expect(result.stdout).not.toContain('inherited=true');
      });
      it('certifies in full when the candidate identity itself is unreadable, asking GitHub nothing', () => {
        const result = planShell(
          gh({ [f.shas.c1]: 'success' }) + inherit.run,
          env('f'.repeat(40)),
          f.dir
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('is unreadable; certifying in full');
        expect(result.stdout).toContain('inherited=false');
        expect(result.stderr).not.toContain('gh api');
      });
      it('passes over ancestors that predate the identity script without asking about them', () => {
        const late = fixture({ scriptFrom: 'c1' });
        try {
          expect(late.identity(late.shas.c0).status).not.toBe(0);
          const result = planShell(
            gh({ [late.shas.c0]: 'success' }) + inherit.run,
            env(late.shas.c3),
            late.dir
          );
          expect(result.status, result.stderr).toBe(0);
          expect(result.stdout).toContain(
            `identical ancestor ${late.shas.c1} has no verdict (missing)`
          );
          expect(result.stdout).toContain('inherited=false');
          expect(result.stderr).not.toContain(`commits/${late.shas.c0}/`);
        } finally {
          rmSync(late.dir, { recursive: true, force: true });
        }
      });
    });
  });
  it('serializes all Backup candidates and refreshes only after a successful sealed release', () => {
    expect(backup.concurrency).toEqual({
      group: expect.stringContaining("|| 'backup-engine'"),
      queue: 'max',
      'cancel-in-progress': false,
    });
    expect(backup.on.push.paths).toContain('server/**');
    expect(backup.on.workflow_run).toBeUndefined();
    expect(backup.on.repository_dispatch.types).toEqual([
      'run-post-deploy-e2e',
      'refresh-sealed-engine-backup',
    ]);
    expect(
      parse(read('.github/workflows/post-deploy-e2e.yml')).on.repository_dispatch.types
    ).not.toContain('refresh-sealed-engine-backup');
    expect(backup.jobs.plan.if).toContain("github.event.client_payload.release_run_key != ''");
    const sender = receiver.jobs['certify-production'].steps[0].run;
    expect(sender).toContain('client_payload[release_run_key]=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT');
    expect(sender).toContain('Backup after seal $GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT');
    const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
    expect(plan).toContain('sha="$SEALED_SHA"');
    expect(plan).toContain('refresh=force');
    expect(backup.jobs.certify.if).toBe(
      "always() && needs.plan.outputs.sha != '' && (!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && github.triggering_actor == 'github-actions[bot]') || (github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e'))"
    );
    const certify = backup.jobs.certify.steps.find((s: any) => s.id === 'certify');
    expect(certify.env.REFRESH_RESULT).toBe('${{ needs.refresh.result }}');
    expect(certify.run.indexOf('if [ "$REFRESH_RESULT" != success ]; then')).toBeLessThan(
      certify.run.indexOf('ssh -i')
    );
    expect(certify.run).toContain('database_refresh_failed');
    expect(backup.jobs.certify.steps.find((s: any) => s.id === 'certify').run).toContain(
      'standby-engine certify $SHA 1800'
    );
  });
});
