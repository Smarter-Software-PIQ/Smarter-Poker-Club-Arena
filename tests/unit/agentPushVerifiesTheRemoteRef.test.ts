import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitFixtureEnvironment } from '../helpers/gitFixtureEnvironment';

// scripts/agent-push.sh: push through the remote NAME, then prove the remote
// ref equals HEAD. See docs/changelog/2026-11-05-agent-push-verifies-the-remote-ref.md.
const helper = resolve('scripts/agent-push.sh');
const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

let fixture: string;
let bare: string;
let clone: string;
let tree: string;
let shimDir: string;
let hookLog: string;
const env = () => gitFixtureEnvironment();

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=Push Fixture',
      '-c',
      'user.email=push@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, env: env(), encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

const push = (cwd: string, extra: NodeJS.ProcessEnv = {}) =>
  spawnSync('bash', [helper], { cwd, env: { ...env(), ...extra }, encoding: 'utf8' });

const remoteRef = (branch: string) =>
  spawnSync(
    'git',
    ['--git-dir', bare, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
    {
      env: env(),
      encoding: 'utf8',
    }
  ).stdout.trim();

// A `git` that fakes only the push step, standing in for a push that dies on
// a closed connection (141) or "succeeds" without delivering a ref (0).
const shimmedPath = (pushExit: number) => {
  writeFileSync(
    join(shimDir, 'git'),
    `#!/usr/bin/env bash\nfor a in "$@"; do [ "$a" = push ] && exit ${pushExit}; done\nexec "${realGit}" "$@"\n`
  );
  chmodSync(join(shimDir, 'git'), 0o755);
  return { PATH: `${shimDir}:${process.env.PATH}` };
};

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'agent-push-'));
  bare = join(fixture, 'origin.git');
  clone = join(fixture, 'clone');
  tree = join(fixture, 'agent-work', 'tree');
  shimDir = join(fixture, 'shim');
  hookLog = join(fixture, 'hook.log');
  mkdirSync(shimDir);
  spawnSync('git', ['init', '--bare', '--initial-branch=main', bare], { env: env() });
  git(fixture, 'clone', bare, clone);
  git(clone, 'commit', '--allow-empty', '-m', 'base');
  git(clone, 'push', 'origin', 'HEAD:refs/heads/main');
  const hooks = join(fixture, 'hooks');
  mkdirSync(hooks);
  // Stub pre-push: records the remote argument git hands it and passes.
  writeFileSync(
    join(hooks, 'pre-push'),
    `#!/usr/bin/env bash\necho "$1" >> "${hookLog}"\nexit 0\n`
  );
  chmodSync(join(hooks, 'pre-push'), 0o755);
  git(clone, 'config', 'core.hooksPath', hooks);
  git(clone, 'worktree', 'add', '-b', 'agent/feature', tree);
  git(tree, 'commit', '--allow-empty', '-m', 'feature work');
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe('scripts/agent-push.sh', () => {
  it('pushes through the remote name, runs the hook and verifies the remote ref equals HEAD', () => {
    // main moved on after the worktree was cut: the helper must fetch it first.
    git(clone, 'commit', '--allow-empty', '-m', 'main moved');
    git(clone, 'push', 'origin', 'HEAD:refs/heads/main');
    writeFileSync(hookLog, '');
    const result = push(tree);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('VERIFIED');
    expect(remoteRef('agent/feature')).toBe(git(tree, 'rev-parse', 'HEAD'));
    expect(readFileSync(hookLog, 'utf8').trim()).toBe('origin');
    expect(git(tree, 'rev-parse', 'refs/remotes/origin/main')).toBe(remoteRef('main'));
  });

  it('propagates the real exit code of a push that dies (SIGPIPE, 141)', () => {
    const result = push(tree, shimmedPath(141));
    expect(result.status).toBe(141);
    expect(result.stderr).toContain('SIGPIPE');
    expect(remoteRef('agent/feature')).toBe('');
  });

  it('fails when git push reports success but the remote ref is not HEAD', () => {
    const result = push(tree, shimmedPath(0));
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('NOT PUSHED');
    expect(remoteRef('agent/feature')).toBe('');
  });

  it('detects a remote ref that exists but points at an older commit', () => {
    expect(push(tree).status).toBe(0);
    git(tree, 'commit', '--allow-empty', '-m', 'second commit');
    const result = push(tree, shimmedPath(0));
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('NOT PUSHED');
  });

  it('refuses from the shared clone and from main without pushing', () => {
    git(clone, 'checkout', '-b', 'agent/in-shared-clone');
    const shared = push(clone);
    expect(shared.status).toBe(2);
    expect(remoteRef('agent/in-shared-clone')).toBe('');

    git(tree, 'checkout', '--detach');
    git(tree, 'branch', '-f', 'main', 'HEAD');
    const other = join(fixture, 'agent-work', 'on-main');
    git(clone, 'checkout', '--detach');
    git(clone, 'worktree', 'add', other, 'main');
    const onMain = push(other);
    expect(onMain.status).toBe(2);
    expect(onMain.stderr).toContain('protected');
  });
});
