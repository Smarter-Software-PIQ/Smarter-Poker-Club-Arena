/**
 * The pre-push scratch stays on the external drive, and a live run's scratch
 * is never swept (2026-11-07). A push's TMPDIR vanished mid-run when the
 * SmarterWork drive came back as "/Volumes/SmarterWork 1" behind a stale
 * boot-disk folder. These cases run the hook's own helpers, sliced from
 * .husky/pre-push, against a fake `df` and a sandbox volumes directory.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const HOOK = readFileSync(resolve(__dirname, '../../.husky/pre-push'), 'utf8');
const START = HOOK.indexOf('\n  ca_mount_of() {');
const END = HOOK.indexOf('\n  case "${TMPDIR:-}" in', START);
const HELPERS = HOOK.slice(START, END);
const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A sandbox whose fake `df` reports the longest listed mount prefix of a path. */
function sandbox(mounts: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'ca-scratch-'));
  sandboxes.push(dir);
  const vols = join(dir, 'Volumes');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  mkdirSync(vols);
  const table = mounts.map((m) => m.replace('$V', vols)).join('\n');
  writeFileSync(join(dir, 'mounts'), table + '\n');
  writeFileSync(
    join(dir, 'bin/df'),
    `#!/bin/bash
for p in "$@"; do case "$p" in -*) ;; *) path=$p ;; esac; done
best=/
while IFS= read -r m; do
  [ -n "$m" ] || continue
  case "$path/" in "$m"/*) [ \${#m} -gt \${#best} ] && best=$m ;; esac
done < '${join(dir, 'mounts')}'
echo 'Filesystem 512-blocks Used Available Capacity Mounted on'
echo "/dev/fake 1 1 1 1% $best"
`
  );
  chmodSync(join(dir, 'bin/df'), 0o755);
  return { dir, vols };
}

function run(box: { dir: string; vols: string }, script: string) {
  return spawnSync('bash', ['-c', `${HELPERS}\n${script}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(box.dir, 'bin')}:${process.env.PATH}`,
      CA_VOLUMES: box.vols,
    },
  });
}

describe('the push scratch must be on an external drive', () => {
  it('slices the helpers from the hook', () => {
    expect(START).toBeGreaterThan(0);
    expect(END).toBeGreaterThan(START);
    expect(HELPERS).toContain('ca_scratch_problem()');
    expect(HELPERS).toContain('ca_sweep_runs()');
  });

  it('accepts a scratch on a mounted external volume, even one whose name has a space', () => {
    const box = sandbox(['$V/Work', '$V/Work 1']);
    mkdirSync(join(box.vols, 'Work/agent-work'), { recursive: true });
    mkdirSync(join(box.vols, 'Work 1/agent-work'), { recursive: true });
    expect(run(box, `ca_scratch_problem "${box.vols}/Work/agent-work/.t"`).status).toBe(0);
    const spaced = run(box, `ca_mount_of "${box.vols}/Work 1/agent-work"`);
    expect(spaced.stdout.trim()).toBe(`${box.vols}/Work 1`);
    expect(run(box, `ca_scratch_problem "${box.vols}/Work 1/agent-work/.t"`).status).toBe(0);
  });

  it('refuses a stale boot-disk folder and names where the drive went', () => {
    // /Volumes/Work is a plain folder on the boot disk; the drive is at "Work 1".
    const box = sandbox(['$V/Work 1']);
    mkdirSync(join(box.vols, 'Work/agent-work'), { recursive: true });
    mkdirSync(join(box.vols, 'Work 1'), { recursive: true });
    const r = run(box, `ca_scratch_problem "${box.vols}/Work/agent-work/.t"`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('is on the boot disk (its filesystem is mounted at /)');
    expect(r.stdout).toContain(`The drive is mounted at "${box.vols}/Work 1" instead`);
    expect(r.stdout).toContain(`remount the drive at ${box.vols}/Work before pushing`);
  });

  it('refuses a boot-disk scratch with no renamed drive, without inventing one', () => {
    const box = sandbox([]);
    const elsewhere = join(box.dir, 'somewhere');
    const r = run(box, `ca_scratch_problem "${elsewhere}"`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`${elsewhere} is on the boot disk`);
    expect(r.stdout).not.toContain('The drive is mounted at');
  });

  it("sweeps only day-old runs whose push is gone, never a live run's or this run's", () => {
    const box = sandbox(['$V/Work']);
    const root = join(box.vols, 'Work/.t');
    const old = Date.now() / 1000 - 3 * 86_400;
    const mk = (name: string, owner?: string) => {
      const d = join(root, name);
      mkdirSync(d, { recursive: true });
      if (owner) writeFileSync(join(d, '.ca-push-owner'), owner + '\n');
      utimesSync(d, old, old);
      return d;
    };
    const live = mk('p.live', String(process.pid));
    const dead = mk('p.dead', '2147483646');
    const unowned = mk('p.unowned');
    const self = mk('p.self');
    const fresh = join(root, 'p.fresh');
    mkdirSync(fresh);
    const r = run(box, `ca_sweep_runs "${root}" "${self}"`);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(self)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(unowned)).toBe(false);
  });
});

