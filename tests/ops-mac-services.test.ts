/**
 * The operations Mac services stay safe by construction (2026-11-03): one
 * queue runner, never acting on an unknown database answer, installs and
 * readbacks outside the DDL break, failures alerted, no credentials stored.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { execFileSync } from 'child_process';

const dir = 'operations/ops-mac';
const read = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');

describe('operations Mac services', () => {
  const queue = read('install-queue.sh');
  const driver = read('install-driver.sh');
  const beat = read('heartbeat.sh');
  it('runs exactly one queue runner', () => {
    expect(queue).toContain('another runner (pid $(cat $LOCK)) holds the queue; exiting');
  });
  it('never acts on an unknown answer about what is installed', () => {
    expect(queue).toContain('echo err');
    expect(queue).toContain('database unreachable checking $F; retrying next pass');
  });
  it('installs and reads back outside the :44 to :05 UTC break', () => {
    expect(driver).toMatch(/-ge 44 \] \|\| \[ "\$M" -lt 5 \]/);
    expect(queue).toMatch(/wait_window {2}# the readback re-executes definitions/);
  });
  it('reads back a migration that creates new routines with plain CREATE and patches others in DO blocks', () => {
    // 20261107224538 (2026-11-08): five plain CREATE FUNCTION helpers plus DO-block
    // patches. Replayed verbatim, the first CREATE hit "already exists", aborted the
    // rolled-back transaction and the queue marked a correct install failed.
    const out = execFileSync(
      'python3',
      [`${dir}/readback.py`, 'tests/fixtures/ops-mac-readback/plain-create-and-patch.sql'],
      { encoding: 'utf8' }
    );
    expect(out).toContain('CREATE OR REPLACE FUNCTION public.fn_new_helper(p_version text)');
    expect(out).toContain('CREATE OR REPLACE FUNCTION public.fn_existing(p int)');
    expect(out).not.toMatch(/^CREATE FUNCTION/m);
    // A CREATE quoted inside a DO block is not a top-level statement to replay.
    expect(out).not.toContain('fn_patched');
    expect(out).toContain("ARRAY['public.fn_existing','public.fn_new_helper']");
    expect(out.trim().split('\n').at(-1)).toMatch(/^SELECT 'liveproof', \(/);
  });
  it('sees its own workflow run while it waits behind another run for the same file', () => {
    // 20261118233000 (2026-11-19, Production Alerts 444704): the merge dispatcher's
    // run held the per-file concurrency group, the queue's own send waited behind it
    // with no job yet, and matching on the job name reported "no run appeared"
    // (rc=3) for a migration that installed ten minutes later. The run-name exists
    // from creation, so the pending run is seen; a longer file name sharing the
    // prefix is not mistaken for it.
    const file = '20261118233000_the_capped_satellite_executor_carries_its_own_deadline.sql';
    const listing = fs.readFileSync('tests/fixtures/ops-mac-apply-runs/queued-behind-dispatcher.json', 'utf8');
    const run = (mode: string, input = listing) =>
      execFileSync('python3', [`${dir}/apply-runs.py`, file, mode], { encoding: 'utf8', input }).trim();
    expect(run('latest')).toBe('900003');
    expect(run('inflight')).toBe('2');
    expect(run('inflight', '[]')).toBe('0');
    expect(run('latest', '[]')).toBe('');
    // An unreadable listing is never read as "nothing in flight".
    expect(() => run('inflight', 'rate limited')).toThrow();
    expect(driver).toContain('python3 $O/apply-runs.py "$F" latest');
    expect(driver).not.toContain(".jobs[0].name");
    expect(driver).toMatch(/wait_window\n {2}wait_inflight\n {2}BEFORE=\$\(latest_run\)/);
    expect(read('setup.sh')).toContain('apply-runs.py');
  });
  it('fails a job only when its version is still not recorded', () => {
    expect(queue).toContain('recorded by another route after driver rc=$rc; verifying only');
    expect(queue).toMatch(/if \[ \$rc -ne 0 \]; then case "\$\(rec_state "\$V"\)" in/);
  });
  it('alerts on a failed job and on a stopped queue', () => {
    expect(queue).toContain('InstallQueueJobFailed');
    expect(beat).toContain('InstallQueueServiceDown');
    expect(beat).toContain('launchctl bootstrap');
  });
  it('stores no credential', () => {
    for (const f of fs.readdirSync(dir).filter((x) => !fs.statSync(`${dir}/${x}`).isDirectory())) {
      expect(read(f)).not.toMatch(/PASSWORD['"]?\s*[:=]\s*['"][^'"\s]{8,}/);
      expect(read(f)).not.toMatch(/postgres(?:ql)?:\/\/[^\s'"]+:[^\s'"@]+@/);
    }
  });
  it('keeps the launchd services outside any app and always on', () => {
    const plist = read('launchd/com.smarter-poker.install-queue.plist.template');
    expect(plist).toContain('<key>KeepAlive</key><true/>');
    expect(plist).toContain('__HOME__/.smarter-poker/ops/install-queue.sh');
  });
});
