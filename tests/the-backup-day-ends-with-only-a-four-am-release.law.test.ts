/** Owner 2026-11-06: isolated Backup qualification, daily-only replacement. */
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
    // Since 2026-11-21 (owner order: a cutover every three hours) the gate
    // admits the 30-50 minute preparation of every scheduled cycle the
    // target's policy names: 04:00 alone for daily, the eight hours for
    // three-hourly (tests/the-engine-cuts-over-every-three-hours.law.test.ts).
    expect(gate.run).toContain('if not (30 <= now.minute < 50 and local.hour in hours');
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
    // Three-hourly target at the 04:00 anchor: admitted without reading /health.
    ['2026-11-06T09:30:00+00:00', 'off/three-hourly', 0],
    // A three-hourly target outside any preparation window keeps serving.
    ['2026-11-06T11:00:00+00:00', 'off/three-hourly', 3],
  ])('executes receiver admission for %s / %s', (stamp, status, expected) => {
    const code = gate.run.split("<<'PYTHON' || gate_status=$?\n")[1].split('\nPYTHON')[0];
    const prefix = `import datetime, subprocess, os\noriginal=datetime.datetime\nclass Clock(original):\n @classmethod\n def now(cls,tz=None):\n  return original.fromisoformat(${JSON.stringify(stamp)}).astimezone(tz)\ndatetime.datetime=Clock\nos.environ['TARGET_SHA']='a'*40\nsubprocess.check_output=lambda *a,**k: ${JSON.stringify(
      JSON.stringify(
        status === 'off/three-hourly'
          ? { phase1Status: 'off', frequency: 'three-hourly' }
          : { phase1Status: status }
      )
    )}\n`;
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
    ['own run not yet listed', true, true],
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
    // O15 (2026-11-22): GitHub's created-filtered list lags a new run by
    // seconds; Backup 45075415442 read an empty list for itself and refused
    // the 16:00 CST seal. A readable list always holds this run; only an
    // unreadable list refuses.
    const runs = {
      workflow_runs:
        scenario === 'own run not yet listed'
          ? []
          : [{ id: scenario === 'replay' ? 80 : 99, display_title: 'Backup after seal 11-1' }],
    };
    const runsReply =
      scenario === 'unreadable custody'
        ? 'echo "HTTP 502" >&2; return 1'
        : `echo '${JSON.stringify(runs)}'`;
    const shell = `gh() { case "$*" in *workflows/backup-engine.yml*) ${runsReply};; *jobs?*) echo '${JSON.stringify(jobs)}';; *) echo '${JSON.stringify(parent)}';; esac; }
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
    // Every refusal names its reason instead of a bare exit 1.
    if (!ok) expect(result.stdout).toContain('::error::');
    if (scenario === 'replay')
      expect(result.stdout).toContain('Original Backup run 80 owns sealed receiver 11-1');
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
        if (step.env?.SHA)
          expect(step.env.SHA).toBe('${{ needs.refresh.outputs.sha || needs.plan.outputs.sha }}');
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
        "needs.plan.outputs.sha != '' && (!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]')) || (github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e') || (github.event_name == 'workflow_dispatch' && inputs.after_cycle != '')) && !(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')"
      );
      expect(backup.jobs.certify.if).toBe(
        "always() && needs.plan.outputs.sha != '' && needs.refresh.outputs.deferred != '1' && (!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]')) || (github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e') || (github.event_name == 'workflow_dispatch' && inputs.after_cycle != '')) && !(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')"
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
  // 2026-11-14: on the off-cycle cutover the booked candidate waited about
  // 50 minutes behind an unrelated push, and the release owner dispatched a
  // manual run because a later ordinary push would have superseded the
  // booking commit's own push run. A push run now asks one read-only verdict
  // (scripts/ci/backup-candidate-priority.py); "unknown" changes nothing.
  // 2026-11-21: twice on 2026-11-20 a push run planned before an owner window
  // was booked took the Backup host minutes before the booking merged and
  // certified for 55 minutes while the booked build waited. The run now asks
  // again after its copy and before certify, and hands the host back when its
  // commit predates the newly booked window.
  describe('a booking made while a run waited still goes first', () => {
    const late = backup.jobs.refresh.steps.find((s: any) => s.id === 'late_priority');
    const sha = 'c'.repeat(40);
    function runLate(verdict: string) {
      const dir = mkdtempSync(resolve(tmpdir(), 'backup-late-'));
      const calls = resolve(dir, 'calls');
      const harness = `gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *contents/scripts/ci/backup-candidate-priority.py*) ${
      verdict === 'FAIL'
        ? 'echo "HTTP 502" >&2; return 1'
        : `printf '%s\\n' "print('priority=${verdict}')" "print('window=w-late')"`
    } ;;
    *) return 1 ;;
  esac
}
ssh() { echo "ssh $*" >> "$CALLS"; cat > /dev/null; }
`;
      try {
        const result = planShell(harness + late.run, {
          CALLS: calls,
          HOME: dir,
          SHA: sha,
          RUN_ID: '700',
          RUN_ATTEMPT: '1',
          SSH_KEY: 'fixture-key-not-a-credential',
          STANDBY_HOST: '192.0.2.1',
          STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
          GITHUB_REPOSITORY: 'o/r',
          GITHUB_SHA: sha,
        });
        return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    it('runs only for a push run that holds the host, after the copy and before certify', () => {
      expect(late.if).toContain("github.event_name == 'push'");
      expect(late.if).toContain("steps.turn.outputs.acquired == '1'");
      expect(late.if).toContain("steps.late_inherit.outputs.inherited != '1'");
      // Tonight's freeze baseline is the 04:00 build and never yields.
      expect(late.if).toContain("needs.plan.outputs.freeze_baseline != '1'");
      expect(backup.jobs.plan.outputs.freeze_baseline).toBe(
        '${{ steps.plan.outputs.freeze_baseline }}'
      );
      const planRun = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
      expect(planRun).toContain('echo "freeze_baseline=1" >> "$GITHUB_OUTPUT"');
      const ids = backup.jobs.refresh.steps.map((s: any) => s.id ?? s.name);
      expect(ids.indexOf('late_priority')).toBe(ids.length - 1);
      expect(backup.jobs.refresh.outputs.deferred).toBe(
        "${{ (steps.turn.outputs.superseded == '1' || steps.late_inherit.outputs.inherited == '1' || steps.due.outputs.deferred == '1' || steps.late_priority.outputs.deferred == '1') && '1' || '' }}"
      );
      expect(backup.jobs.certify.if).toContain("needs.refresh.outputs.deferred != '1'");
    });
    it('a run whose commit now predates a booked window hands the host back and certifies nothing', () => {
      const r = runLate('predates');
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('DEFERRED');
      expect(r.stdout).toContain('deferred=1');
      expect(r.calls).toMatch(/ssh .*-o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15/);
    });
    it('a post-booking push run yields the host before certify while the booking commit is uncertified', () => {
      const r = runLate('booking_pending');
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('DEFERRED');
      expect(r.stdout).toContain('deferred=1');
      expect(r.calls).toMatch(/ssh .*-o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15/);
    });
    it.each(['none', 'booking', 'candidate', 'FAIL'])(
      'NEGATIVE: "%s" keeps the host and certifies',
      (verdict) => {
        const r = runLate(verdict);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).not.toContain('DEFERRED');
        expect(r.stdout).not.toContain('deferred=1');
        expect(r.calls).not.toContain('ssh ');
      }
    );
  });

  describe('the booked candidate goes first while an owner window is live', () => {
    const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
    const pushed = 'a'.repeat(40);
    const newest = 'b'.repeat(40);
    const base = {
      INPUT_SHA: '',
      INPUT_REFRESH: 'false',
      GITHUB_SHA: pushed,
      RUN_ID: '500',
      GITHUB_REPOSITORY: 'o/r',
      EVENT: 'push',
    };
    // A fake GitHub whose priority reader answers VERDICT (a Python one-liner
    // body, or FAIL for an unreadable fetch).
    const fakeGh = (verdict: string, newer: string, rel: string, cert = 'missing') =>
      `gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *contents/scripts/ci/backup-candidate-priority.py*) ${
      verdict === 'FAIL'
        ? 'echo "HTTP 502" >&2; return 1'
        : `printf '%s\\n' "print('priority=${verdict}')" "print('window=w-1')"`
    } ;;
    *actions/workflows/backup-engine.yml/runs*) echo '${newer}' ;;
    *'/commits?sha=main&path=server&per_page=1'*) echo '${newest}' ;;
    *'/compare/'*) echo '${rel}' ;;
    *'/statuses'*) echo '${cert}' ;;
    *) return 1 ;;
  esac
}
git() { echo unexpected-main-read >&2; return 99; }
`;
    function run(harness: string, env: Record<string, string> = base) {
      const dir = mkdtempSync(resolve(tmpdir(), 'backup-priority-'));
      const calls = resolve(dir, 'calls');
      try {
        const result = planShell(harness + plan, { ...env, CALLS: calls });
        return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    it('the reader decides candidate, open, expired, consumed and unreadable state', () => {
      const out = spawnSync(
        'python3',
        ['-B', 'tests/operations/backup-candidate-priority.test.py'],
        {
          cwd: resolve(__dirname, '..'),
          encoding: 'utf8',
          env: hookFreeEnv(),
        }
      );
      expect(out.status, out.stderr).toBe(0);
    });
    it('the booking commit is never superseded or retargeted by later ordinary pushes', () => {
      const result = run(fakeGh('booking', '3', 'ahead'));
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`PRIORITY: ${pushed} is the booking commit`);
      expect(result.stdout).not.toContain('SUPERSEDED');
      expect(result.stdout).not.toContain('RETARGETED');
      expect(result.stdout).toContain('sha=' + pushed);
      expect(result.stdout).toContain('refresh=auto');
      expect(result.stdout).toContain('inherit_eligible=true');
      expect(result.stdout).not.toContain('control_sha=');
      expect(result.calls).not.toContain('actions/workflows/backup-engine.yml/runs');
      expect(result.calls).not.toContain('/compare/');
      expect(result.calls).toContain(`/commits/${pushed}/statuses`);
    });
    it('a booking commit that is already certified is still not certified twice', () => {
      const result = run(fakeGh('booking', '3', 'ahead', 'success'));
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`ALREADY CERTIFIED: ${pushed}`);
      expect(result.stdout).toMatch(/\nsha=\n/);
    });
    it('a post-booking push yields as DEFERRED while the booking commit is not yet certified', () => {
      for (const rel of ['', 'ahead']) {
        const result = run(fakeGh('booking_pending', '0', rel));
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('DEFERRED: owner engine window w-1');
        expect(result.stdout).toMatch(/\nsha=\n/);
        expect(result.stdout).not.toContain('sha=' + pushed);
        expect(result.stdout).not.toContain('sha=' + newest);
        expect(result.stdout).not.toContain('refresh=auto');
        expect(result.stdout).not.toContain('inherit_eligible');
        expect(result.calls).not.toContain('/statuses');
      }
    });
    it('a commit that predates the booking and was not retargeted is deferred: nothing planned, no status', () => {
      for (const rel of ['', 'HTTP 502', 'diverged']) {
        const result = run(fakeGh('predates', '0', rel));
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('DEFERRED: owner engine window w-1');
        expect(result.stdout).toMatch(/\nsha=\n/);
        expect(result.stdout).not.toContain('sha=' + pushed);
        expect(result.stdout).not.toContain('refresh=auto');
        expect(result.stdout).not.toContain('inherit_eligible');
        expect(result.calls).not.toContain('/statuses');
      }
    });
    it('a predating run still hands the host to the candidate exactly as before when it can', () => {
      const retargeted = run(fakeGh('predates', '0', 'ahead'));
      expect(retargeted.status, retargeted.stderr).toBe(0);
      expect(retargeted.stdout).toContain(
        `RETARGETED: pushed ${pushed} is superseded by ${newest}`
      );
      expect(retargeted.stdout).toContain('sha=' + newest);
      expect(retargeted.stdout).not.toContain('DEFERRED');
      const superseded = run(fakeGh('predates', '2', 'ahead'));
      expect(superseded.stdout).toContain('SUPERSEDED: 2 newer push run(s)');
      expect(superseded.stdout).not.toContain('DEFERRED');
    });
    it.each(['candidate', 'none', 'unknown', 'yes', 'FAIL'])(
      'verdict %s leaves the queue rules exactly as they were',
      (verdict) => {
        const superseded = run(fakeGh(verdict, '2', 'ahead'));
        expect(superseded.status, superseded.stderr).toBe(0);
        expect(superseded.stdout).toContain('SUPERSEDED: 2 newer push run(s)');
        const retargeted = run(fakeGh(verdict, '0', 'ahead'));
        expect(retargeted.stdout).toContain('sha=' + newest);
        const kept = run(fakeGh(verdict, '0', ''));
        expect(kept.status, kept.stderr).toBe(0);
        expect(kept.stdout).toContain('sha=' + pushed);
        for (const result of [superseded, retargeted, kept]) {
          expect(result.stdout).not.toContain('DEFERRED');
          expect(result.stdout).not.toContain('PRIORITY:');
        }
      }
    );
    it.each([
      ['workflow_dispatch', { INPUT_SHA: pushed }],
      ['schedule', {}],
      ['repository_dispatch', { SEALED_SHA: pushed }],
    ])('a %s run never asks and is never deferred', (event, extra) => {
      const result = run(
        fakeGh('predates', '9', '') + `git() { printf '%s\\trefs/heads/main\\n' ${pushed}; }\n`,
        { ...base, ...extra, EVENT: event }
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('sha=' + pushed);
      expect(result.stdout).not.toContain('DEFERRED');
      expect(result.calls).not.toContain('backup-candidate-priority.py');
    });
    it('the real reader runs from the fetched file, and an unreadable GitHub is unknown, not a skip', () => {
      const dir = mkdtempSync(resolve(tmpdir(), 'backup-priority-bin-'));
      try {
        // An executable gh, so the reader's own reads reach it too: it serves
        // the tracked reader, answers "no newer run", and fails everything else.
        writeFileSync(
          resolve(dir, 'gh'),
          `#!/usr/bin/env bash
