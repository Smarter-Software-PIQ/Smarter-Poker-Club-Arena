/**
 * LAW: A HOOK'S CHILD NEVER FLIPS THE SHARED CLONE TO BARE (2026-11-07).
 *
 * Twice on 2026-11-07 ~/Documents/club-arena had core.bare=true and every
 * worktree of it failed. Cause, reproduced below: git exports GIT_DIR to its
 * hooks (<clone>/.git/worktrees/<name> in a linked worktree); .husky/pre-push
 * runs Node contracts whose fixtures ran `git -C <tmp> init` under
 * `{...process.env}`, so the init re-initialised the worktree's git dir,
 * guessed "bare" from its name, and wrote core.bare=true into the shared
 * config. The hooks now drop GIT_DIR before running anything, the fixtures
 * strip GIT_* themselves, and agent-workspace.sh / agent-push.sh refuse a
 * clone that says bare with the one-line repair.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const CLEAN = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))
) as Record<string, string>;
const ID = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
};
const boxes: string[] = [];

/** The hook's `unset GIT_DIR ...` command, continuation lines included. */
function scrubOf(hook: string) {
  const start = hook.indexOf('\nunset GIT_DIR ') + 1;
  const lines: string[] = [];
  for (const line of hook.slice(start).split('\n')) {
    lines.push(line);
    if (!line.endsWith('\\')) break;
  }
  return { start, text: lines.join('\n') };
}
afterEach(() => {
  for (const d of boxes.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...CLEAN, ...ID, ...env } });
}

/** A clone with one linked worktree, and the GIT_DIR git gives that worktree's hooks. */
function cloneWithWorktree() {
  const box = mkdtempSync(join(tmpdir(), 'bare-flip-'));
  boxes.push(box);
  const clone = join(box, 'clone');
  mkdirSync(clone);
  expect(git(clone, ['init', '-q', '-b', 'main']).status).toBe(0);
  expect(git(clone, ['commit', '-q', '--allow-empty', '-m', 'a']).status).toBe(0);
  expect(git(clone, ['worktree', 'add', '-q', '-b', 'b', join(box, 'wt')]).status).toBe(0);
  const hookGitDir = git(join(box, 'wt'), ['rev-parse', '--absolute-git-dir']).stdout.trim();
  const scratch = join(box, 'scratch');
  mkdirSync(scratch);
  const bare = () => git(clone, ['config', '--get', 'core.bare']).stdout.trim();
  return { box, clone, wt: join(box, 'wt'), hookGitDir, scratch, bare };
}

describe('the cause, reproduced', () => {
  it('a fixture `git init` under a worktree hook GIT_DIR writes core.bare=true into the shared clone', () => {
    const r = cloneWithWorktree();
    expect(r.hookGitDir).toContain('/.git/worktrees/');
    expect(r.bare()).toBe('false');
    git(r.scratch, ['-C', r.scratch, 'init', '-q'], { GIT_DIR: r.hookGitDir });
    expect(r.bare()).toBe('true');
    // ...and the clone's own working tree is now refused.
    expect(git(r.clone, ['status', '--short']).status).not.toBe(0);
  });

  it("the hook's own scrub line keeps the same init in the scratch directory", () => {
    const r = cloneWithWorktree();
    const hook = read('.husky/pre-push');
    const scrub = scrubOf(hook).text;
    expect(scrub).toContain('GIT_DIR');
    const s = spawnSync('bash', ['-c', `${scrub}\ngit -C "${r.scratch}" init -q`], {
      cwd: r.wt,
      encoding: 'utf8',
      env: { ...CLEAN, ...ID, GIT_DIR: r.hookGitDir },
    });
    expect(s.status, s.stderr).toBe(0);
    expect(r.bare()).toBe('false');
    expect(git(r.scratch, ['rev-parse', '--is-inside-work-tree']).stdout.trim()).toBe('true');
  });
});

