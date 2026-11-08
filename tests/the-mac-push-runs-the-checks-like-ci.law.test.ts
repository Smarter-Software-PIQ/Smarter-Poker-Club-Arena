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
  const script = `uname() { echo Darwin; }\ndf() { if [ "$2" = / ] || [ "\${TEST_INTERNAL_SCRATCH:-}" = yes ]; then echo internal; else echo "external /Volumes/test-ssd"; fi; }\n${darwinBlock}\necho "PATH=$PATH"\necho "TMPDIR=$TMPDIR"\n`;
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
      const owned = join(root, 'mine');
      mkdirSync(owned);
      const out = runBlock(
        { HOME: join(root, 'home'), TMPDIR: owned, CA_PUSH_TMP_ROOT: join(root, 'ssd-tmp') },
        root
      );
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout).not.toContain('running the checks on Node');
      const retained = /TMPDIR=(.*)/.exec(out.stdout)?.[1] ?? '';
      if (owned.startsWith('/Volumes/')) expect(retained).toBe(owned);
      else expect(retained.startsWith(join(root, 'ssd-tmp'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('puts an installed bash 4+ on PATH for the checks, and nothing else (2026-11-06)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mac-push-'));
    try {
      fakeNode(join(root, 'shell-node'), 'v22.23.3');
      const fakeBash = join(root, 'brew/bin/bash');
      mkdirSync(join(root, 'brew/bin'), { recursive: true });
      writeFileSync(
        fakeBash,
        '#!/bin/sh\ncase "$2" in *BASH_VERSINFO*) echo 5;; *) echo bash 5.3.0;; esac\n'
      );
      chmodSync(fakeBash, 0o755);
      const out = runBlock(
        {
          HOME: join(root, 'home'),
          TMPDIR: 'boot-drive/T',
          CA_PUSH_TMP_ROOT: join(root, 'ssd-tmp'),
          CA_BASH_CANDIDATES: `${join(root, 'missing/bash')} ${fakeBash}`,
        },
        root
      );
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout).toContain('running the shell checks on bash 5.3.0');
      const path = /PATH=(.*)/.exec(out.stdout)?.[1] ?? '';
      const first = path.split(':')[0]!;
      expect(first).toMatch(/club-arena-pre-push-bash\./);
      const tmp = /TMPDIR=(.*)/.exec(out.stdout)?.[1] ?? '';
      expect(first.startsWith(tmp + '/')).toBe(true);
      expect(path).toContain(join(root, 'shell-node'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses internal scratch and cleans only the shim it created', () => {
    const root = mkdtempSync(join(tmpdir(), 'mac-push-'));
    try {
      fakeNode(join(root, 'shell-node'), 'v22.23.3');
      const fakeBash = join(root, 'bash');
      writeFileSync(fakeBash, '#!/bin/sh\necho 5\n', { mode: 0o755 });
      const out = runBlock(
        {
          HOME: join(root, 'home'),
          TMPDIR: root,
          CA_PUSH_TMP_ROOT: join(root, 'ssd-tmp'),
          CA_BASH_CANDIDATES: fakeBash,
          TEST_INTERNAL_SCRATCH: 'yes',
        },
        root
      );
      expect(out.status).toBe(1);
      expect(out.stderr).toContain('external scratch unavailable');
      expect(hook).not.toContain('mktemp -d /tmp/club-arena-pre-push-bash');
      const cleanup = hook.slice(
        hook.indexOf('policy_precheck_result()'),
        hook.indexOf('trap policy_precheck_result EXIT')
      );
      expect(cleanup).toContain('rm -f -- "$CA_BASH_DIR/bash"');
      expect(cleanup).toContain('rmdir -- "$CA_BASH_DIR"');
      expect(cleanup).not.toContain('rm -rf');
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

  it('drops the git environment the hook inherited before any check or test can inherit it (2026-11-07)', () => {
    // Git exports GIT_DIR to its hooks. A fixture repository under $TMPDIR, or
    // a benchmark reader spawning git from server/, inherits the pointer and
    // fails "this operation must be run in a work tree" - an environment
    // verdict wearing a change's name. Eleven server benchmark cases refused a
    // workflow-only Mac push this way on 2026-11-07.
    const unset = hook.match(/^unset GIT_DIR(?:[^\n\\]|\\\n)*/m);
    expect(unset, 'the hook unsets GIT_DIR').not.toBeNull();
    for (const v of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
      expect(unset![0]).toContain(v);
    }
    const firstCheck = hook.indexOf('guard-shared-clone.sh');
    expect(unset!.index!).toBeLessThan(firstCheck);
    // The hook's own git must still find this tree from its working directory.
    const r = spawnSync('bash', ['-c', `${unset![0]}\ngit rev-parse --show-toplevel`], {
      encoding: 'utf8',
      env: { ...process.env, GIT_DIR: '/nonexistent/.git' },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(process.cwd());
  });
});