case "$*" in
  *contents/scripts/ci/backup-candidate-priority.py*) cat '${resolve(__dirname, '..', 'scripts/ci/backup-candidate-priority.py')}' ;;
  *actions/workflows/backup-engine.yml/runs*) echo 0 ;;
  *) echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1 ;;
esac
`,
          { mode: 0o755 }
        );
        const result = planShell(plan, { ...base, PATH: `${dir}:${process.env.PATH}` });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('owner window priority: unknown');
        expect(result.stdout).toContain('sha=' + pushed);
        expect(result.stdout).toContain('refresh=auto');
        expect(result.stdout).not.toContain('DEFERRED');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    it('is wired read-only, push-only, and cancels nothing', () => {
      expect(plan).toContain('contents/scripts/ci/backup-candidate-priority.py?ref=$GITHUB_SHA');
      expect(plan.indexOf('backup-candidate-priority.py')).toBeGreaterThan(
        plan.indexOf('if [ "$EVENT" = push ] && [[ "${RUN_ID:-}" =~ ^[0-9]+$ ]]; then')
      );
      expect(plan.indexOf('backup-candidate-priority.py')).toBeLessThan(
        plan.indexOf('SUPERSEDED:')
      );
      expect(plan.indexOf('DEFERRED:')).toBeLessThan(plan.indexOf('ALREADY CERTIFIED:'));
      const workflow = read('.github/workflows/backup-engine.yml');
      expect(workflow).not.toMatch(/actions\/runs\/[^\s"']*\/cancel|gh run cancel/);
      expect(backup.concurrency['cancel-in-progress']).toBe(false);
      expect(backup.jobs.plan.permissions).toEqual({
        contents: 'read',
        actions: 'read',
        statuses: 'write',
      });
    });
  });
  // 2026-11-14: post-seal Backup run 43565758486 failed its certify job after
  // 16 s on one HTTP 502 and then wrote "Backup Engine refused: see run" over
  // a success certificate an hour old. A transient provider answer is retried
  // inside the step, and a run that reached no verdict never reports a refusal
  // or replaces a success it did not itself overwrite.
  describe('one provider failure neither fails nor downgrades a certification', () => {
    const certify = backup.jobs.certify;
    const prove = certify.steps[0];
    const publish = certify.steps.find((s: any) => /Publish the verdict/.test(s.name));
    const sha = 'c'.repeat(40);
    function shell(
      script: string,
      env: Record<string, string>,
      files: Record<string, string> = {}
    ) {
      const dir = mkdtempSync(resolve(tmpdir(), 'backup-verdict-'));
      const calls = resolve(dir, 'calls');
      try {
        for (const [name, text] of Object.entries(files)) writeFileSync(resolve(dir, name), text);
        const result = planShell(script, { ...env, CALLS: calls, RUNNER_TEMP: dir }, dir);
        return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    describe('the dispatch-intent fetch', () => {
      const fetcher = (answers: string[]) => `sleep() { echo "sleep $1" >> "$CALLS"; }
