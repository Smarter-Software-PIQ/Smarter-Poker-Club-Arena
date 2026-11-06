/** Owner 2026-11-06: isolated Backup qualification, daily-only replacement. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
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
  it('retains exact certification and then refuses daytime preparation unconditionally', () => {
    const steps = receiver.jobs.preflight.steps;
    expect(steps.indexOf(gate)).toBe(
      steps.findIndex((s: any) => s.id === 'backup_certificate') + 1
    );
    expect(gate.if).toBeUndefined();
    expect(gate['continue-on-error']).toBeUndefined();
    expect(gate.run).toContain('now.hour == 3 and 30 <= now.minute < 50');
    expect(gate.run).toContain('policy.get("phase1Status") not in ("off", "complete")');
    expect(receiver.jobs.deploy.needs).toContain('preflight');
  });
  it.each([
    ['2026-11-06T09:30:00+00:00', 'off', 0],
    ['2026-11-06T09:49:59+00:00', 'complete', 0],
    ['2026-03-08T08:30:00+00:00', 'off', 0],
    ['2026-11-06T09:29:59+00:00', 'off', 1],
    ['2026-11-06T09:50:00+00:00', 'off', 1],
    ['2026-11-06T20:00:00+00:00', 'off', 1],
    ['2026-11-06T09:30:00+00:00', 'active', 1],
  ])('executes receiver admission for %s / %s', (stamp, status, expected) => {
    const code = gate.run.split("<<'PYTHON'\n")[1].split('\nPYTHON')[0];
    const prefix = `import datetime, subprocess, os\noriginal=datetime.datetime\nclass Clock(original):\n @classmethod\n def now(cls,tz=None):\n  return original.fromisoformat(${JSON.stringify(stamp)}).astimezone(tz)\ndatetime.datetime=Clock\nos.environ['TARGET_SHA']='a'*40\nsubprocess.check_output=lambda *a,**k: ${JSON.stringify(JSON.stringify({ phase1Status: status }))}\n`;
    const result = spawnSync('python3', ['-c', prefix + code], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(expected);
  });
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
    expect(transaction).toContain('maintenance_certificate() {\n  daily_cutover_clock || return 1');
    expect(transaction).toContain(
      'legacy_checkpoint_countdown() {\n  daily_cutover_clock || return 1'
    );
    expect(transaction).toContain(
      "PREPARED=1\ndaily_cutover_clock || die 'engine replacement is only allowed at 04:00 America/Chicago'"
    );
    expect(transaction).toContain(
      'request_recovery_window() {\n  # Historical owner windows cannot announce a daytime pause.\n  daily_cutover_clock || return 0'
    );
  });
  it.each([
    ['Engine Release ' + 'b'.repeat(40), 'b'.repeat(40), true],
    ['Engine Release ' + 'b'.repeat(40), 'c'.repeat(40), false],
    ['Engine Withdrawal 123-1', 'b'.repeat(40), false],
  ])('executes post-release clone selection for %s', (title, serving, accepted) => {
    const plan = backup.jobs.plan.steps.find((s: any) => s.id === 'plan').run;
    const result = spawnSync(
      'bash',
      ['-c', `curl() { printf '%s' '${JSON.stringify({ releaseSha: serving })}'; }\n` + plan],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          EVENT: 'workflow_run',
          INPUT_SHA: '',
          INPUT_REFRESH: 'false',
          GITHUB_SHA: 'a'.repeat(40),
          RELEASE_TITLE: title,
          GITHUB_OUTPUT: '/dev/stdout',
        },
      }
    );
    expect(result.status === 0, result.stderr).toBe(accepted);
    if (accepted) {
      expect(result.stdout).toContain('sha=' + serving);
      expect(result.stdout).toContain('refresh=force');
    } else expect(result.stdout).not.toContain('refresh=force');
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
    expect(backup.jobs.certify.if).toContain("needs.refresh.result == 'success'");
    expect(backup.jobs.certify.steps.find((s: any) => s.id === 'certify').run).toContain(
      'standby-engine certify $SHA 1800'
    );
  });
});
