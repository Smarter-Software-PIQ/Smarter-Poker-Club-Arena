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