node() { echo "node $*" >> "$CALLS"; }
gh() {
  n=$(grep -c '^gh ' "$CALLS" 2>/dev/null || true)
  echo "gh $*" >> "$CALLS"
  set -- ${answers.map((a) => `'${a}'`).join(' ')}
  [ "$n" -lt "$#" ] && shift "$n" || shift $(($# - 1))
  if [ "$1" = ok ]; then echo 'export {}'; return 0; fi
  echo "gh: $1" >&2; return 1
}
`;
      const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: sha };
      const count = (text: string, prefix: string) =>
        text.split('\n').filter((line) => line.startsWith(prefix)).length;
      it('both privileged jobs fetch it the same bounded way', () => {
        expect(backup.jobs.refresh.steps[0].run).toBe(prove.run);
        expect(prove.run).toContain('for wait in 0 5 15 30; do');
        expect(prove.run).toContain("grep -Eq 'HTTP 4[0-9][0-9]'");
        expect(prove.run).not.toMatch(/while |until /);
      });
      it('502 then 200 proceeds to the proof', () => {
        const result = shell(fetcher(['Bad Gateway (HTTP 502)', 'ok']) + prove.run, env);
        expect(result.status, result.stderr).toBe(0);
        expect(count(result.calls, 'gh ')).toBe(2);
        expect(result.calls).toContain('prove --receiver backup-after-seal');
      });
      it('a network error is retried too', () => {
        const result = shell(
          fetcher(['error connecting to api.github.com', 'ok']) + prove.run,
          env
        );
        expect(result.status, result.stderr).toBe(0);
        expect(count(result.calls, 'gh ')).toBe(2);
      });
      it('404 fails at once and never reaches the proof', () => {
        const result = shell(fetcher(['Not Found (HTTP 404)', 'ok']) + prove.run, env);
        expect(result.status).not.toBe(0);
        expect(count(result.calls, 'gh ')).toBe(1);
        expect(result.calls).not.toContain('node ');
      });
      it('a provider that stays down fails after four attempts', () => {
        const result = shell(fetcher(['Bad Gateway (HTTP 502)']) + prove.run, env);
        expect(result.status).not.toBe(0);
        expect(count(result.calls, 'gh ')).toBe(4);
        expect(result.calls).not.toContain('node ');
      });
    });
    describe('the verdict', () => {
      const fakeGh = (current: string) => `gh() {
  case "$*" in
    *'-f state='*) echo "WRITE $*" >> "$CALLS" ;;
    *'/statuses'*) echo "READ $*" >> "$CALLS"; ${
      current === 'FAIL' ? 'echo "HTTP 502" >&2; return 1' : `echo '${current}'`
    } ;;
    *) return 1 ;;
  esac
}
`;
      const env = {
        SHA: sha,
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '9',
        STATUS_CONTEXT: 'backup-engine/certified',
        RC: '',
        JOB_STATUS: 'failure',
        INSTALLED: '',
        PENDING: 'skipped',
        POLICY: 'skipped',
        REFRESH: 'success',
      };
      it('reads the step outcomes that tell a refusal from no verdict', () => {
        expect(certify.steps.find((s: any) => s.id === 'pending').name).toBe(
          'Mark the certification pending'
        );
        expect(certify.steps.find((s: any) => s.id === 'policy').name).toBe(
          'Check the protected activation policy before spending a Backup soak'
        );
        expect(publish.env.PENDING).toBe('${{ steps.pending.outcome }}');
        expect(publish.env.POLICY).toBe('${{ steps.policy.outcome }}');
        expect(publish.env.REFRESH).toBe('${{ needs.refresh.result }}');
        expect(publish.if).toBe('always()');
      });
      it('a run that failed before any certificate leaves an existing success in place', () => {
        const result = shell(fakeGh('success') + publish.run, env);
        expect(result.status).toBe(1);
        expect(result.calls).toContain('READ ');
        expect(result.calls).not.toContain('WRITE ');
        expect(result.stdout).toContain('success on ' + sha + ' stands');
      });
      it.each(['missing', 'pending', 'failure', 'error'])(
        'with an existing %s it reports error naming the provider, never a refusal',
        (current) => {
          const result = shell(fakeGh(current) + publish.run, env);
          expect(result.status).toBe(1);
          expect(result.calls).toContain('-f state=error');
          expect(result.calls).toContain('reached no verdict');
          expect(result.calls).not.toContain('state=failure');
          expect(result.calls).not.toContain('refused');
        }
      );
      it('writes nothing when the existing status cannot be read', () => {
        for (const current of ['FAIL', 'garbage', '']) {
          const result = shell(fakeGh(current) + publish.run, env);
          expect(result.status).toBe(1);
          expect(result.calls).not.toContain('WRITE ');
        }
      });
      it('after this run wrote pending, no verdict is error without asking', () => {
        const result = shell(fakeGh('success') + publish.run, { ...env, PENDING: 'success' });
        expect(result.status).toBe(1);
        expect(result.calls).not.toContain('READ ');
        expect(result.calls).toContain('-f state=error');
      });
      it('the status description fits GitHub`s 140 characters', () => {
        const description = /state=error; desc='([^']+)'/.exec(publish.run)![1];
        expect(description.length).toBeLessThanOrEqual(140);
      });
      it('a genuine refusal is still a failure, over any earlier success', () => {
        const policy = shell(fakeGh('success') + publish.run, {
          ...env,
          PENDING: 'success',
          POLICY: 'failure',
        });
        expect(policy.status).toBe(1);
        expect(policy.calls).toContain('-f state=failure');
        expect(policy.calls).toContain('Backup Engine refused: see run');
        const refused = shell(
          fakeGh('success') + publish.run,
          { ...env, PENDING: 'success', POLICY: 'success', RC: '1' },
          { 'certificate.json': '{"reasons":["database_refresh_failed"]}' }
        );
        expect(refused.status).toBe(1);
        expect(refused.calls).toContain('-f state=failure');
        expect(refused.calls).toContain('Backup Engine refused: database_refresh_failed');
        const unbound = shell(fakeGh('success') + publish.run, {
          ...env,
          PENDING: 'success',
          POLICY: 'success',
          RC: '0',
          JOB_STATUS: 'success',
        });
        expect(unbound.status).toBe(1);
        expect(unbound.calls).toContain('-f state=failure');
        for (const result of [policy, refused, unbound])
          expect(result.calls).not.toContain('READ ');
      });
      it.each(['failure', 'cancelled', ''])(
        'a refresh that held the Backup host and ended %s is a refusal even when no certify step ran, over any earlier success',
        (refresh) => {
          for (const pending of ['skipped', 'failure', 'success']) {
            const result = shell(fakeGh('success') + publish.run, {
              ...env,
              PENDING: pending,
              REFRESH: refresh,
              TURN: '1',
            });
            expect(result.status).toBe(1);
            expect(result.calls).toContain('-f state=failure');
            expect(result.calls).not.toContain('READ ');
            expect(result.stdout).not.toContain('stands');
          }
        }
      );
      // incident 076ff467 (2026-11-20): a run that timed out waiting for the
      // Backup host touched no copy and judged no build; its `failure` replaced
      // the freeze baseline's certificate 12 minutes before the 03:30 selection.
      it.each(['failure', 'cancelled', ''])(
        'a refresh that never held the Backup host and ended %s is no verdict, and an earlier success stands',
        (refresh) => {
          const kept = shell(
            fakeGh('success') + publish.run,
            {
              ...env,
              PENDING: 'skipped',
              REFRESH: refresh,
              RC: '1',
            },
            { 'certificate.json': '{"reasons":["database_refresh_failed"]}' }
          );
          expect(kept.status).toBe(1);
          expect(kept.calls).not.toContain('-f state=failure');
          expect(kept.calls).not.toContain('-f state=');
          expect(kept.stdout).toContain('stands');
          const none = shell(fakeGh('missing') + publish.run, {
            ...env,
            PENDING: 'skipped',
            REFRESH: refresh,
          });
          expect(none.calls).toContain('-f state=error');
          expect(none.calls).toContain('never held the Backup host turn');
        }
      );
      it('a certified run still writes success', () => {
        const result = shell(fakeGh('missing') + publish.run, {
          ...env,
          PENDING: 'success',
          POLICY: 'success',
          RC: '0',
          JOB_STATUS: 'success',
          INSTALLED: 'f'.repeat(64),
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.calls).toContain('-f state=success');
      });
    });
  });
  // 2026-11-07: a certificate follows identical engine source. The plan job
  // inherits backup-engine/certified = success from a first-parent ancestor
  // whose engine source identity (the Dockerfile's COPY set, the Dockerfile
  // and the identity script) equals the candidate's; everything else builds.
  describe('a certificate follows identical engine source', () => {
    const planStep = backup.jobs.plan.steps.find((s: any) => s.id === 'plan');
    const inherit = backup.jobs.plan.steps.find((s: any) => s.id === 'inherit');
    // The candidate's checkout is the step right before the inherit step (the
    // plan job also checks out its own commit for a post-seal run, O24).
    const checkout = backup.jobs.plan.steps[backup.jobs.plan.steps.indexOf(inherit) - 1];
    const identityScript = read('scripts/ci/engine-source-identity.sh');
    const repoDockerignore = read('server/.dockerignore');
    const candidate = 'a'.repeat(40);
    const pushBase = {
      INPUT_SHA: '',
      INPUT_REFRESH: 'false',
      GITHUB_SHA: candidate,
      RUN_ID: '500',
      GITHUB_REPOSITORY: 'o/r',
    };
    /** A repo whose engine identity is readable at every commit after C0. */
    function fixture(options: { scriptFrom?: 'c1'; withDockerignore?: boolean } = {}) {
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
      if (options.withDockerignore !== false) write('server/.dockerignore', repoDockerignore);
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
      write('server/src/GameServer.ts', 'export const g = 1;\n');
      write('server/src/benchmark/HorseLeague.ts', 'export const hl = 1;\n');
      write('server/src/benchmark/SparringLeague.ts', 'export const sp = 1;\n');
      write('server/src/benchmark/sparringRun.ts', 'export const sr = 1;\n');
      write('server/src/benchmark/fixtures/snap.json', '{"v":1}\n');
      write('server/src/engine/testing/frozenDecisionClock.ts', 'export const c = 1;\n');
      write('server/src/testing/waitBudget.ts', 'export const w = 1;\n');
      write('server/src/engine/__tests__/fixture.ts', 'export const f = 1;\n');
      write('server/src/engine/helper.test-support.ts', 'export const h = 1;\n');
      write('server/src/index.test.ts', 'test 1\n');
      write('server/src/engine/sample.law.test.ts', 'law 1\n');
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
      it('is deterministic and names only the Dockerfile COPY sources, Dockerfile, .dockerignore and itself', () => {
        const a = f.identity(f.shas.c1, '--manifest');
        expect(a.status, a.stderr).toBe(0);
        const lines = a.stdout.trim().split('\n');
        const identity = lines.pop()!;
        expect(identity).toMatch(/^[0-9a-f]{64}$/);
        expect(lines[0]).toMatch(/^identity-script [0-9a-f]{40}$/);
        expect(lines[1]).toMatch(/^dockerfile [0-9a-f]{40}$/);
        expect(lines[2]).toMatch(/^dockerignore [0-9a-f]{40}$/);
        expect(lines.slice(3).map((l) => l.split(' ')[1])).toEqual([
          'native/kernel.cc',
          'package-lock.json',
          'package.json',
          'release-evidence',
          'src',
        ]);
        expect(lines.find((l) => l.startsWith('copy src '))).toMatch(
          /^copy src filtered-tree:[0-9a-f]{64}$/
        );
        expect(lines.some((l) => l.includes('kernel.node'))).toBe(false);
        expect(f.identity(f.shas.c1).stdout.trim()).toBe(identity);
      });
      it('stays identical when only .dockerignore-excluded test, testing-helper or sparring files change', () => {
        const id = (s: string) => f.identity(s).stdout.trim();
        expect(id(f.shas.c0)).not.toBe(id(f.shas.c1));
        expect(id(f.shas.c2)).toBe(id(f.shas.c1));
        expect(id(f.shas.c3)).toBe(id(f.shas.c1));
        const baseline = id(f.shas.c3);
        const excludedMutations: Array<[string, string]> = [
          ['server/src/index.test.ts', 'test 2\n'],
          ['server/src/engine/sample.law.test.ts', 'law 2\n'],
          ['server/src/engine/testing/frozenDecisionClock.ts', 'export const c = 2;\n'],
          ['server/src/testing/waitBudget.ts', 'export const w = 2;\n'],
          ['server/src/engine/__tests__/fixture.ts', 'export const f = 2;\n'],
          ['server/src/engine/helper.test-support.ts', 'export const h = 2;\n'],
          ['server/src/benchmark/fixtures/snap.json', '{"v":2}\n'],
          ['server/src/benchmark/SparringLeague.ts', 'export const sp = 2;\n'],
          ['server/src/benchmark/sparringRun.ts', 'export const sr = 2;\n'],
          ['server/src/benchmark/newBench.test.ts', 'added test\n'],
        ];
        for (const [path, content] of excludedMutations) {
          f.write(path, content);
          const next = f.commit(`mutate excluded ${path}`);
          expect(id(next), `${path} must not change engine source identity`).toBe(baseline);
        }
      });
      it('changes when any runtime file, lockfile, release-evidence, Dockerfile, .dockerignore or script changes', () => {
        const id = (s: string) => f.identity(s).stdout.trim();
        let prev = f.git('rev-parse', 'HEAD');
        const runtimeMutations: Array<[string, string]> = [
          ['server/src/GameServer.ts', 'export const g = 2;\n'],
          ['server/src/benchmark/HorseLeague.ts', 'export const hl = 2;\n'],
          ['server/package-lock.json', '{"lockfileVersion":3,"x":1}\n'],
          ['server/release-evidence/r.json', '{"a":1}\n'],
        ];
        for (const [path, content] of runtimeMutations) {
          f.write(path, content);
          const next = f.commit(`mutate runtime ${path}`);
          expect(id(next), `${path} must change engine source identity`).not.toBe(id(prev));
          prev = next;
        }
        f.write(
          'server/.dockerignore',
          readFileSync(resolve(f.dir, 'server/.dockerignore'), 'utf8') + '\n# comment\n'
        );
        const dockerignoreChanged = f.commit('dockerignore changed');
        expect(id(dockerignoreChanged)).not.toBe(id(prev));
        prev = dockerignoreChanged;
        f.write(
          'server/Dockerfile',
          readFileSync(resolve(f.dir, 'server/Dockerfile'), 'utf8') + 'COPY tests/ ./tests/\n'
        );
        const widened = f.commit('copy tests too');
        expect(id(widened)).not.toBe(id(prev));
        expect(f.identity(widened, '--manifest').stdout).toContain('copy tests ');
        f.write('scripts/ci/engine-source-identity.sh', identityScript + '# revised\n');
        const revised = f.commit('identity script revised');
        expect(id(revised)).not.toBe(id(widened));
      });
      it('fails closed on unsupported .dockerignore syntax and preserves historical commits without .dockerignore', () => {
        const legacy = fixture({ withDockerignore: false });
        try {
          const out = legacy.identity(legacy.shas.c1, '--manifest');
          expect(out.status, out.stderr).toBe(0);
          expect(out.stdout).toContain('dockerignore absent\n');
          legacy.write('server/src/index.test.ts', 'legacy test edit\n');
          const edited = legacy.commit('legacy commit without dockerignore includes test');
          expect(legacy.identity(edited).stdout.trim()).not.toBe(
            legacy.identity(legacy.shas.c1).stdout.trim()
          );
          for (const badRule of ['!src/keep.ts\n', 'src/[a-z].ts\n', 'src/foo**bar.ts\n']) {
            legacy.write('server/.dockerignore', badRule);
            const bad = legacy.commit(`bad rule ${badRule.trim()}`);
            const res = legacy.identity(bad);
            expect(res.status, `rule ${badRule.trim()} must fail closed`).not.toBe(0);
            expect(res.stdout).toBe('');
          }
        } finally {
          rmSync(legacy.dir, { recursive: true, force: true });
        }
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
      it('server/tsconfig.runtime.json excludes every TypeScript path ignored by server/.dockerignore and no runtime source imports an ignored path', () => {
        const serverRoot = resolve(__dirname, '..', 'server');
        const runtimeConfig = JSON.parse(read('server/tsconfig.runtime.json')) as {
          exclude?: string[];
        };
        const tsconfigExcludes = new Set(runtimeConfig.exclude ?? []);
        const rawRules = repoDockerignore
          .split('\n')
          .map((l) => l.replace(/\r$/, ''))
          .filter((l) => !l.startsWith('#') && l.trim() !== '')
          .map((l) => l.trim());
        expect(rawRules.length).toBeGreaterThan(0);

        const compilePattern = (rule: string): RegExp => {
          expect(rule.startsWith('!'), `unsupported negation: ${rule}`).toBe(false);
          expect(/[[\]\\]/.test(rule), `unsupported syntax: ${rule}`).toBe(false);
          const norm = rule
            .replace(/^(\.\/)+/, '')
            .replace(/^\/+|\/+$/g, '')
            .replace(/\/+/g, '/');
          const segs = norm.split('/');
          const parts: string[] = [];
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i]!;
            if (seg === '**') {
              if (i === segs.length - 1) parts.push(parts.length ? '(?:/.*)?' : '.*');
              else parts.push(parts.length ? '/(?:.+/)?' : '(?:.+/)?');
            } else {
              if (parts.length && !parts[parts.length - 1]!.endsWith('/)?')) parts.push('/');
              parts.push(
                seg
                  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                  .replace(/\*/g, '[^/]*')
                  .replace(/\?/g, '[^/]')
              );
            }
          }
          return new RegExp(`^${parts.join('')}$`);
        };
        const compiled = rawRules.map(compilePattern);
        const isIgnored = (serverRel: string): boolean => {
          const parts = serverRel.split('/');
          for (let end = 1; end <= parts.length; end++) {
            const prefix = parts.slice(0, end).join('/');
            if (compiled.some((rx) => rx.test(prefix))) return true;
          }
          return false;
        };

        // Every TypeScript-relevant .dockerignore pattern must also be in tsconfig.runtime.json exclude.
        for (const rule of rawRules) {
          if (/\.(js|mjs|cjs)$/.test(rule)) continue;
          const expectedTsExclude =
            !rule.includes('*') && !/\.[a-z]+$/i.test(rule) ? `${rule}/**` : rule;
          const dirFormCovered = rule.endsWith('/__tests__') && tsconfigExcludes.has(`${rule}/**`);
          expect(
            tsconfigExcludes.has(expectedTsExclude) || dirFormCovered,
            `server/tsconfig.runtime.json "exclude" is missing ${expectedTsExclude} (from server/.dockerignore rule ${rule})`
          ).toBe(true);
        }

        // Runtime modules must remain in the Docker context and identity.
        for (const mustKeep of [
          'src/index.ts',
          'src/GameServer.ts',
          'src/benchmark/HorseLeague.ts',
          'src/benchmark/Plo4StrengthContract.ts',
        ]) {
          expect(isIgnored(mustKeep), `${mustKeep} must never be ignored`).toBe(false);
        }

        // Verified non-runtime files must be ignored.
        for (const mustIgnore of [
          'src/engine/testing/frozenDecisionClock.ts',
          'src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts',
          'src/testing/waitBudget.ts',
          'src/engine/__tests__/public215Fixture.ts',
          'src/benchmark/SparringLeague.ts',
          'src/benchmark/sparringRun.ts',
          'src/benchmark/fixtures/sparring-live-switches-20261120.json',
        ]) {
          expect(isIgnored(mustIgnore), `${mustIgnore} must be ignored`).toBe(true);
        }

        // Walk every non-ignored TypeScript runtime source and prove ZERO relative imports target an ignored path.
        const walk = (dir: string, out: string[] = []): string[] => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full, out);
            else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
          }
          return out;
        };
        const importRe = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
        const violations: string[] = [];
        for (const full of walk(join(serverRoot, 'src'))) {
          const rel = relative(serverRoot, full).split(sep).join('/');
          if (isIgnored(rel)) continue;
          const text = readFileSync(full, 'utf8');
          for (const m of text.matchAll(importRe)) {
            const spec = m[1]!;
            if (!spec.startsWith('.')) continue;
            const resolvedBase = resolve(dirname(full), spec);
            const candidates: string[] = [];
            if (resolvedBase.endsWith('.js')) {
              const stem = resolvedBase.slice(0, -3);
              candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.js`);
            } else if (resolvedBase.endsWith('.mjs')) {
              const stem = resolvedBase.slice(0, -4);
              candidates.push(`${stem}.mts`, `${stem}.mjs`);
            } else if (resolvedBase.endsWith('.cjs')) {
              const stem = resolvedBase.slice(0, -4);
              candidates.push(`${stem}.cts`, `${stem}.cjs`);
            } else {
              candidates.push(
                resolvedBase,
                `${resolvedBase}.ts`,
                `${resolvedBase}.tsx`,
                join(resolvedBase, 'index.ts')
              );
            }
            for (const cand of candidates) {
              if (!existsSync(cand)) continue;
              const targetRel = relative(serverRoot, cand).split(sep).join('/');
              if (targetRel.startsWith('src/') && isIgnored(targetRel)) {
                violations.push(`${rel} -> ${targetRel}`);
              }
              break;
            }
          }
        }
        expect(
          violations,
          `runtime source imports a server/.dockerignore-excluded file:\n${violations.join('\n')}`
        ).toEqual([]);
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

    // 2026-11-21 (E3 + O2): eliminate 75-minute lease-wait starvation,
    // redundant 55-minute certifications, unnecessary disruption from
    // completed/identical-source pushes, and post-lease drops on the 3-hourly
    // cutover cadence.
    describe('waiting push runs neither starve behind one soak nor drop acquired leases (E3 + O2)', () => {
      const turn = backup.jobs.refresh.steps.find((s: any) => s.id === 'turn');
      const lateRetarget = backup.jobs.refresh.steps.find((s: any) => s.id === 'late_retarget');
      const lateInherit = backup.jobs.refresh.steps.find((s: any) => s.id === 'late_inherit');
      const latePriority = backup.jobs.refresh.steps.find((s: any) => s.id === 'late_priority');
      const due = backup.jobs.refresh.steps.find((s: any) => s.id === 'due');
      const refreshCheckout = backup.jobs.refresh.steps.find((s: any) =>
        s.uses?.startsWith('actions/checkout')
      );

      function withOriginRemote(f: ReturnType<typeof fixture>) {
        const remote = mkdtempSync(resolve(tmpdir(), 'backup-origin-'));
        const cleanEnv = hookFreeEnv();
        const r = spawnSync('git', ['init', '-q', '--bare', remote], {
          encoding: 'utf8',
          env: cleanEnv,
        });
        if (r.status !== 0) throw new Error(r.stderr);
        f.git('remote', 'add', 'origin', remote);
        f.git('push', '-q', 'origin', 'main');
        return {
          remote,
          pushMain: () => f.git('push', '-q', 'origin', 'main'),
          cleanup: () => rmSync(remote, { recursive: true, force: true }),
        };
      }

      it('wires 120m wait / 180m timeout / 150m lease, checkout before turn, in-place late_retarget before late_inherit/due, and retargeted outputs into certify', () => {
        expect(backup.jobs.refresh['timeout-minutes']).toBe(180);
        expect(turn.run).toContain('deadline=$(($(date +%s) + 7200))');
        expect(turn.run).toContain("'expiresAt': now + 9000");
        // Refresh timeout strictly covers lease wait (120m) + refresh headroom;
        // lease TTL (150m) strictly covers refresh headroom + certify timeout (75m).
        expect(backup.jobs.refresh['timeout-minutes']).toBeGreaterThanOrEqual(120 + 45);
        expect(9000 / 60).toBeGreaterThan(backup.jobs.certify['timeout-minutes'] + 60);
        // Step ordering and gating: checkout precedes turn so turn can inspect
        // engine-source-identity.sh; late_retarget runs right after turn, then
        // late_inherit, then due, then late_priority.
        const ids = backup.jobs.refresh.steps.map((s: any) => s.id ?? s.uses ?? s.name);
        expect(ids.indexOf(refreshCheckout.uses)).toBeLessThan(ids.indexOf('turn'));
        expect(ids.indexOf('late_retarget')).toBeGreaterThan(ids.indexOf('turn'));
        expect(ids.indexOf('late_retarget')).toBeLessThan(ids.indexOf('late_inherit'));
        expect(ids.indexOf('late_inherit')).toBeLessThan(ids.indexOf('due'));
        expect(lateRetarget.if).toBe(
          "github.event_name == 'push' && steps.turn.outputs.acquired == '1' && needs.plan.outputs.freeze_baseline != '1' && needs.plan.outputs.priority != 'booking'"
        );
        expect(lateInherit.if).toBe(
          "github.event_name == 'push' && steps.turn.outputs.acquired == '1' && needs.plan.outputs.freeze_baseline != '1' && needs.plan.outputs.inherit_eligible == 'true'"
        );
        expect(lateInherit.env.SHA).toBe(
          '${{ steps.late_retarget.outputs.sha || needs.plan.outputs.sha }}'
        );
        expect(due.if).toBe(
          "steps.turn.outputs.acquired == '1' && steps.late_inherit.outputs.inherited != '1'"
        );
        expect(due.env.CONTROL).toBe(
          '${{ steps.late_retarget.outputs.control_sha || needs.plan.outputs.control_sha }}'
        );
        // O29 (2026-11-26): a commit the due step stepped down to is preferred.
        expect(latePriority.env.SHA).toBe(
          '${{ steps.due.outputs.sha || steps.late_retarget.outputs.sha || needs.plan.outputs.sha }}'
        );
        expect(backup.jobs.refresh.outputs.sha).toBe(
          '${{ steps.due.outputs.sha || steps.late_retarget.outputs.sha || needs.plan.outputs.sha }}'
        );
        expect(backup.jobs.refresh.outputs.control_sha).toBe(
          '${{ steps.late_retarget.outputs.control_sha || needs.plan.outputs.control_sha }}'
        );
        expect(backup.jobs.certify.env.CONTROL_SHA).toBe(
          '${{ needs.refresh.outputs.control_sha || needs.plan.outputs.control_sha }}'
        );
        expect(backup.jobs.plan.outputs.priority).toBe('${{ steps.plan.outputs.priority }}');
        expect(backup.jobs.plan.outputs.inherit_eligible).toBe(
          '${{ steps.plan.outputs.inherit_eligible }}'
        );
        // turn jq filter excludes completed runs.
        expect(turn.run).toContain('.status != \\"completed\\"');
      });

      function runTurn(opts: {
        event?: string;
        freezeBaseline?: string;
        planPriority?: string;
        newerShas: string[] | 'FAIL';
        livePriority?: string;
        cwd?: string;
        sha?: string;
        githubSha?: string;
      }) {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-turn-e3-'));
        const calls = resolve(dir, 'calls');
        const countFile = resolve(dir, 'ssh-count');
        const sha = opts.sha ?? 'd'.repeat(40);
        const githubSha = opts.githubSha ?? sha;
        const newerBody =
          opts.newerShas === 'FAIL'
            ? 'echo "HTTP 502" >&2; return 1'
            : opts.newerShas.length === 0
              ? ':'
              : `printf '%s\\n' ${opts.newerShas.map((s) => `'${s}'`).join(' ')}`;
        const harness = `
ssh() {
  echo "ssh $*" >> "$CALLS"
  cat > /dev/null
  n=0
  [ -f "${countFile}" ] && n=$(cat "${countFile}")
  n=$((n + 1))
  echo "$n" > "${countFile}"
  if [ "$n" -eq 1 ]; then echo "held:999"; else echo "acquired"; fi
}
sleep() { echo "sleep $*" >> "$CALLS"; }
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *actions/workflows/backup-engine.yml/runs*) ${newerBody} ;;
    *contents/scripts/ci/backup-candidate-priority.py*) ${
      opts.livePriority === 'FAIL'
        ? 'echo "HTTP 502" >&2; return 1'
        : `printf '%s\\n' "print('priority=${opts.livePriority ?? 'none'}')" "print('window=w-e3')"`
    } ;;
    *actions/runs/999*) echo "in_progress" ;;
    *) return 1 ;;
  esac
}
`;
        try {
          const result = planShell(
            harness + turn.run,
            {
              CALLS: calls,
              HOME: dir,
              SSH_KEY: 'fixture-key-not-a-credential',
              STANDBY_HOST: '192.0.2.1',
              STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
              GITHUB_REPOSITORY: 'o/r',
              GITHUB_SHA: githubSha,
              SHA: sha,
              RUN_ID: '700',
              RUN_ATTEMPT: '1',
              EVENT: opts.event ?? 'push',
              FREEZE_BASELINE: opts.freezeBaseline ?? '',
              PLAN_PRIORITY: opts.planPriority ?? 'none',
            },
            opts.cwd
          );
          return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      it('a waiting push run superseded by a newer active push with a different engine-source-identity yields cleanly without holding the lease or writing a status', () => {
        const f = fixture();
        const origin = withOriginRemote(f);
        try {
          // c0 has v=1, c1 has v=2 (different engine-source-identity).
          const r = runTurn({
            cwd: f.dir,
            sha: f.shas.c0,
            newerShas: [f.shas.c1],
            livePriority: 'none',
          });
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain('SUPERSEDED: 1 newer active push run(s)');
          expect(r.stdout).toContain('superseded=1');
          expect(r.stdout).not.toContain('acquired=1');
          expect(r.calls).not.toContain('sleep ');
          expect(r.calls).not.toContain('/statuses/');
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('O2: a waiting push run does NOT supersede when newer active push runs share identical engine-source-identity and unchanged workflow, or when only completed runs exist', () => {
        const f = fixture();
        const origin = withOriginRemote(f);
        try {
          // c1 and c3 share identical engine-source-identity and same backup-engine.yml.
          const sameId = runTurn({
            cwd: f.dir,
            sha: f.shas.c1,
            newerShas: [f.shas.c2, f.shas.c3],
            livePriority: 'none',
          });
          expect(sameId.status, sameId.stderr).toBe(0);
          expect(sameId.stdout).toContain('shares identical engine-source-identity');
          expect(sameId.stdout).toContain('backup_projection');
          expect(sameId.stdout).toContain('acquired=1');
          expect(sameId.stdout).not.toContain('SUPERSEDED');
          expect(sameId.stdout).not.toContain('superseded=1');

          // Completed runs are filtered out by jq (.status != "completed") -> empty list.
          const completedOnly = runTurn({
            cwd: f.dir,
            sha: f.shas.c1,
            newerShas: [],
            livePriority: 'none',
          });
          expect(completedOnly.status, completedOnly.stderr).toBe(0);
          expect(completedOnly.stdout).toContain('acquired=1');
          expect(completedOnly.stdout).not.toContain('SUPERSEDED');

          // Same engine-source-identity BUT changed .github/workflows/backup-engine.yml -> MUST supersede.
          f.write('.github/workflows/backup-engine.yml', '# changed workflow\n');
          const wfChanged = f.commit('c4: change backup-engine.yml');
          origin.pushMain();
          const wfRun = runTurn({
            cwd: f.dir,
            sha: f.shas.c1,
            newerShas: [wfChanged],
            livePriority: 'none',
          });
          expect(wfRun.status, wfRun.stderr).toBe(0);
          expect(wfRun.stdout).toContain('SUPERSEDED: 1 newer active push run(s)');
          expect(wfRun.stdout).toContain('superseded=1');
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('O11: a waiting push run supersedes cleanly when a newer active push has identical engine-source-identity and unchanged backup-engine.yml but different backup_projection', () => {
        const f = fixture();
        const origin = withOriginRemote(f);
        try {
          // Replay 2026-11-22 16:35Z incident (b06d2db915bb vs ea92b56f0177):
          // scripts/ci/read-engine-prequalification.py changes (CONTROL_INPUTS),
          // while engine-source-identity and .github/workflows/backup-engine.yml
          // stay identical. The newer run can NEVER inherit our certificate and
          // our SHA is obsolete, so the waiting run must supersede cleanly.
          const preqOriginal = readFileSync(
            resolve(f.dir, 'scripts/ci/read-engine-prequalification.py'),
            'utf8'
          );
          f.write(
            'scripts/ci/read-engine-prequalification.py',
            preqOriginal + '\n# o11 control input change replay\n'
          );
          const preqChanged = f.commit(
            'c4: change read-engine-prequalification.py (CONTROL_INPUTS)'
          );
          origin.pushMain();

          expect(f.identity(preqChanged).stdout.trim()).toBe(f.identity(f.shas.c1).stdout.trim());

          const preqRun = runTurn({
            cwd: f.dir,
            sha: f.shas.c1,
            newerShas: [preqChanged],
            livePriority: 'none',
          });
          expect(preqRun.status, preqRun.stderr).toBe(0);
          expect(preqRun.stdout).toContain('differs in backup_projection');
          expect(preqRun.stdout).toContain('SUPERSEDED: 1 newer active push run(s)');
          expect(preqRun.stdout).toContain('superseded=1');
          expect(preqRun.stdout).not.toContain('acquired=1');
          expect(preqRun.calls).not.toContain('sleep ');
          expect(preqRun.calls).not.toContain('/statuses/');

          // Also verify supabase/migrations/ change (same engine-source-identity
          // and unchanged backup-engine.yml, different backup_projection).
          f.write('supabase/migrations/20261122000001_o11_test.sql', 'SELECT 1;\n');
          const migChanged = f.commit('c5: add migration');
          origin.pushMain();

          expect(f.identity(migChanged).stdout.trim()).toBe(f.identity(preqChanged).stdout.trim());

          const migRun = runTurn({
            cwd: f.dir,
            sha: preqChanged,
            newerShas: [migChanged],
            livePriority: 'none',
          });
          expect(migRun.status, migRun.stderr).toBe(0);
          expect(migRun.stdout).toContain('differs in backup_projection');
          expect(migRun.stdout).toContain('SUPERSEDED: 1 newer active push run(s)');
          expect(migRun.stdout).toContain('superseded=1');
          expect(migRun.stdout).not.toContain('acquired=1');
          expect(migRun.calls).not.toContain('sleep ');
          expect(migRun.calls).not.toContain('/statuses/');
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('booking runs (via plan priority or live priority) are NEVER superseded while waiting', () => {
        const f = fixture();
        const origin = withOriginRemote(f);
        try {
          for (const cfg of [
            { planPriority: 'booking', newerShas: [f.shas.c1], livePriority: 'none' },
            { planPriority: 'unknown', newerShas: [f.shas.c1], livePriority: 'booking' },
          ]) {
            const r = runTurn({ cwd: f.dir, sha: f.shas.c0, ...cfg });
            expect(r.status, r.stderr).toBe(0);
            expect(r.stdout).toContain('acquired=1');
            expect(r.stdout).not.toContain('SUPERSEDED');
            expect(r.stdout).not.toContain('superseded=1');
          }
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('freeze_baseline runs are NEVER superseded while waiting', () => {
        const r = runTurn({ freezeBaseline: '1', newerShas: ['e'.repeat(40)] });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain('acquired=1');
        expect(r.stdout).not.toContain('SUPERSEDED');
        expect(r.stdout).not.toContain('superseded=1');
        expect(r.calls).not.toContain('actions/workflows/backup-engine.yml/runs');
      });

      it.each(['workflow_dispatch', 'schedule', 'repository_dispatch'])(
        '%s runs are NEVER superseded while waiting',
        (event) => {
          const r = runTurn({ event, newerShas: ['e'.repeat(40)] });
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain('acquired=1');
          expect(r.stdout).not.toContain('SUPERSEDED');
          expect(r.stdout).not.toContain('superseded=1');
          expect(r.calls).not.toContain('actions/workflows/backup-engine.yml/runs');
        }
      );

      it('CLAUDE.md 10.86: unreadable newer-runs or unreadable identity keeps waiting instead of superseding', () => {
        const f = fixture();
        const origin = withOriginRemote(f);
        try {
          const apiFail = runTurn({ cwd: f.dir, sha: f.shas.c0, newerShas: 'FAIL' });
          expect(apiFail.status, apiFail.stderr).toBe(0);
          expect(apiFail.stdout).toContain('acquired=1');
          expect(apiFail.stdout).not.toContain('SUPERSEDED');

          const unknownCommit = runTurn({
            cwd: f.dir,
            sha: f.shas.c0,
            newerShas: ['f'.repeat(40)],
          });
          expect(unknownCommit.status, unknownCommit.stderr).toBe(0);
          expect(unknownCommit.stdout).toContain('keeping wait (CLAUDE.md 10.86)');
          expect(unknownCommit.stdout).toContain('acquired=1');
          expect(unknownCommit.stdout).not.toContain('SUPERSEDED');

          // O11 / CLAUDE.md 10.86: unreadable my_proj keeps waiting instead of superseding.
          const preqOriginal = readFileSync(
            resolve(f.dir, 'scripts/ci/read-engine-prequalification.py'),
            'utf8'
          );
          f.write(
            'scripts/ci/read-engine-prequalification.py',
            'def backup_projection(_sha):\n    raise RuntimeError("unreadable")\n'
          );
          const myProjFail = runTurn({
            cwd: f.dir,
            sha: f.shas.c0,
            newerShas: [f.shas.c1],
          });
          expect(myProjFail.status, myProjFail.stderr).toBe(0);
          expect(myProjFail.stdout).toContain('Could not verify backup_projection');
          expect(myProjFail.stdout).toContain('keeping wait (CLAUDE.md 10.86)');
          expect(myProjFail.stdout).toContain('acquired=1');
          expect(myProjFail.stdout).not.toContain('SUPERSEDED');
          expect(myProjFail.stdout).not.toContain('superseded=1');

          // O11 / CLAUDE.md 10.86: unreadable other_proj keeps waiting instead of superseding.
          f.write(
            'scripts/ci/read-engine-prequalification.py',
            `def backup_projection(sha):\n    if sha == ${JSON.stringify(f.shas.c0)}:\n        return "ok"\n    raise RuntimeError("unreadable other")\n`
          );
          const otherProjFail = runTurn({
            cwd: f.dir,
            sha: f.shas.c0,
            newerShas: [f.shas.c1],
          });
          expect(otherProjFail.status, otherProjFail.stderr).toBe(0);
          expect(otherProjFail.stdout).toContain('Could not read backup_projection');
          expect(otherProjFail.stdout).toContain('keeping wait (CLAUDE.md 10.86)');
          expect(otherProjFail.stdout).toContain('acquired=1');
          expect(otherProjFail.stdout).not.toContain('SUPERSEDED');
          expect(otherProjFail.stdout).not.toContain('superseded=1');

          f.write('scripts/ci/read-engine-prequalification.py', preqOriginal);
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      function runLateRetarget(
        repo: ReturnType<typeof fixture>,
        opts: {
          sha: string;
          githubSha?: string;
          controlSha?: string;
          head: string;
          headState?: string;
          livePriority?: string;
        }
      ) {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-late-retarget-'));
        const calls = resolve(dir, 'calls');
        const harness = `
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *contents/scripts/ci/backup-candidate-priority.py*) ${
      opts.livePriority === 'FAIL'
        ? 'echo "HTTP 502" >&2; return 1'
        : `printf '%s\\n' "print('priority=${opts.livePriority ?? 'none'}')" "print('window=w-o2')"`
    } ;;
    *'commits?sha=main&path=server'*) ${
      opts.head === 'FAIL' ? 'echo "HTTP 502" >&2; return 1' : `echo '${opts.head}'`
    } ;;
    *commits/*/statuses*) ${
      opts.headState === 'FAIL'
        ? 'echo "HTTP 502" >&2; return 1'
        : `echo '${opts.headState ?? 'missing'}'`
    } ;;
    *) return 1 ;;
  esac
}
`;
        try {
          const result = planShell(
            harness + lateRetarget.run,
            {
              CALLS: calls,
              HOME: dir,
              SHA: opts.sha,
              CONTROL_SHA: opts.controlSha ?? opts.sha,
              GITHUB_SHA: opts.githubSha ?? opts.sha,
              GITHUB_REPOSITORY: 'o/r',
              STATUS_CONTEXT: 'backup-engine/certified',
              PLAN_PRIORITY: 'none',
            },
            repo.dir
          );
          return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      it('O2: late_retarget retargets in-place after lease acquisition to main newest uncertified server commit and checks out head, then late_inherit inherits on the retargeted SHA', () => {
        const f = fixture();
        const origin = withOriginRemote(f);
        try {
          // Simulate runner originally checked out at c1 while c3 arrived on origin/main.
          f.git('checkout', '-q', f.shas.c1);
          const r = runLateRetarget(f, {
            sha: f.shas.c1,
            head: f.shas.c3,
            headState: 'missing',
          });
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain(`RETARGETED IN-PLACE: ${f.shas.c1} -> ${f.shas.c3}`);
          expect(r.stdout).toContain(`sha=${f.shas.c3}`);
          expect(r.stdout).toContain(`control_sha=${f.shas.c3}`);
          expect(r.stdout).toContain('retargeted=1');
          expect(f.git('rev-parse', 'HEAD')).toBe(f.shas.c3);

          // Immediately check late_inherit on the retargeted SHA (c3 shares identity with c1).
          const inh = runLateInherit(f, f.shas.c3, { [f.shas.c1]: 'success' });
          expect(inh.status, inh.stderr).toBe(0);
          expect(inh.stdout).toContain(`INHERITED: Inherited from ${f.shas.c1}`);
          expect(inh.stdout).toContain('inherited=1');
          expect(inh.calls).toContain(`repos/o/r/statuses/${f.shas.c3}`);
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('O13: late_retarget follows a release-control commit newer than main newest server commit, and keeps the server head when CONTROL_INPUTS is unreadable or that commit changed backup-engine.yml', () => {
        const f = fixture();
        const origin = withOriginRemote(f);
        try {
          // c4 touches only a CONTROL_INPUTS path (no server/ file) after c3.
          f.write('scripts/ci/select-daily-engine.py', 'print("selector 2")\n');
          const c4 = f.commit('c4: release control only');
          origin.pushMain();
          f.git('checkout', '-q', f.shas.c1);
          const followed = runLateRetarget(f, { sha: f.shas.c1, head: f.shas.c3 });
          expect(followed.status, followed.stderr).toBe(0);
          expect(followed.stdout).toContain(
            `FOLLOWING RELEASE CONTROLS: main's newest release-control commit ${c4} is newer than its newest server commit ${f.shas.c3}.`
          );
          expect(followed.stdout).toContain(`RETARGETED IN-PLACE: ${f.shas.c1} -> ${c4}`);
          expect(followed.stdout).toContain(`sha=${c4}`);
          expect(followed.stdout).toContain(`control_sha=${c4}`);
          expect(followed.stdout).toContain('retargeted=1');
          expect(f.git('rev-parse', 'HEAD')).toBe(c4);
          expect(followed.calls).not.toContain('commits?sha=main&path=scripts');

          // Unreadable CONTROL_INPUTS keeps the old server-head behavior.
          f.git('checkout', '-q', f.shas.c1);
          const preq = resolve(f.dir, 'scripts/ci/read-engine-prequalification.py');
          const preqBody = readFileSync(preq, 'utf8');
          writeFileSync(preq, 'raise SystemExit(7)\n');
          const unreadable = runLateRetarget(f, { sha: f.shas.c1, head: f.shas.c3 });
          writeFileSync(preq, preqBody);
          expect(unreadable.status, unreadable.stderr).toBe(0);
          expect(unreadable.stdout).toContain('could not read CONTROL_INPUTS; following main');
          expect(unreadable.stdout).toContain(`RETARGETED IN-PLACE: ${f.shas.c1} -> ${f.shas.c3}`);
          expect(unreadable.stdout).toContain(`sha=${f.shas.c3}`);
          expect(unreadable.stdout).not.toContain('FOLLOWING RELEASE CONTROLS');

          // A newer release-control commit that changed backup-engine.yml keeps
          // the exact SHA (producer provenance), exactly as for a server head.
          f.git('checkout', '-q', '-f', 'main');
          f.write('.github/workflows/backup-engine.yml', 'name: changed\n');
          const c5 = f.commit('c5: backup workflow changed');
          origin.pushMain();
          f.git('checkout', '-q', f.shas.c1);
          const changedWorkflow = runLateRetarget(f, { sha: f.shas.c1, head: f.shas.c3 });
          expect(changedWorkflow.status, changedWorkflow.stderr).toBe(0);
          expect(changedWorkflow.stdout).toContain(
            `FOLLOWING RELEASE CONTROLS: main's newest release-control commit ${c5}`
          );
          expect(changedWorkflow.stdout).toContain(
            `changed .github/workflows/backup-engine.yml relative to ${f.shas.c1}`
          );
          expect(changedWorkflow.stdout).toContain(`sha=${f.shas.c1}`);
          expect(changedWorkflow.stdout).toContain('retargeted=0');
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('O2: late_retarget keeps SHA unchanged when head is already certified, changes backup-engine.yml, is booking, or API is unreadable', () => {
        const f = fixture();
        const origin = withOriginRemote(f);
        try {
          f.git('checkout', '-q', f.shas.c1);
          const alreadyCert = runLateRetarget(f, {
            sha: f.shas.c1,
            head: f.shas.c3,
            headState: 'success',
          });
          expect(alreadyCert.status, alreadyCert.stderr).toBe(0);
          expect(alreadyCert.stdout).toContain(`sha=${f.shas.c1}`);
          expect(alreadyCert.stdout).toContain('retargeted=0');

          const booking = runLateRetarget(f, {
            sha: f.shas.c1,
            head: f.shas.c3,
            livePriority: 'booking',
          });
          expect(booking.status, booking.stderr).toBe(0);
          expect(booking.stdout).toContain(`sha=${f.shas.c1}`);
          expect(booking.stdout).toContain('retargeted=0');
          expect(booking.calls).not.toContain('commits?sha=main&path=server');

          const unreadableHead = runLateRetarget(f, { sha: f.shas.c1, head: 'FAIL' });
          expect(unreadableHead.status, unreadableHead.stderr).toBe(0);
          expect(unreadableHead.stdout).toContain(`sha=${f.shas.c1}`);
          expect(unreadableHead.stdout).toContain('retargeted=0');

          const unreadableStatus = runLateRetarget(f, {
            sha: f.shas.c1,
            head: f.shas.c3,
            headState: 'FAIL',
          });
          expect(unreadableStatus.status, unreadableStatus.stderr).toBe(0);
          expect(unreadableStatus.stdout).toContain(`sha=${f.shas.c1}`);
          expect(unreadableStatus.stdout).toContain('retargeted=0');

          // Workflow file changed between GITHUB_SHA and head -> must not retarget (preserves producer provenance).
          f.git('checkout', '-q', 'main');
          f.write('.github/workflows/backup-engine.yml', '# workflow modified\n');
          const wfSha = f.commit('c4: modify backup-engine.yml');
          origin.pushMain();
          f.git('checkout', '-q', f.shas.c1);
          const wfBlocked = runLateRetarget(f, {
            sha: f.shas.c1,
            head: wfSha,
            headState: 'missing',
          });
          expect(wfBlocked.status, wfBlocked.stderr).toBe(0);
          expect(wfBlocked.stdout).toContain('preserve producer provenance');
          expect(wfBlocked.stdout).toContain(`sha=${f.shas.c1}`);
          expect(wfBlocked.stdout).toContain('retargeted=0');
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('O2: late_priority never drops an already-acquired lease for a newer ordinary push (only yields for owner-window booking priority)', () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-late-o2-'));
        const calls = resolve(dir, 'calls');
        const sha = 'e'.repeat(40);
        const harness = `
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *contents/scripts/ci/backup-candidate-priority.py*)
      printf '%s\\n' "print('priority=none')" "print('window=')" ;;
    *) return 1 ;;
  esac
}
ssh() { echo "ssh $*" >> "$CALLS"; cat > /dev/null; }
`;
        try {
          const r = planShell(harness + latePriority.run, {
            CALLS: calls,
            HOME: dir,
            SHA: sha,
            RUN_ID: '700',
            RUN_ATTEMPT: '1',
            SSH_KEY: 'fixture-key-not-a-credential',
            STANDBY_HOST: '192.0.2.1',
            STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
            GITHUB_REPOSITORY: 'o/r',
            GITHUB_SHA: sha,
            PLAN_PRIORITY: 'none',
          });
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).not.toContain('SUPERSEDED');
          expect(r.stdout).not.toContain('deferred=1');
          const callLog = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
          expect(callLog).not.toContain('actions/workflows/backup-engine.yml/runs');
          expect(callLog).not.toContain('ssh ');
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });

      function runLateInherit(
        repo: ReturnType<typeof fixture>,
        targetSha: string,
        states: Record<string, string>,
        writeExit = 0
      ) {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-late-inherit-'));
        const calls = resolve(dir, 'calls');
        const harness = `
gh() {
  echo "gh $*" >> "$CALLS"
  case "$2" in
    repos/o/r/statuses/*)
      return ${writeExit} ;;
    repos/o/r/commits/*/statuses*)
      sha=\${2#repos/o/r/commits/}; sha=\${sha%%/statuses*}
      case "$sha" in
${Object.entries(states)
  .map(([k, v]) => `        ${k}) ${v === 'unreadable' ? 'return 1' : `echo '${v}'`} ;;`)
  .join('\n')}
        *) echo missing ;;
      esac ;;
    *) return 1 ;;
  esac
}
ssh() { echo "ssh $*" >> "$CALLS"; cat > /dev/null; }
`;
        try {
          const result = planShell(
            harness + lateInherit.run,
            {
              CALLS: calls,
              HOME: dir,
              SHA: targetSha,
              DEPTH: '60',
              STATUS_CONTEXT: 'backup-engine/certified',
              GITHUB_REPOSITORY: 'o/r',
              GITHUB_SERVER_URL: 'https://github.com',
              GITHUB_RUN_ID: '701',
              RUN_ID: '701',
              RUN_ATTEMPT: '1',
              SSH_KEY: 'fixture-key-not-a-credential',
              STANDBY_HOST: '192.0.2.1',
              STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
            },
            repo.dir
          );
          return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      it('late_inherit inherits a newly certified identical ancestor after lease acquisition and immediately releases the host lease', () => {
        const f = fixture();
        try {
          const r = runLateInherit(f, f.shas.c3, { [f.shas.c1]: 'success' });
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain(`INHERITED: Inherited from ${f.shas.c1}`);
          expect(r.stdout).toContain('inherited=1');
          expect(r.calls).toContain(`repos/o/r/statuses/${f.shas.c3}`);
          expect(r.calls).toContain('-f state=success');
          expect(r.calls).toMatch(
            /ssh .*-o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15/
          );
        } finally {
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('late_inherit releases the lease immediately if the target SHA itself became certified while waiting', () => {
        const f = fixture();
        try {
          const r = runLateInherit(f, f.shas.c3, { [f.shas.c3]: 'success' });
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain(`ALREADY CERTIFIED: ${f.shas.c3}`);
          expect(r.stdout).toContain('inherited=1');
          expect(r.calls).not.toContain(`repos/o/r/statuses/${f.shas.c3}`);
          expect(r.calls).toMatch(
            /ssh .*-o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15/
          );
        } finally {
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('late_inherit keeps the lease and certifies in full on failure, unreadable status, qualification boundary, or failed write', () => {
        const f = fixture();
        try {
          const failedAncestor = runLateInherit(f, f.shas.c3, {
            [f.shas.c2]: 'failure',
            [f.shas.c1]: 'success',
          });
          expect(failedAncestor.status, failedAncestor.stderr).toBe(0);
          expect(failedAncestor.stdout).toContain('inherited=0');
          expect(failedAncestor.calls).not.toContain('ssh ');
          expect(failedAncestor.calls).not.toContain('repos/o/r/statuses/');

          const unreadable = runLateInherit(f, f.shas.c3, {
            [f.shas.c2]: 'unreadable',
            [f.shas.c1]: 'success',
          });
          expect(unreadable.status, unreadable.stderr).toBe(0);
          expect(unreadable.stdout).toContain('inherited=0');
          expect(unreadable.calls).not.toContain('ssh ');

          const writeFailed = runLateInherit(f, f.shas.c3, { [f.shas.c1]: 'success' }, 1);
          expect(writeFailed.status, writeFailed.stderr).toBe(0);
          expect(writeFailed.stdout).toContain('could not write the late inherited certificate');
          expect(writeFailed.stdout).toContain('inherited=0');
          expect(writeFailed.calls).not.toContain('ssh ');

          f.write('supabase/migrations/20261121000000.sql', 'select 1;\n');
          const migSha = f.commit('migration changes backup_projection');
          const boundary = runLateInherit(f, migSha, { [f.shas.c3]: 'success' });
          expect(boundary.status, boundary.stderr).toBe(0);
          expect(boundary.stdout).toContain('qualification inputs differ');
          expect(boundary.stdout).toContain('inherited=0');
          expect(boundary.calls).not.toContain('ssh ');
        } finally {
          rmSync(f.dir, { recursive: true, force: true });
        }
      });
    });

    // 2026-11-21 (O1): runner-side mid-soak yield when a soaking push commit
    // becomes unselectable before the next scheduled cutoff while keeping the
    // offline standby host 100% network-free.
    describe('mid-soak yield for obsolete unselectable push runs (O1)', () => {
      const certifyJob = backup.jobs.certify;
      const certifyStep = certifyJob.steps.find((s: any) => s.id === 'certify');
      const publishStep = certifyJob.steps.find(
        (s: any) => s.name === 'Publish the verdict on the exact commit'
      );
      const certifyCheckout = certifyJob.steps.find((s: any) =>
        s.uses?.startsWith('actions/checkout')
      );

      // 2026-11-22T02:30:00Z = 2026-11-21 20:30 CST -> 60m (3600s < 4500s) before 21:30 CST (03:30Z) cutoff.
      const CLOSE_TO_CUTOFF_EPOCH = String(Math.floor(Date.parse('2026-11-22T02:30:00Z') / 1000));
      // 2026-11-22T02:00:00Z = 2026-11-21 20:00 CST -> 90m (5400s) before 21:30 CST cutoff: no longer a reason to keep soaking (O35).
      const FAR_FROM_CUTOFF_EPOCH = String(Math.floor(Date.parse('2026-11-22T02:00:00Z') / 1000));

      function withOrigin(f: ReturnType<typeof fixture>) {
        const remote = mkdtempSync(resolve(tmpdir(), 'backup-o1-origin-'));
        const cleanEnv = hookFreeEnv();
        const r = spawnSync('git', ['init', '-q', '--bare', remote], {
          encoding: 'utf8',
          env: cleanEnv,
        });
        if (r.status !== 0) throw new Error(r.stderr);
        f.git('remote', 'add', 'origin', remote);
        f.git('push', '-q', 'origin', 'main');
        return {
          remote,
          pushMain: () => f.git('push', '-q', 'origin', 'main'),
          cleanup: () => rmSync(remote, { recursive: true, force: true }),
        };
      }

      function runCertifyStep(
        repo: ReturnType<typeof fixture>,
        opts: {
          sha: string;
          event?: string;
          freezeBaseline?: string;
          planPriority?: string;
          newerWaiting?: string;
          nowEpoch?: string;
          soakSeconds?: number;
          breakRemote?: boolean;
          // O16: what production's installed set says about the soaking copy.
          copyState?: 'stale' | 'definitions' | 'current' | 'unreadable' | 'no-evidence';
        }
      ) {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-o1-certify-'));
        const copyState = opts.copyState ?? 'no-evidence';
        const A64 = 'a'.repeat(64);
        const toolOut: Record<string, string> = {
          stale:
            "printf '%s\\n' due=true production=" +
            A64 +
            " pending=; echo 'reason=the copy (bbbbbbbbbbbb) lacks installed migration 20261123002808; production holds aaaaaaaaaaaa' >&2",
          definitions:
            "printf '%s\\n' due=true production=" +
            A64 +
            ' pending=; echo "reason=the copy does not hold production\'s definition of public.fn_x()" >&2',
          current:
            "printf '%s\\n' due=false production=" +
            A64 +
            " pending=; echo 'reason=the copy holds production installed set aaaaaaaaaaaa' >&2",
          unreadable:
            "echo due=true; echo 'reason=production installed migrations are unreadable (psql exit 2); refreshing' >&2",
          'no-evidence': 'echo UNEXPECTED_TOOL_CALL >> "$CALLS"; echo due=true',
        };
        const calls = resolve(dir, 'calls');
        const summary = resolve(dir, 'summary.md');
        const soakS = opts.soakSeconds ?? 4;
        const harness = `
