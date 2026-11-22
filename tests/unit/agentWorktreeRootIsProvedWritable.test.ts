/**
 * A WORKTREE ROOT IS PROVED WRITABLE, OR THE SCRIPT REFUSES NAMING THE
 * VARIABLE (2026-11-21).
 *
 * /Volumes/SmarterWork/agent-work became root-owned and read-only. The old
 * selection fell through to the boot disk and the checkout then died with a
 * bare "Permission denied", so every agent had to find AGENT_WORKTREE_ROOT by
 * hand. These run the real selection function, cut out of
 * scripts/agent-workspace.sh, against temporary directories.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = readFileSync(resolve(process.cwd(), 'scripts/agent-workspace.sh'), 'utf8');
const begin = script.indexOf('# >>> choose_agent_worktree_root');
const end = script.indexOf('# <<< choose_agent_worktree_root');
const fn = script.slice(begin, end);

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'agent-root-'));
});
afterEach(() => {
  try {
    execFileSync('chmod', ['-R', 'u+w', work]);
  } catch {
    /* best effort */
  }
  rmSync(work, { recursive: true, force: true });
});

function choose(ssd: string, boot: string, root?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.AGENT_WORKTREE_ROOT;
  if (root !== undefined) env.AGENT_WORKTREE_ROOT = root;
  const r = spawnSync(
    'bash',
    ['-c', `set -euo pipefail\n${fn}\nchoose_agent_worktree_root ca "$1" "$2"`, 'x', ssd, boot],
    { env, encoding: 'utf8' }
  );
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
}

/** A directory nothing can write into, even as root: its path runs through a file. */
function unwritable(name: string) {
  const blocker = join(work, `${name}-is-a-file`);
  writeFileSync(blocker, '');
  return join(blocker, 'sub');
}

describe('choose_agent_worktree_root', () => {
  it('is present in the script between its markers', () => {
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(fn).toContain('agent_root_writable()');
  });

  it('prefers extreme-capacity (SSD2) first even when agent-work and shared-capacity are also writable', () => {
    const ssd = join(work, 'agent-work');
    mkdirSync(join(ssd, 'extreme-capacity'), { recursive: true });
    mkdirSync(join(ssd, 'shared-capacity'), { recursive: true });
    expect(choose(ssd, join(work, 'boot'))).toMatchObject({
      status: 0,
      out: join(ssd, 'extreme-capacity', 'ca'),
    });
  });

  it('prefers extreme-capacity (SSD2) when agent-work itself is read-only and both volumes exist', () => {
    const ssd = join(work, 'agent-work');
    mkdirSync(join(ssd, 'extreme-capacity'), { recursive: true });
    mkdirSync(join(ssd, 'shared-capacity'), { recursive: true });
    writeFileSync(join(ssd, 'ca'), '');
    if (process.getuid?.() !== 0) chmodSync(ssd, 0o555);
    expect(choose(ssd, join(work, 'boot'))).toMatchObject({
      status: 0,
      out: join(ssd, 'extreme-capacity', 'ca'),
    });
  });

  it('uses the SSD agent-work root when it can be written and does not fabricate extreme-capacity', () => {
    const ssd = join(work, 'agent-work');
    mkdirSync(ssd);
    expect(choose(ssd, join(work, 'boot'))).toMatchObject({ status: 0, out: join(ssd, 'ca') });
    expect(existsSync(join(ssd, 'extreme-capacity'))).toBe(false);
  });

  it('falls through from unwritable extreme-capacity to agent-work or shared-capacity', () => {
    const ssd = join(work, 'agent-work');
    mkdirSync(join(ssd, 'extreme-capacity'), { recursive: true });
    writeFileSync(join(ssd, 'extreme-capacity', 'ca'), '');
    mkdirSync(join(ssd, 'shared-capacity'), { recursive: true });
    expect(choose(ssd, join(work, 'boot'))).toMatchObject({ status: 0, out: join(ssd, 'ca') });

    rmSync(join(ssd, 'ca'), { recursive: true, force: true });
    writeFileSync(join(ssd, 'ca'), '');
    if (process.getuid?.() !== 0) chmodSync(ssd, 0o555);
    expect(choose(ssd, join(work, 'boot'))).toMatchObject({
      status: 0,
      out: join(ssd, 'shared-capacity', 'ca'),
    });
  });

  it('moves to shared-capacity when agent-work itself refuses a write', () => {
    const ssd = join(work, 'agent-work');
    mkdirSync(join(ssd, 'shared-capacity'), { recursive: true });
    writeFileSync(join(ssd, 'ca'), ''); // agent-work/ca cannot become a directory
    if (process.getuid?.() !== 0) chmodSync(ssd, 0o555);
    const r = choose(ssd, join(work, 'boot'));
    expect(r).toMatchObject({ status: 0, out: join(ssd, 'shared-capacity', 'ca') });
  });

  it('refuses, naming AGENT_WORKTREE_ROOT, when no SSD candidate is writable, and never uses the boot disk', () => {
    const ssd = join(work, 'agent-work');
    mkdirSync(ssd);
    writeFileSync(join(ssd, 'extreme-capacity'), '');
    writeFileSync(join(ssd, 'ca'), '');
    writeFileSync(join(ssd, 'shared-capacity'), '');
    const boot = join(work, 'boot');
    const r = choose(ssd, boot);
    expect(r.status).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('REFUSED');
    expect(r.err).toContain('extreme-capacity');
    expect(r.err).toContain('AGENT_WORKTREE_ROOT');
    expect(() => readFileSync(boot)).toThrow();
  });

  it('uses the boot disk only when no SSD is attached', () => {
    const boot = join(work, 'boot');
    const r = choose(join(work, 'no-ssd'), boot);
    expect(r).toMatchObject({ status: 0, out: boot });
    expect(r.err).toContain('not mounted');
  });

  it('refuses when there is no SSD and the boot disk cannot be written', () => {
    const r = choose(join(work, 'no-ssd'), unwritable('boot'));
    expect(r.status).toBe(1);
    expect(r.err).toContain('AGENT_WORKTREE_ROOT');
  });

  it('honours a writable AGENT_WORKTREE_ROOT and refuses an unwritable one by name', () => {
    const ssd = join(work, 'agent-work');
    mkdirSync(ssd);
    const mine = join(work, 'mine');
    expect(choose(ssd, join(work, 'boot'), mine)).toMatchObject({ status: 0, out: mine });
    const bad = unwritable('root');
    const r = choose(ssd, join(work, 'boot'), bad);
    expect(r.status).toBe(1);
    expect(r.err).toContain(`AGENT_WORKTREE_ROOT=${bad} is not writable`);
  });

  it('leaves no probe file behind', () => {
    const ssd = join(work, 'agent-work');
    mkdirSync(ssd);
    choose(ssd, join(work, 'boot'));
    expect(execFileSync('ls', ['-A', join(ssd, 'ca')], { encoding: 'utf8' })).toBe('');
  });
});
