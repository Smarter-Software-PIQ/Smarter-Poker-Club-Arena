/**
 * CLAUDE.md 10.87 rule 5: no new stash entries, because every worktree of a
 * clone shares ONE stash list.
 *
 * On 2026-11-21 two agents stashed in two worktrees of the same clone at once
 * and each popped the other's changes into its own tree. `refs/stash` lives in
 * the common git directory, so this is not an accident of usage: it is what a
 * stash IS in a repository with worktrees.
 *
 * `.husky/reference-transaction` refuses a new `refs/stash` value in the
 * "prepared" state. A stash push stores the ref BEFORE it resets the working
 * tree, so the refusal leaves the tree exactly as it was. That ordering is the
 * whole safety argument, so this test drives a real repository with a linked
 * worktree and asserts the tree is untouched after the refusal.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HOOK = resolve(__dirname, '../../.husky/reference-transaction');

const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) delete env[key];
env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = 'Stash Fixture';
env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = 'stash-fixture@example.invalid';

const run = (cwd: string, ...args: string[]) =>
  spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' });
const git = (cwd: string, ...args: string[]) => {
  const r = run(cwd, ...args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

let fixture: string;
let clone: string;
let worktree: string;
let hooks: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'one-stash-list-'));
  clone = join(fixture, 'clone');
  worktree = join(fixture, 'agent-tree');
  hooks = join(fixture, 'hooks');
  mkdirSync(clone);
  mkdirSync(hooks);
  git(clone, 'init', '-q', '--initial-branch=main');
  writeFileSync(join(clone, 'f.txt'), 'base\n');
  git(clone, 'add', 'f.txt');
  git(clone, 'commit', '-q', '-m', 'base');
  git(clone, 'worktree', 'add', '-q', '-b', 'agent/x', worktree);
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

function installHook() {
  copyFileSync(HOOK, join(hooks, 'reference-transaction'));
  chmodSync(join(hooks, 'reference-transaction'), 0o755);
  git(clone, 'config', 'core.hooksPath', hooks);
}

describe('a new stash entry is refused, and the tree is left untouched', () => {
  it('worktrees really do share one stash list (the defect)', () => {
    writeFileSync(join(worktree, 'f.txt'), 'agent edit\n');
    git(worktree, 'stash', 'push', '-q', '-m', 'from the worktree');
    expect(git(clone, 'stash', 'list')).toContain('from the worktree');
  });

  it('refuses a stash push in a linked worktree and keeps the edit in place', () => {
    installHook();
    writeFileSync(join(worktree, 'f.txt'), 'agent edit\n');
    const r = run(worktree, 'stash', 'push', '-m', 'refused');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('refuses new stash entries');
    expect(readFileSync(join(worktree, 'f.txt'), 'utf8')).toBe('agent edit\n');
    expect(git(worktree, 'status', '--porcelain')).toBe('M f.txt');
    expect(git(clone, 'stash', 'list')).toBe('');
  });

  it('refuses a stash push in the shared clone too', () => {
    installHook();
    writeFileSync(join(clone, 'f.txt'), 'clone edit\n');
    const r = run(clone, 'stash', 'push');
    expect(r.status).not.toBe(0);
    expect(readFileSync(join(clone, 'f.txt'), 'utf8')).toBe('clone edit\n');
    expect(git(clone, 'stash', 'list')).toBe('');
  });

  it('still lets an existing entry be popped, so an old list can be drained', () => {
    writeFileSync(join(worktree, 'f.txt'), 'older edit\n');
    git(worktree, 'stash', 'push', '-q');
    installHook();
    git(worktree, 'stash', 'pop', '-q');
    expect(readFileSync(join(worktree, 'f.txt'), 'utf8')).toBe('older edit\n');
    expect(git(clone, 'stash', 'list')).toBe('');
  });

  it('leaves ordinary branch work alone: commit, fast-forward of main, worktree add', () => {
    installHook();
    writeFileSync(join(worktree, 'f.txt'), 'agent edit\n');
    git(worktree, 'commit', '-q', '-am', 'agent work');
    git(clone, 'merge', '-q', '--ff-only', 'agent/x');
    expect(readFileSync(join(clone, 'f.txt'), 'utf8')).toBe('agent edit\n');
    git(clone, 'worktree', 'add', '-q', '-b', 'agent/y', join(fixture, 'second-tree'));
  });
});