describe('the hooks drop the inherited git directory before running anything', () => {
  it('pre-push unsets GIT_DIR and friends before its first command', () => {
    const hook = read('.husky/pre-push');
    const { start, text } = scrubOf(hook);
    expect(start).toBeGreaterThan(0);
    for (const v of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'])
      expect(text).toContain(v);
    const firstCommand = hook.search(/\n(bash|node|git|npm|npx) /);
    expect(firstCommand).toBeGreaterThan(start);
    // The bare-clone guard is the command right after the scrub.
    const nextLine = hook.slice(start + text.length + 1).split('\n')[0];
    expect(nextLine).toBe('bash "$(git rev-parse --show-toplevel)/scripts/guard-bare-flip.sh"');
  });

  it('pre-commit unsets GIT_DIR but keeps the index git hands the commit', () => {
    const hook = read('.husky/pre-commit');
    const line = hook.split('\n').find((l) => l.startsWith('unset GIT_DIR'))!;
    expect(line).toBeDefined();
    expect(line).not.toContain('GIT_INDEX_FILE');
    expect(hook.indexOf(line)).toBeLessThan(hook.search(/\n(bash|node|git) /));
  });

  it('the v31 fixtures that run git init strip GIT_* themselves', () => {
    for (const f of [
      'scripts/ci/gto-v31-qualification.test.mjs',
      'scripts/ci/v31-decision-closure.test.mjs',
      'scripts/ci/v31-execution-fingerprint.test.mjs',
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\{ \.\.\.process\.env, GIT_AUTHOR_NAME/);
      expect(src, f).toContain("filter(([k]) => !k.startsWith('GIT_'))");
    }
  });
});

describe('a clone that says bare is refused with the repair', () => {
  function flipped() {
    const r = cloneWithWorktree();
    expect(git(r.clone, ['config', 'core.bare', 'true']).status).toBe(0);
    return r;
  }

  it('guard-bare-flip.sh refuses from a worktree and from the clone, and passes once repaired', () => {
    const r = flipped();
    const guard = resolve(ROOT, 'scripts/guard-bare-flip.sh');
    for (const cwd of [r.wt, r.clone]) {
      const s = spawnSync('bash', [guard], { cwd, encoding: 'utf8', env: { ...CLEAN } });
      expect(s.status, cwd).toBe(1);
      expect(s.stderr).toContain('core.bare=true');
      expect(s.stderr).toContain('core.bare false');
    }
    git(r.clone, ['config', 'core.bare', 'false']);
    expect(spawnSync('bash', [guard], { cwd: r.wt, env: { ...CLEAN } }).status).toBe(0);
  });

  it('leaves a genuinely bare repository alone', () => {
    const box = mkdtempSync(join(tmpdir(), 'bare-real-'));
    boxes.push(box);
    git(box, ['init', '-q', '--bare', 'r.git']);
    const s = spawnSync('bash', [resolve(ROOT, 'scripts/guard-bare-flip.sh')], {
      cwd: join(box, 'r.git'),
      env: { ...CLEAN },
    });
    expect(s.status).toBe(0);
  });

  it('agent-workspace.sh refuses before making a worktree', () => {
    const r = flipped();
    const s = spawnSync(
      'bash',
      [resolve(ROOT, 'scripts/agent-workspace.sh'), 'probe', 'x', '--print-path'],
      {
        cwd: r.clone,
        encoding: 'utf8',
        env: { ...CLEAN, AGENT_WORKTREE_ROOT: join(r.box, 'trees') },
      }
    );
    expect(s.status).toBe(1);
    expect(s.stderr).toContain('core.bare=true');
    expect(git(r.clone, ['worktree', 'list']).stdout).not.toContain('trees');
  });

  it('agent-push.sh runs the guard before anything else', () => {
    const src = read('scripts/agent-push.sh');
    const guard = src.indexOf('bash "$SCRIPT_DIR/guard-bare-flip.sh"');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(src.indexOf('guard-shared-clone.sh" push'));
  });
});