describe('the default scratch falls back to a short external root', () => {
  const darwinStart = HOOK.indexOf('\n  case "${TMPDIR:-}" in');
  const pick = HOOK.slice(darwinStart, HOOK.indexOf('\n  esac', darwinStart) + 7);

  function pickRoot(box: { dir: string; vols: string }, env: Record<string, string>) {
    return spawnSync('bash', ['-c', `${HELPERS}\n${pick}\necho "TMPDIR=$TMPDIR"`], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(box.dir, 'bin')}:${process.env.PATH}`,
        CA_VOLUMES: box.vols,
        TMPDIR: join(box.dir, 'boot-T'),
        CA_PUSH_TMP_ROOT: '',
        ...env,
      },
    });
  }

  it('uses the second root when the first sits on a stale boot-disk folder', () => {
    const box = sandbox(['$V/Work/agent-work/extreme', '$V/Work 1']);
    mkdirSync(join(box.vols, 'Work/agent-work/extreme'), { recursive: true });
    mkdirSync(join(box.vols, 'Work 1'), { recursive: true });
    const first = join(box.vols, 'Work/agent-work/.t');
    const second = join(box.vols, 'Work/agent-work/extreme/.t');
    const r = pickRoot(box, { CA_PUSH_TMP_ROOTS: `${first} ${second}` });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`TMPDIR=${second}/p.`);
    expect(existsSync(first)).toBe(false);
  });

  it('refuses with every reason when no root is external', () => {
    const box = sandbox(['$V/Work 1']);
    mkdirSync(join(box.vols, 'Work/agent-work'), { recursive: true });
    mkdirSync(join(box.vols, 'Work 1'), { recursive: true });
    const first = join(box.vols, 'Work/agent-work/.t');
    const second = join(box.vols, 'Work/agent-work/extreme/.t');
    const r = pickRoot(box, { CA_PUSH_TMP_ROOTS: `${first} ${second}` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('external scratch unavailable for this run');
    expect(r.stderr).toContain(`${first} is on the boot disk`);
    expect(r.stderr).toContain(`${second} is on the boot disk`);
  });

  it('treats an explicit CA_PUSH_TMP_ROOT as the only candidate', () => {
    const box = sandbox(['$V/Work/agent-work/extreme']);
    mkdirSync(join(box.vols, 'Work/agent-work/extreme'), { recursive: true });
    const r = pickRoot(box, {
      CA_PUSH_TMP_ROOT: join(box.vols, 'Work/agent-work/.t'),
      CA_PUSH_TMP_ROOTS: join(box.vols, 'Work/agent-work/extreme/.t'),
    });
    expect(r.status).toBe(1);
  });
});

describe('the hook wires the checks in', () => {
  it('refuses up front, marks its run, and names a vanished scratch at exit', () => {
    expect(HOOK).toContain('BLOCKED: external scratch unavailable for this run. $ca_why');
    expect(HOOK).toContain('BLOCKED: external scratch unavailable for TMPDIR. $ca_why');
    expect(HOOK).toContain('echo "$$" >"$CA_PUSH_TMP/.ca-push-owner"');
    expect(HOOK).toContain('ca_sweep_runs "$CA_PUSH_TMP_ROOT" "$CA_PUSH_TMP"');
    expect(HOOK).toContain('vanished during the run (the drive dropped or was remounted)');
    // The Bash shim reads the whole mountpoint, so a space cannot split it.
    expect(HOOK).toContain('CA_TMP_MOUNT=$(ca_mount_of "${TMPDIR:-/nonexistent}")');
    expect(HOOK).not.toContain("awk 'END {print $NF}'");
  });
});