ssh() {
  echo "ssh $*" >> "$CALLS"
  case "$*" in
    *'standby-engine certify'*)
      sleep ${soakS}
      echo '{"verdict":"pass","sha":"${opts.sha}"}'
      return 0 ;;
    *'stop_for_restore'*)
      echo "CLEANUP_CALLED" >> "$CALLS"
      return 0 ;;
    *'schema-evidence.json'*)
      ${copyState === 'no-evidence' ? 'return 0' : `echo '{"fixture":"copy-evidence"}'`} ;;
    *'database.json'*)
      ${copyState === 'no-evidence' ? 'return 0' : `echo '${'c'.repeat(64)}'`} ;;
    *) return 0 ;;
  esac
}
python3() {
  if [ "$1" = -B ] && [ "$2" = server/scripts/engine-release-installed-migrations.py ] && [ "$3" = refresh-due ]; then
    echo "TOOL $*" >> "$CALLS"
    [ -n "\${DATABASE_URL:-}" ] || { echo "TOOL_WITHOUT_DATABASE_URL" >> "$CALLS"; }
    ${toolOut[copyState]}
    return 0
  fi
  command python3 "$@"
}
scp() {
  echo "scp $*" >> "$CALLS"
  printf '%s\\n' '{"migrations":[]}' > schema-evidence.json
  return 0
}
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *actions/workflows/backup-engine.yml/runs*) ${
      opts.newerWaiting === 'FAIL'
        ? 'echo "HTTP 502" >&2; return 1'
        : `echo '${opts.newerWaiting ?? '1'}'`
    } ;;
    *) return 1 ;;
  esac
}
`;
        if (opts.breakRemote) {
          repo.git('remote', 'set-url', 'origin', resolve(dir, 'missing-origin.git'));
        }
        try {
          const result = planShell(
            harness + certifyStep.run,
            {
              CALLS: calls,
              HOME: dir,
              GITHUB_STEP_SUMMARY: summary,
              SSH_KEY: 'fixture-key-not-a-credential',
              STANDBY_HOST: '192.0.2.1',
              STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
              SHA: opts.sha,
              CONTROL_SHA: opts.sha,
              REFRESH_RESULT: 'success',
              EVENT: opts.event ?? 'push',
              FREEZE_BASELINE: opts.freezeBaseline ?? '',
              PLAN_PRIORITY: opts.planPriority ?? 'none',
              RUN_ID: '800',
              GITHUB_REPOSITORY: 'o/r',
              YIELD_CHECK_INTERVAL: '1',
              O1_NOW_EPOCH: opts.nowEpoch ?? CLOSE_TO_CUTOFF_EPOCH,
              DATABASE_URL: 'postgres://fixture',
            },
            repo.dir
          );
          return {
            ...result,
            calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '',
            summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
          };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      it('keeps standby-engine.sh strictly offline and wires O1 runner-side inputs + verdict suppression', () => {
        const standby = read('server/standby/standby-engine.sh');
        const cmdCertify = standby.slice(standby.indexOf('cmd_certify() {'));
        expect(cmdCertify).not.toContain('gh api');
        expect(cmdCertify).not.toContain('git fetch');
        expect(certifyCheckout.with['sparse-checkout']).toContain(
          'scripts/ci/read-engine-prequalification.py'
        );
        expect(certifyCheckout.with['sparse-checkout-cone-mode']).toBe(false);
        expect(certifyStep.env.EVENT).toBe('${{ github.event_name }}');
        expect(certifyStep.env.FREEZE_BASELINE).toBe('${{ needs.plan.outputs.freeze_baseline }}');
        expect(certifyStep.env.PLAN_PRIORITY).toBe('${{ needs.plan.outputs.priority }}');
        expect(certifyStep.env.RUN_ID).toBe('${{ github.run_id }}');
        // O16: the migration-only yield reads production's installed set read-only.
        expect(certifyStep.env.DATABASE_URL).toBe('${{ secrets.DATABASE_URL }}');
        expect(certifyCheckout.with['sparse-checkout']).toContain('server/scripts');
        expect(certifyCheckout.with['sparse-checkout']).toContain(
          'server/standby/schema-evidence.py'
        );
        expect(certifyStep.run).toContain(
          'python3 -B server/scripts/engine-release-installed-migrations.py refresh-due'
        );
        expect(publishStep.env.YIELDED).toBe('${{ steps.certify.outputs.yielded }}');
        expect(publishStep.if).toBe('always()');
      });

      it('yields cleanly mid-soak when CONTROL_INPUTS projection diverges on origin/main within 75m of cutoff with a waiting push run, and publishes NO failure/error status', () => {
        const f = fixture();
        const origin = withOrigin(f);
        try {
          const soakingSha = f.shas.c1;
          f.write('server/scripts/engine-release-transaction.sh', '# updated control script\n');
          f.commit('c4: control input changed on main');
          origin.pushMain();
          f.git('checkout', '-q', soakingSha);

          const r = runCertifyStep(f, { sha: soakingSha, soakSeconds: 10 });
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain('YIELDED_OBSOLETE:');
          expect(r.stdout).toContain('control_projection_diverged');
          // A release-control divergence needs no production read (O16).
          expect(r.calls).not.toContain(
            'TOOL -B server/scripts/engine-release-installed-migrations.py refresh-due'
          );
          expect(r.stdout).toContain('yielded=1');
          expect(r.stdout).not.toContain('rc=1');
          expect(r.calls).toContain('CLEANUP_CALLED');
          expect(r.calls).toContain('stop_for_restore');
          expect(r.summary).toContain('YIELDED_OBSOLETE');

          // Publish step exits 0 and writes ZERO failure/error status when YIELDED=1.
          const pubCalls = mkdtempSync(resolve(tmpdir(), 'backup-o1-pub-'));
          const pubLog = resolve(pubCalls, 'calls');
          try {
            const pub = planShell(`gh() { echo "WRITE $*" >> "$CALLS"; }\n` + publishStep.run, {
              CALLS: pubLog,
              SHA: soakingSha,
              RC: '',
              YIELDED: '1',
              JOB_STATUS: 'success',
              INSTALLED: '',
              PENDING: 'success',
              POLICY: 'success',
              REFRESH: 'success',
              TURN: '1',
              GITHUB_REPOSITORY: 'o/r',
              GITHUB_SERVER_URL: 'https://github.com',
              GITHUB_RUN_ID: '800',
              STATUS_CONTEXT: 'backup-engine/certified',
            });
            expect(pub.status, pub.stderr).toBe(0);
            expect(pub.stdout).toContain('YIELDED_OBSOLETE');
            expect(existsSync(pubLog) ? readFileSync(pubLog, 'utf8') : '').toBe('');
          } finally {
            rmSync(pubCalls, { recursive: true, force: true });
          }
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('yields cleanly mid-soak when supabase/migrations diverges on origin/main AND production installed what the copy lacks (or changed a required definition), within 75m of cutoff with a waiting push run', () => {
        const f = fixture();
        const origin = withOrigin(f);
        try {
          const soakingSha = f.shas.c1;
          f.write('supabase/migrations/20261122023000_new.sql', 'select 1;\n');
          f.commit('c4: migration merged on main');
          origin.pushMain();
          f.git('checkout', '-q', soakingSha);

          for (const copyState of ['stale', 'definitions'] as const) {
            const r = runCertifyStep(f, { sha: soakingSha, soakSeconds: 10, copyState });
            expect(r.status, r.stderr).toBe(0);
            expect(r.stdout).toContain('YIELDED_OBSOLETE:');
            expect(r.stdout).toContain('migrations_tree_diverged,migrations_installed_after_copy');
            expect(r.stdout).toContain('yielded=1');
            expect(r.calls).toContain('CLEANUP_CALLED');
            expect(r.calls).toContain(
              `TOOL -B server/scripts/engine-release-installed-migrations.py refresh-due --copy-evidence o1-copy-evidence.json --copy-evidence-sha ${'c'.repeat(64)}`
            );
            expect(r.calls).not.toContain('TOOL_WITHOUT_DATABASE_URL');
          }
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      // O16 replay (Backup 45099104481, 2026-11-23T02:44:02Z): f2fa22672808 merged
      // 20261123002808 inside the O3 deferral, so production had not installed
      // it and a9fde5791f0a was still the one selectable candidate.
      it('O16: does NOT yield on a merged-but-uninstalled (deferred) migration, nor when the copy or production is unreadable; keeps soaking and says so once', () => {
        const f = fixture();
        const origin = withOrigin(f);
        try {
          const soakingSha = f.shas.c1;
          f.write('supabase/migrations/20261123002808_deferred.sql', 'select 1;\n');
          f.commit('c4: migration merged inside the O3 deferral');
          origin.pushMain();
          f.git('checkout', '-q', soakingSha);

          const deferred = runCertifyStep(f, {
            sha: soakingSha,
            soakSeconds: 4,
            copyState: 'current',
          });
          expect(deferred.status, deferred.stderr).toBe(0);
          expect(deferred.stdout).toContain('rc=0');
          expect(deferred.stdout).not.toContain('yielded=1');
          expect(deferred.stdout).not.toContain('YIELDED_OBSOLETE');
          expect(deferred.calls).not.toContain('CLEANUP_CALLED');
          expect(deferred.calls).toContain(
            'TOOL -B server/scripts/engine-release-installed-migrations.py refresh-due'
          );
          const notes = deferred.stdout.split('production has not installed them').length - 1;
          expect(notes).toBe(1);

          for (const copyState of ['unreadable', 'no-evidence'] as const) {
            const r = runCertifyStep(f, { sha: soakingSha, soakSeconds: 3, copyState });
            expect(r.status, r.stderr).toBe(0);
            expect(r.stdout).toContain('rc=0');
            expect(r.stdout).not.toContain('yielded=1');
            expect(r.calls).not.toContain('CLEANUP_CALLED');
            expect(r.stdout).toContain(
              'could not tell whether production installed a migration the copy lacks'
            );
            // Without bound copy evidence the production read is never attempted.
            if (copyState === 'no-evidence') {
              expect(r.calls).not.toContain('refresh-due');
              expect(r.calls).not.toContain('UNEXPECTED_TOOL_CALL');
            }
          }
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('does NOT yield when SHA is still selectable (only ordinary server code changed) or no newer waiting push exists, and yields far from cutoff (>= 75m) since O35', () => {
        const f = fixture();
        const origin = withOrigin(f);
        try {
          // Only server/src/index.ts changed on main: neither projection nor migrations diverged.
          const soakingSha = f.shas.c1;
          f.write('server/src/index.ts', 'export const v = 99;\n');
          f.commit('c4: ordinary server change only');
          origin.pushMain();
          f.git('checkout', '-q', soakingSha);

          const stillSelectable = runCertifyStep(f, { sha: soakingSha, soakSeconds: 2 });
          expect(stillSelectable.status, stillSelectable.stderr).toBe(0);
          expect(stillSelectable.stdout).toContain('rc=0');
          expect(stillSelectable.stdout).not.toContain('yielded=1');
          expect(stillSelectable.calls).not.toContain('CLEANUP_CALLED');

          // Now diverge CONTROL_INPUTS on main, and test >= 75m from cutoff (yields since O35) and 0 waiting runs (keeps soaking).
          f.git('checkout', '-q', 'main');
          f.write('server/scripts/engine-release-transaction.sh', '# diverged\n');
          f.commit('c5: control diverged');
          origin.pushMain();
          f.git('checkout', '-q', soakingSha);

          const farFromCutoff = runCertifyStep(f, {
            sha: soakingSha,
            nowEpoch: FAR_FROM_CUTOFF_EPOCH,
            soakSeconds: 2,
          });
          // O35 (2026-11-26): an unselectable soak yields however far the
          // cutoff is. Backup 45938154669 soaked a certificate that could
          // never be selected for 38 more minutes because the 01:00 cutoff
          // was 134 minutes away, and the selectable commit's run waited.
          expect(farFromCutoff.status, farFromCutoff.stderr).toBe(0);
          expect(farFromCutoff.stdout).toContain('YIELDED_OBSOLETE:');
          expect(farFromCutoff.stdout).toContain('control_projection_diverged');
          expect(farFromCutoff.stdout).toContain('5400s to next cutoff');
          expect(farFromCutoff.stdout).toContain('yielded=1');
          expect(farFromCutoff.stdout).not.toContain('rc=');
          expect(farFromCutoff.calls).toContain('CLEANUP_CALLED');

          const noWaitingRun = runCertifyStep(f, {
            sha: soakingSha,
            newerWaiting: '0',
            soakSeconds: 2,
          });
          expect(noWaitingRun.status, noWaitingRun.stderr).toBe(0);
          expect(noWaitingRun.stdout).toContain('rc=0');
          expect(noWaitingRun.stdout).not.toContain('yielded=1');
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });

      it('NEVER yields booking, freeze_baseline, workflow_dispatch, schedule, or repository_dispatch runs, and keeps soaking on unreadable checks (CLAUDE.md 10.86)', () => {
        const f = fixture();
        const origin = withOrigin(f);
        try {
          const soakingSha = f.shas.c1;
          f.write('supabase/migrations/20261122023100_new.sql', 'select 1;\n');
          f.commit('c4: migration diverged');
          origin.pushMain();
          f.git('checkout', '-q', soakingSha);

          for (const cfg of [
            { planPriority: 'booking' },
            { freezeBaseline: '1' },
            { event: 'workflow_dispatch' },
            { event: 'schedule' },
            { event: 'repository_dispatch' },
          ]) {
            const r = runCertifyStep(f, { sha: soakingSha, soakSeconds: 1, ...cfg });
            expect(r.status, r.stderr).toBe(0);
            expect(r.stdout).toContain('rc=0');
            expect(r.stdout).not.toContain('yielded=1');
            expect(r.calls).not.toContain('CLEANUP_CALLED');
            expect(r.calls).not.toContain('gh ');
          }

          // CLAUDE.md 10.86: unreadable gh api -> keep soaking.
          const ghFail = runCertifyStep(f, {
            sha: soakingSha,
            newerWaiting: 'FAIL',
            soakSeconds: 2,
          });
          expect(ghFail.status, ghFail.stderr).toBe(0);
          expect(ghFail.stdout).toContain('rc=0');
          expect(ghFail.stdout).not.toContain('yielded=1');
          expect(ghFail.calls).not.toContain('CLEANUP_CALLED');

          // CLAUDE.md 10.86: unreadable git fetch -> keep soaking.
          const fetchFail = runCertifyStep(f, {
            sha: soakingSha,
            breakRemote: true,
            soakSeconds: 2,
          });
          expect(fetchFail.status, fetchFail.stderr).toBe(0);
          expect(fetchFail.stdout).toContain('rc=0');
          expect(fetchFail.stdout).not.toContain('yielded=1');
          expect(fetchFail.calls).not.toContain('CLEANUP_CALLED');
        } finally {
          origin.cleanup();
          rmSync(f.dir, { recursive: true, force: true });
        }
      });
    });

    // 2026-11-22 (O7): pre-soak uninstalled-migration guard. An ordinary push
    // commit carrying recently-added ordinary migrations still absent from
    // production after refresh-due's --wait can never pass select-daily-engine.py
    // on a copy lacking them. Defer immediately, release the exclusive Backup
    // host lease atomically, skip Build/Export/Ship/late_priority/certify, and
    // write zero status. Freeze-baseline, booking, force, manual, nightly, and
    // post-seal runs are exempt; unreadable production fails open.
    describe('O7: pre-soak uninstalled-migration guard defers unselectable push runs and hands back the host', () => {
      const due = backup.jobs.refresh.steps.find((s: any) => s.id === 'due');
      const build = backup.jobs.refresh.steps.find((s: any) =>
        /^Build the batched read-only export client/.test(s.name)
      );
      const exp = backup.jobs.refresh.steps.find((s: any) =>
        /^Export the production structure/.test(s.name)
      );
      const ship = backup.jobs.refresh.steps.find((s: any) =>
        /^Ship to the standby host/.test(s.name)
      );
      const latePriority = backup.jobs.refresh.steps.find((s: any) => s.id === 'late_priority');
      const sha = 'd'.repeat(40);

      function runDue(verdictOut: string, overrides: Partial<Record<string, string>> = {}) {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-due-o7-'));
        const calls = resolve(dir, 'calls');
        const summary = resolve(dir, 'summary.md');
        const harness = `sha256sum() { echo "0000000000000000000000000000000000000000000000000000000000000000  $1"; }
