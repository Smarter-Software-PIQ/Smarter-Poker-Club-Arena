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
 *
 * 2026-11-23: the hook also refuses `stash clear`, which deletes every agent's
 * entries at once. It cannot refuse pop, apply or the drop of one entry among
 * several (git runs no hook before they act); AGENTS.md carries that rule.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HOOK = resolve(__dirname, '../../.husky/reference-transaction');

const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX'])
  delete env[key];
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

  it('refuses a stash clear and keeps every entry, whoever made it', () => {
    writeFileSync(join(clone, 'f.txt'), 'another agent, entry one\n');
    git(clone, 'stash', 'push', '-q', '-m', 'theirs one');
    writeFileSync(join(clone, 'f.txt'), 'another agent, entry two\n');
    git(clone, 'stash', 'push', '-q', '-m', 'theirs two');
    installHook();
    const r = run(worktree, 'stash', 'clear');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("refuses 'stash clear'");
    expect(r.stderr).toContain('commit it on');
    const list = git(clone, 'stash', 'list');
    expect(list).toContain('theirs one');
    expect(list).toContain('theirs two');
  });

  it('refuses a stash clear of a single entry too', () => {
    writeFileSync(join(clone, 'f.txt'), 'another agent\n');
    git(clone, 'stash', 'push', '-q', '-m', 'theirs only');
    installHook();
    expect(run(worktree, 'stash', 'clear').status).not.toBe(0);
    expect(git(clone, 'stash', 'list')).toContain('theirs only');
  });

  it('an old list can still be drained one entry at a time, down to empty', () => {
    writeFileSync(join(worktree, 'f.txt'), 'older edit one\n');
    git(worktree, 'stash', 'push', '-q');
    writeFileSync(join(worktree, 'f.txt'), 'older edit two\n');
    git(worktree, 'stash', 'push', '-q');
    installHook();
    git(worktree, 'stash', 'drop', '-q');
    git(worktree, 'stash', 'drop', '-q');
    expect(git(clone, 'stash', 'list')).toBe('');
  });

  it('the agent rules name every stash verb and the own-temp-folder rule', () => {
    const rules = readFileSync(resolve(__dirname, '../../AGENTS.md'), 'utf8');
    for (const verb of ['`push`', '`pop`', '`apply`', '`drop`', '`clear`']) {
      expect(rules, `AGENTS.md no longer names stash ${verb}`).toContain(verb);
    }
    expect(rules).toContain('export `TMPDIR` to a folder that belongs to your worktree alone');
    expect(rules).toContain('Never empty, clean or delete a shared or parent folder');
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
