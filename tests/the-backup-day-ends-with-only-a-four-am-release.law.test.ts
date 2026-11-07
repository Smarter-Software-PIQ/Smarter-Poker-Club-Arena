/** Owner 2026-11-06: isolated Backup qualification, daily-only replacement. */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
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
        'git() { echo unexpected-mutable-main-read >&2; return 99; }\n' + plan,
        { EVENT: 'push', INPUT_SHA: '', INPUT_REFRESH: 'false', GITHUB_SHA: candidate }
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('sha=' + candidate);
      expect(result.stdout).toContain('refresh=auto');
      for (const step of backup.jobs.certify.steps) {
        if (step.env?.SHA) expect(step.env.SHA).toBe('${{ needs.plan.outputs.sha }}');
      }
    }
  );
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
