/**
 * LAW: THE MAC RUNS THE PUSH CHECKS THE WAY CI DOES (2026-11-05).
 *
 * Every server push from the Mac Studio was refused by tests that pass in CI
 * and also failed on an untouched origin/main checkout: Homebrew's Node 26
 * instead of CI's Node 22, a boot-drive TMPDIR the Phase 14 fleet tests and
 * the PostgreSQL money fixtures refuse, and no built native evaluator in a
 * fresh worktree. The pre-push hook now repairs all three on macOS only.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hook = readFileSync('.husky/pre-push', 'utf8');
const begin = hook.indexOf('if [ "$(uname -s)" = Darwin ]; then');
const end = hook.indexOf('\nfi\n', begin) + 4;
const darwinBlock = hook.slice(begin, end);

function fakeNode(dir: string, version: string) {
  mkdirSync(dir, { recursive: true });
  const major = version.replace(/^v/, '').split('.')[0];
  writeFileSync(
    join(dir, 'node'),
    `#!/bin/sh\nif [ "$1" = -v ]; then echo ${version}; else echo ${major}; fi\n`
  );
  chmodSync(join(dir, 'node'), 0o755);
}

function runBlock(env: Record<string, string>, root: string) {
  const script = `uname() { echo Darwin; }\n${darwinBlock}\necho "PATH=$PATH"\necho "TMPDIR=$TMPDIR"\n`;
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...env, PATH: `${join(root, 'shell-node')}:/usr/bin:/bin` },
  });
}

describe('the Mac runs the push checks the way CI does', () => {
  it('is one macOS-only block placed before any check runs', () => {
    expect(begin).toBeGreaterThan(0);
    expect(begin).toBeLessThan(hook.indexOf('CA_TREE_TOP="$(git rev-parse --show-toplevel)"'));
  });

  it('switches a non-22 shell to Node 22 and gives the run its own SSD TMPDIR', () => {
    const root = mkdtempSync(join(tmpdir(), 'mac-push-'));
    try {
      fakeNode(join(root, 'shell-node'), 'v26.3.0');
      fakeNode(join(root, 'home/.nvm/versions/node/v22.9.0/bin'), 'v22.9.0');
      fakeNode(join(root, 'home/.nvm/versions/node/v22.23.3/bin'), 'v22.23.3');
      const tmpRoot = join(root, 'ssd-tmp');
      const out = runBlock(
        { HOME: join(root, 'home'), TMPDIR: 'boot-drive/T', CA_PUSH_TMP_ROOT: tmpRoot },
        root
      );
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout).toContain('running the checks on Node v22.23.3');
      expect(out.stdout).toMatch(
        new RegExp(
          `PATH=${join(root, 'home/.nvm/versions/node/v22.23.3/bin').replace(/[.]/g, '\\.')}:`
        )
      );
      const tmp = /TMPDIR=(.*)/.exec(out.stdout)?.[1] ?? '';
      expect(tmp.startsWith(`${tmpRoot}/p.`)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves Node 22 and a TMPDIR already on /Volumes alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'mac-push-'));
    try {
      fakeNode(join(root, 'shell-node'), 'v22.23.3');
      const out = runBlock(
        { HOME: join(root, 'home'), TMPDIR: '/Volumes/SmarterWork/agent-work/mine' },
        root
      );
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout).not.toContain('running the checks on Node');
      expect(out.stdout).toContain('TMPDIR=/Volumes/SmarterWork/agent-work/mine');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds the native evaluator before the server tests when a worktree has none', () => {
    const build = hook.indexOf('node scripts/build-public-hist215-native.mjs');
    expect(build).toBeGreaterThan(0);
    expect(hook.slice(build - 400, build)).toContain(
      '[ ! -f server/native/build/public_hist215_wtl.node ]'
    );
    expect(build).toBeLessThan(hook.indexOf('running the server test files you changed'));
  });
});