ssh() {
  echo "ssh $*" >> "$CALLS"
  case "$*" in
    *"python3 - '"*)
      cat > /dev/null
      echo "LEASE_RELEASED $*" >> "$CALLS"
      ;;
    *"database.json"*)
      echo "2026-11-22T07:00:00Z"
      ;;
    *"schema-evidence.json"*)
      echo "{}"
      ;;
  esac
}
python3() {
  if [ "$1" = -B ] && [ "$2" = server/scripts/engine-release-installed-migrations.py ]; then
    printf '%s\\n' ${verdictOut
      .split('\n')
      .map((line) => JSON.stringify(line))
      .join(' ')}
    echo "reason=mock contents" >&2
    return 0
  fi
  command python3 "$@"
}
date() { echo "2026-11-22"; }
git() { echo "2026-11-22T07:00:00Z"; }
`;
        try {
          const result = planShell(
            harness + due.run,
            {
              CALLS: calls,
              HOME: dir,
              GITHUB_STEP_SUMMARY: summary,
              SSH_KEY: 'fixture-key-not-a-credential',
              STANDBY_HOST: '192.0.2.1',
              STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
              DATABASE_URL: 'postgres://fixture',
              MODE: 'auto',
              EVENT: 'push',
              CONTROL: sha,
              RUN_ID: '888',
              RUN_ATTEMPT: '1',
              SHA: sha,
              FREEZE_BASELINE: '',
              PLAN_PRIORITY: 'none',
              ...overrides,
            },
            dir
          );
          return {
            ...result,
            calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '',
            summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
          };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      it('wires env, Build/Export/Ship/late_priority guards, and refresh.outputs.deferred into certify', () => {
        expect(due.env.RUN_ID).toBe('${{ github.run_id }}');
        expect(due.env.RUN_ATTEMPT).toBe('${{ github.run_attempt }}');
        expect(due.env.SHA).toBe(
          '${{ steps.late_retarget.outputs.sha || needs.plan.outputs.sha }}'
        );
        expect(due.env.FREEZE_BASELINE).toBe('${{ needs.plan.outputs.freeze_baseline }}');
        expect(due.env.PLAN_PRIORITY).toBe('${{ needs.plan.outputs.priority }}');
        for (const step of [build, exp, ship, latePriority]) {
          expect(step.if).toContain("steps.due.outputs.deferred != '1'");
        }
        expect(backup.jobs.refresh.outputs.deferred).toContain("steps.due.outputs.deferred == '1'");
        expect(backup.jobs.certify.if).toContain("needs.refresh.outputs.deferred != '1'");
      });

      it('defers an ordinary push run carrying uninstalled ordinary migrations, releases lease atomically, and skips certify', () => {
        const r = runDue(
          'due=false\nproduction=' + 'a'.repeat(64) + '\npending=20261122025656,20261122025900'
        );
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain(
          `DEFERRED: ${sha} carries uninstalled ordinary migration(s) (20261122025656,20261122025900)`
        );
        expect(r.stdout).toContain('due=false');
        expect(r.stdout).toContain('deferred=1');
        expect(r.summary).toContain('20261122025656,20261122025900');
        expect(r.calls).toContain('LEASE_RELEASED');
        expect(r.calls).toMatch(
          /ssh -i .* -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 .*python3 - '888' '1'/
        );
      });

      it.each([
        ['freeze_baseline', { FREEZE_BASELINE: '1' }],
        ['booking priority', { PLAN_PRIORITY: 'booking' }],
        ['forced refresh', { MODE: 'force' }],
        ['workflow_dispatch', { EVENT: 'workflow_dispatch' }],
        ['schedule', { EVENT: 'schedule' }],
        ['repository_dispatch', { EVENT: 'repository_dispatch' }],
      ])('exempts %s runs even when pending migrations exist', (_label, overrides) => {
        const r = runDue(
          'due=true\nproduction=' + 'a'.repeat(64) + '\npending=20261122025656',
          overrides
        );
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).not.toContain('DEFERRED:');
        expect(r.stdout).not.toContain('deferred=1');
        expect(r.calls).not.toContain('LEASE_RELEASED');
      });

      it.each([
        [
          'all installed (empty pending=)',
          'due=false\nproduction=' + 'a'.repeat(64) + '\npending=',
        ],
        ['unreadable production (no pending=)', 'due=true'],
      ])('does not defer when %s', (_label, verdictOut) => {
        const r = runDue(verdictOut);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).not.toContain('DEFERRED:');
        expect(r.stdout).not.toContain('deferred=1');
        expect(r.calls).not.toContain('LEASE_RELEASED');
      });
    });

    // 2026-11-22 (O10, run 45032836372): a late-delivered schedule run on a SHA
    // already certified for production's current installed migrations with a
    // fresh copy must hand the host back cleanly (Layer 1), and certify's
    // pending step must never overwrite a standing success certificate with
    // pending (Layer 2).
    describe('O10: standing success certificate is never blacked out or redundantly re-soaked (45032836372)', () => {
      const due = backup.jobs.refresh.steps.find((s: any) => s.id === 'due');
      const certify = backup.jobs.certify;
      const pendingStep = certify.steps.find((s: any) => s.id === 'pending');
      const publishStep = certify.steps.find((s: any) => /Publish the verdict/.test(s.name));
      const sha = 'e'.repeat(40);
      const compDigest = 'b'.repeat(64);
      const otherDigest = '9'.repeat(64);

      function runDueO10(
        verdictOut: string,
        standingLine: string | 'FAIL',
        overrides: Partial<Record<string, string>> = {},
        dateStub = 'date() { echo "2026-11-22"; }'
      ) {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-due-o10-'));
        const calls = resolve(dir, 'calls');
        const summary = resolve(dir, 'summary.md');
        const ghBody =
          standingLine === 'FAIL'
            ? 'echo "HTTP 502" >&2; return 1'
            : standingLine.includes('\t')
              ? `printf '%s\\t%s\\n' ${JSON.stringify(standingLine.split('\t')[0])} ${JSON.stringify(standingLine.split('\t').slice(1).join('\t'))}`
              : `printf '%s\\n' ${JSON.stringify(standingLine)}`;
        const harness = `sha256sum() { echo "0000000000000000000000000000000000000000000000000000000000000000  $1"; }
