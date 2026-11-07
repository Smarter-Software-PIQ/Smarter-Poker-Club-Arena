/** Owner 2026-11-06: isolated Backup qualification, daily-only replacement. */
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
function planShell(script: string, env: NodeJS.ProcessEnv) {
  const dir = mkdtempSync(resolve(tmpdir(), 'backup-plan-'));
  const output = resolve(dir, 'github-output');
  try {
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, ...env, GITHUB_OUTPUT: output },
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
    ['Engine Release ' + 'b'.repeat(40), 'b'.repeat(40), true],
    ['Engine Release ' + 'b'.repeat(40), 'c'.repeat(40), false],
    ['Engine Withdrawal 123-1', 'b'.repeat(40), false],
  ])('executes post-release clone selection for %s', (title, serving, accepted) => {
    const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
    const result = planShell(
      `curl() { printf '%s' '${JSON.stringify({ releaseSha: serving })}'; }\n` + plan,
      {
        EVENT: 'workflow_run',
        INPUT_SHA: '',
        INPUT_REFRESH: 'false',
        GITHUB_SHA: 'a'.repeat(40),
        RELEASE_TITLE: title,
      }
    );
    expect(result.status === 0, result.stderr).toBe(accepted);
    if (accepted) {
      expect(result.stdout).toContain('sha=' + serving);
      expect(result.stdout).toContain('refresh=force');
    } else expect(result.stdout).not.toContain('refresh=force');
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
      expect(backup.jobs.plan.steps[0].env.RUN_ID).toBe('${{ github.run_id }}');
      expect(backup.jobs.plan.steps[0].env.GH_TOKEN).toBe('${{ github.token }}');
      expect(backup.jobs.refresh.if).toBe("needs.plan.outputs.sha != ''");
      expect(backup.jobs.certify.if).toBe("always() && needs.plan.outputs.sha != ''");
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
      ['workflow_run', { RELEASE_TITLE: 'Engine Release ' + candidate }],
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
      expect(result.stdout).not.toContain('sha=' + pushed);
      expect(result.stdout).toContain('refresh=auto');
      expect(result.calls).toContain(`/compare/${pushed}...${newest}`);
      expect(result.calls).toContain(`/commits/${newest}/statuses`);
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
  it('serializes all Backup candidates and refreshes only after a successful sealed release', () => {
    expect(backup.concurrency).toEqual({
      group: 'backup-engine',
      queue: 'max',
      'cancel-in-progress': false,
    });
    expect(backup.on.push.paths).toContain('server/**');
    expect(backup.on.workflow_run).toEqual({ workflows: [receiver.name], types: ['completed'] });
    expect(backup.jobs.plan.if).toContain("github.event.workflow_run.conclusion == 'success'");
    const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
    expect(plan).toContain('[ "$served" = "$sha" ]');
    expect(plan).toContain('refresh=force');
    expect(backup.jobs.certify.if).toBe("always() && needs.plan.outputs.sha != ''");
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