ssh() {
  echo "ssh $*" >> "$CALLS"
  case "$*" in
    *"python3 - '"*)
      cat > /dev/null
      echo "LEASE_RELEASED $*" >> "$CALLS"
      ;;
    *"database.json"*)
      echo "2026-11-22T14:00:00Z"
      ;;
    *"schema-evidence.json"*)
      echo "{}"
      ;;
  esac
}
gh() {
  echo "gh $*" >> "$CALLS"
  ${ghBody}
}
python3() {
  if [ "$1" = -B ] && [ "$2" = server/scripts/engine-release-installed-migrations.py ]; then
    printf '%s\\n' ${verdictOut
      .split('\n')
      .map((line) => JSON.stringify(line))
      .join(' ')}
    echo "reason=mock contents" >&2
    return 0
  fi
  command python3 "$@"
}
${dateStub}
git() { echo "2026-11-22T10:15:00Z"; }
`;
        try {
          const result = planShell(
            harness + due.run,
            {
              CALLS: calls,
              HOME: dir,
              GITHUB_STEP_SUMMARY: summary,
              GITHUB_REPOSITORY: 'o/r',
              STATUS_CONTEXT: 'backup-engine/certified',
              SSH_KEY: 'fixture-key-not-a-credential',
              STANDBY_HOST: '192.0.2.1',
              STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
              DATABASE_URL: 'postgres://fixture',
              MODE: 'auto',
              EVENT: 'schedule',
              CONTROL: sha,
              RUN_ID: '999',
              RUN_ATTEMPT: '1',
              SHA: sha,
              FREEZE_BASELINE: '',
              PLAN_PRIORITY: 'none',
              ...overrides,
            },
            dir
          );
          return {
            ...result,
            calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '',
            summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
          };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      function runPending(current: string | 'FAIL') {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-pending-o10-'));
        const calls = resolve(dir, 'calls');
        const harness = `gh() {
  case "$*" in
    *'-f state='*) echo "WRITE $*" >> "$CALLS" ;;
    *'/statuses'*) echo "READ $*" >> "$CALLS"; ${
      current === 'FAIL' ? 'echo "HTTP 502" >&2; return 1' : `echo '${current}'`
    } ;;
    *) return 1 ;;
  esac
}
`;
        try {
          const result = planShell(harness + pendingStep.run, {
            CALLS: calls,
            SHA: sha,
            GITHUB_REPOSITORY: 'o/r',
            GITHUB_SERVER_URL: 'https://github.com',
            GITHUB_RUN_ID: '45032836372',
            STATUS_CONTEXT: 'backup-engine/certified',
          });
          return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      it('wires GH_TOKEN and --sha into due, and WROTE_PENDING into Publish the verdict', () => {
        expect(due.env.GH_TOKEN).toBe('${{ github.token }}');
        expect(due.run).toContain('--control "$CONTROL" --sha "$SHA" --wait 240');
        expect(publishStep.env.WROTE_PENDING).toBe('${{ steps.pending.outputs.wrote }}');
        expect(publishStep.run).toContain(
          'if [ "$PENDING" != success ] || [ "${WROTE_PENDING:-}" = 0 ]; then'
        );
      });

      it.each(['schedule', 'push'])(
        'Layer 1 replay (45032836372): %s run with due=false and standing success for current comparable digest releases lease and defers without re-soaking',
        (event) => {
          const r = runDueO10(
            `due=false\nproduction=${compDigest}\npending=\ncomparable=${compDigest}`,
            `success\tCertified on the Backup Engine; installed migrations ${compDigest}`,
            { EVENT: event }
          );
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain(
            `ALREADY CERTIFIED: ${sha} already carries backup-engine/certified = success for current installed migrations (${compDigest})`
          );
          expect(r.stdout).toContain('due=false');
          expect(r.stdout).toContain('deferred=1');
          expect(r.summary).toContain(compDigest);
          expect(r.calls).toContain('LEASE_RELEASED');
        }
      );

      it('Layer 1 proceeds normally when copy is due (stale copy or new Chicago day), forced, freeze_baseline, or non-schedule/push event', () => {
        // Stale copy (contents_due=true)
        const stale = runDueO10(
          `due=true\nproduction=${compDigest}\npending=\ncomparable=${compDigest}`,
          `success\tCertified on the Backup Engine; installed migrations ${compDigest}`
        );
        expect(stale.status, stale.stderr).toBe(0);
        expect(stale.stdout).not.toContain('deferred=1');
        expect(stale.calls).not.toContain('LEASE_RELEASED');
        // New Chicago day for schedule (today != copy_day -> due=true)
        const newDay = runDueO10(
          `due=false\nproduction=${compDigest}\npending=\ncomparable=${compDigest}`,
          `success\tCertified on the Backup Engine; installed migrations ${compDigest}`,
          { EVENT: 'schedule' },
          'date() { if [ "$1" = -d ]; then echo "2026-11-21"; else echo "2026-11-22"; fi; }'
        );
        expect(newDay.status, newDay.stderr).toBe(0);
        expect(newDay.stdout).toContain('due=true');
        expect(newDay.stdout).not.toContain('deferred=1');
        expect(newDay.calls).not.toContain('LEASE_RELEASED');
        // Exemptions: force, freeze_baseline, workflow_dispatch, repository_dispatch
        for (const overrides of [
          { MODE: 'force' },
          { FREEZE_BASELINE: '1' },
          { EVENT: 'workflow_dispatch' },
          { EVENT: 'repository_dispatch' },
        ]) {
          const r = runDueO10(
            `due=false\nproduction=${compDigest}\npending=\ncomparable=${compDigest}`,
            `success\tCertified on the Backup Engine; installed migrations ${compDigest}`,
            overrides
          );
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).not.toContain('deferred=1');
          expect(r.calls).not.toContain('LEASE_RELEASED');
        }
      });

      it.each([
        [
          'mismatched digest',
          `success\tCertified on the Backup Engine; installed migrations ${otherDigest}`,
        ],
        [
          'inherited-only description',
          `success\tInherited from ${sha}: identical engine source (abcdef123456)`,
        ],
        ['pending status', 'pending\tBackup Engine is building, booting and soaking this version'],
        ['empty/missing status', ''],
        ['unreadable GitHub API', 'FAIL' as const],
      ])('Layer 1 proceeds normally on %s', (_label, standingLine) => {
        const r = runDueO10(
          `due=false\nproduction=${compDigest}\npending=\ncomparable=${compDigest}`,
          standingLine
        );
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).not.toContain('deferred=1');
        expect(r.calls).not.toContain('LEASE_RELEASED');
      });

      it('Layer 2: pending step preserves standing success (and unreadable status) with wrote=0, and writes pending with wrote=1 otherwise', () => {
        for (const keep of ['success', 'FAIL'] as const) {
          const r = runPending(keep);
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain('PRESERVED:');
          expect(r.stdout).toContain('wrote=0');
          expect(r.calls).not.toContain('WRITE ');
        }
        for (const overwrite of ['missing', 'pending', 'failure', 'error']) {
          const r = runPending(overwrite);
          expect(r.status, r.stderr).toBe(0);
          expect(r.stdout).toContain('wrote=1');
          expect(r.calls).toContain('WRITE ');
          expect(r.calls).toContain('-f state=pending');
        }
      });

      it('Layer 2: Publish protects standing success on early error when WROTE_PENDING=0, while still publishing authoritative certify verdicts', () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'backup-pub-o10-'));
        const calls = resolve(dir, 'calls');
        const fakeGh = `gh() {
  case "$*" in
    *'-f state='*) echo "WRITE $*" >> "$CALLS" ;;
    *'/statuses'*) echo "READ $*" >> "$CALLS"; echo 'success' ;;
    *) return 1 ;;
  esac
}
`;
        const baseEnv = {
          CALLS: calls,
          SHA: sha,
          GITHUB_REPOSITORY: 'o/r',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_RUN_ID: '45032836372',
          STATUS_CONTEXT: 'backup-engine/certified',
          PENDING: 'success',
          WROTE_PENDING: '0',
          REFRESH: 'success',
          TURN: '1',
        };
        try {
          // Early error (e.g. checkout failed before policy/certify): standing success stands!
          const early = planShell(fakeGh + publishStep.run, {
            ...baseEnv,
            RC: '',
            INSTALLED: '',
            POLICY: 'skipped',
            JOB_STATUS: 'failure',
          });
          expect(early.status).toBe(1);
          expect(early.stdout).toContain(`success on ${sha} stands`);
          expect(readFileSync(calls, 'utf8')).not.toContain('WRITE ');

          // Authoritative new success still writes!
          writeFileSync(calls, '');
          const ok = planShell(fakeGh + publishStep.run, {
            ...baseEnv,
            RC: '0',
            INSTALLED: compDigest,
            POLICY: 'success',
            JOB_STATUS: 'success',
          });
          expect(ok.status, ok.stderr).toBe(0);
          expect(readFileSync(calls, 'utf8')).toContain('-f state=success');

          // Authoritative new refusal still writes!
          writeFileSync(calls, '');
          const bad = planShell(fakeGh + publishStep.run, {
            ...baseEnv,
            RC: '1',
            INSTALLED: '',
            POLICY: 'success',
            JOB_STATUS: 'success',
          });
          expect(bad.status).toBe(1);
          expect(readFileSync(calls, 'utf8')).toContain('-f state=failure');
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    });
  });
  it('serializes all Backup candidates via standby host lease without push-eviction cancellations and refreshes only after a successful sealed release', () => {
    expect(backup.concurrency).toEqual({
      group: expect.stringContaining(
        "format('backup-engine-{0}-{1}', github.event_name, github.run_id)"
      ),
      'cancel-in-progress': false,
    });
    expect(backup.concurrency).not.toHaveProperty('queue');
    expect(
      backup.jobs.refresh.steps.some((s: any) => s.name === 'Acquire exclusive Backup host turn')
    ).toBe(true);
    expect(
      backup.jobs.certify.steps.some(
        (s: any) => s.name === 'Release exclusive Backup host turn' && s.if === 'always()'
      )
    ).toBe(true);
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
    // The sender records the exact intent first (scripts/ci/dispatch-intent.mjs).
    const sender = receiver.jobs['certify-production'].steps
      .map((s: any) => String(s.run ?? ''))
      .join('\n');
    expect(sender).toContain('--input "release_run_key=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"');
    expect(sender).toContain('Backup after seal $GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT');
    const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
    expect(plan).toContain('sha="$SEALED_SHA"');
    expect(plan).toContain('refresh=force');
    expect(backup.jobs.certify.if).toBe(
      "always() && needs.plan.outputs.sha != '' && needs.refresh.outputs.deferred != '1' && (!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]')) || (github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e') || (github.event_name == 'workflow_dispatch' && inputs.after_cycle != '')) && !(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')"
    );
    const certify = backup.jobs.certify.steps.find((s: any) => s.id === 'certify');
    expect(certify.env.REFRESH_RESULT).toBe('${{ needs.refresh.result }}');
    expect(certify.run.indexOf('if [ "$REFRESH_RESULT" != success ]; then')).toBeLessThan(
      certify.run.indexOf('ssh -i')
    );
    expect(certify.run).toContain('database_refresh_failed');
    expect(backup.jobs.certify.steps.find((s: any) => s.id === 'certify').run).toContain(
      'standby-engine certify $SHA 900'
    );
  });
});
