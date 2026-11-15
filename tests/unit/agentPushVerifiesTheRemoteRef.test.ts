import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { spawn, spawnSync } from 'node:child_process';
import { gitFixtureEnvironment } from '../helpers/gitFixtureEnvironment';

// Load headroom (2026-11-07): each case builds and pushes real Git fixtures.
// Under the full pre-push suite the first case took 48s against the 30s
// default, so the per-case timeout is raised. The rest of that time was the
// helper's own wait for the Mac's load to fall (15s steps, up to 900s): a
// fixture push has no gate worth protecting, so the helper runs with that
// wait off below. Every assertion is unchanged.
vi.setConfig({ testTimeout: 120_000 });

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
  spawnSync('bash', [helper], {
    cwd,
    env: { ...env(), AGENT_PUSH_LOAD_WAIT_SECONDS: '0', ...extra },
    encoding: 'utf8',
  });

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

  it('reuses an exact remote commit without running its hook again', () => {
    expect(push(tree).status).toBe(0);
    const before = readFileSync(hookLog, 'utf8');
    const repeated = push(tree);
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(repeated.stderr).toContain('ALREADY PRESENT');
    expect(readFileSync(hookLog, 'utf8')).toBe(before);
    expect(remoteRef('agent/feature')).toBe(git(tree, 'rev-parse', 'HEAD'));
  });

  it('refuses dirty tracked bytes instead of describing an old remote commit as the candidate', () => {
    writeFileSync(join(tree, 'tracked.txt'), 'original');
    git(tree, 'add', 'tracked.txt');
    git(tree, 'commit', '-m', 'tracked input');
    expect(push(tree).status).toBe(0);
    writeFileSync(join(tree, 'tracked.txt'), 'pending edit');
    const result = push(tree);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('commit tracked');
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

// It owns the tree it starts (2026-11-15). Stopping a detached run with
// `screen -X quit` used to leave the helper, git push, the hook and its vitest
// workers running for up to 40 minutes, and a green run would still push.
// See docs/changelog/2026-11-15-agent-push-stops-its-own-tree.md.
describe('scripts/agent-push.sh stops its own process tree', () => {
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const until = async (what: () => boolean, ms: number) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (what()) return true;
    return what();
  };
  // Running means present and not a zombie awaiting its reaper.
  const running = (pid: number) => {
    const stat = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    return stat.status === 0 && stat.stdout.trim() !== '' && !stat.stdout.trim().startsWith('Z');
  };
  const workerPid = () => Number(readFileSync(join(fixture, 'worker.pid'), 'utf8').trim());
  const pidFrom = (name: string) =>
    existsSync(join(fixture, name)) ? Number(readFileSync(join(fixture, name), 'utf8').trim()) : 0;
  const recorded = () =>
    ['worker.pid', 'shim.pid', 'step.pid', 'helper.pid'].map(pidFrom).filter((p) => p > 1);
  // Any live (non-zombie) member of process group `pgid`.
  const groupAlive = (pgid: number) =>
    spawnSync('ps', ['-A', '-o', 'pgid=', '-o', 'stat='], { encoding: 'utf8' })
      .stdout.split('\n')
      .map((line) => line.trim().split(/\s+/))
      .some(([g, stat]) => Number(g) === pgid && stat !== undefined && !stat.startsWith('Z'));
  // A failed case must not leave a 300-second worker behind on the shared Mac.
  afterEach(() => {
    for (const pid of recorded()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });
  // A `git` whose push takes four seconds and then really pushes: long enough
  // for a launcher that exits after two seconds to be gone mid-push.
  const slowPushPath = () => {
    writeFileSync(
      join(shimDir, 'git'),
      [
        '#!/usr/bin/env bash',
        'for a in "$@"; do',
        '  if [ "$a" = push ]; then sleep 4; break; fi',
        'done',
        `exec "${realGit}" "$@"`,
        '',
      ].join('\n')
    );
    chmodSync(join(shimDir, 'git'), 0o755);
    return { ...env(), AGENT_PUSH_LOAD_WAIT_SECONDS: '0', PATH: `${shimDir}:${process.env.PATH}` };
  };

  // A `git` whose push stands in for the hook: it starts a worker that ignores
  // SIGHUP and SIGINT (as the hook's vitest effectively did), then sits there.
  // Had the push been allowed to finish it would leave a `pushed` marker.
  const hangingPushPath = () => {
    writeFileSync(
      join(shimDir, 'git'),
      [
        '#!/usr/bin/env bash',
        'for a in "$@"; do',
        '  if [ "$a" = push ]; then',
        `    echo $$ > "${join(fixture, 'shim.pid')}"`,
        `    echo $PPID > "${join(fixture, 'step.pid')}"`,
        `    ps -o ppid= -p $PPID | tr -d ' ' > "${join(fixture, 'helper.pid')}"`,
        `    ( trap '' HUP INT; exec sleep 300 ) &`,
        `    echo $! > "${join(fixture, 'worker.pid')}"`,
        '    sleep 300',
        `    echo done > "${join(fixture, 'pushed')}"`,
        '    exit 0',
        '  fi',
        'done',
        `exec "${realGit}" "$@"`,
        '',
      ].join('\n')
    );
    chmodSync(join(shimDir, 'git'), 0o755);
    return { ...env(), AGENT_PUSH_LOAD_WAIT_SECONDS: '0', PATH: `${shimDir}:${process.env.PATH}` };
  };

  for (const [signal, code] of [
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    it(`on ${signal} terminates git push, the hook and its workers, and pushes nothing`, async () => {
      const run = spawn('bash', [helper], { cwd: tree, env: hangingPushPath() });
      let stderr = '';
      run.stderr.on('data', (chunk) => (stderr += chunk));
      const exited = new Promise<number | null>((done) => run.on('exit', (c) => done(c)));
      expect(await until(() => existsSync(join(fixture, 'worker.pid')), 30_000), stderr).toBe(true);
      const worker = workerPid();
      expect(running(worker)).toBe(true);

      const stopped = Date.now();
      run.kill(signal);
      expect(await exited, stderr).toBe(code);
      expect(Date.now() - stopped).toBeLessThan(8_000);
      expect(stderr).toMatch(/STOPPED: received .*git push was stopped before it completed/);
      expect(await until(() => !running(worker), 2_000)).toBe(true);
      expect(existsSync(join(fixture, 'pushed'))).toBe(false);
      expect(remoteRef('agent/feature')).toBe('');
    });
  }

  it('stops when the shell that launched it dies (the screen -X quit case)', async () => {
    const log = join(fixture, 'push.log');
    // The trailing command keeps bash from exec-ing the helper in its place,
    // so the helper has a parent shell to lose, as under `screen bash -c`.
    const shell = spawn('bash', ['-c', `bash "${helper}" 2> "${log}"; echo parent-finished`], {
      cwd: tree,
      env: hangingPushPath(),
      stdio: 'ignore',
    });
    expect(await until(() => existsSync(join(fixture, 'worker.pid')), 30_000)).toBe(true);
    const worker = workerPid();
    const table = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' }).stdout;
    const helperPid = table
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
      .find(([, ppid]) => ppid === shell.pid)?.[0];
    expect(helperPid).toBeGreaterThan(0);

    shell.kill('SIGKILL');
    expect(await until(() => !running(helperPid as number), 8_000)).toBe(true);
    expect(await until(() => !running(worker), 2_000)).toBe(true);
    expect(readFileSync(log, 'utf8')).toMatch(
      /STOPPED: its parent process went away.*git push was stopped before it completed/
    );
    expect(existsSync(join(fixture, 'pushed'))).toBe(false);
    expect(remoteRef('agent/feature')).toBe('');
  });

  // Review of 6016f5d6, B1: a SIGKILL of the helper's whole process group
  // cannot be trapped; the steps must be in that group so the kernel takes them.
  it('a SIGKILL of its whole process group leaves no worker and pushes nothing', async () => {
    const run = spawn('bash', [helper], {
      cwd: tree,
      env: hangingPushPath(),
      detached: true,
      stdio: 'ignore',
    });
    expect(await until(() => existsSync(join(fixture, 'worker.pid')), 30_000)).toBe(true);
    const pids = [run.pid as number, ...recorded()];
    expect(pids.length).toBeGreaterThanOrEqual(4);
    process.kill(-(run.pid as number), 'SIGKILL');
    expect(await until(() => pids.every((p) => !running(p)), 3_000), String(pids)).toBe(true);
    await sleep(3_000);
    expect(pids.filter((p) => running(p))).toEqual([]);
    expect(groupAlive(run.pid as number)).toBe(false);
    expect(existsSync(join(fixture, 'pushed'))).toBe(false);
    expect(remoteRef('agent/feature')).toBe('');
  });

  // B1, the other half: the helper alone is killed outright; its watcher,
  // which outlives it, stops the step it was running.
  it('a SIGKILL of the helper alone still stops the step it was running', async () => {
    const run = spawn('bash', [helper], { cwd: tree, env: hangingPushPath(), detached: true });
    let stderr = '';
    run.stderr.on('data', (chunk) => (stderr += chunk));
    expect(await until(() => existsSync(join(fixture, 'worker.pid')), 30_000), stderr).toBe(true);
    const step = recorded();
    process.kill(run.pid as number, 'SIGKILL');
    expect(await until(() => step.every((p) => !running(p)), 10_000), stderr).toBe(true);
    expect(
      await until(() => /STOPPED: the helper itself was killed/.test(stderr), 5_000),
      stderr
    ).toBe(true);
    expect(existsSync(join(fixture, 'pushed'))).toBe(false);
    expect(remoteRef('agent/feature')).toBe('');
  });

  // The host_terminal teardown pattern: the launcher returns at once and the
  // helper, started with `&` and no nohup, would run on as an orphan. Under the
  // detached-launch rule it stops (before it starts, or within a second).
  it('a launcher that exits while it runs in the background without nohup leaves nothing running', async () => {
    const log = join(fixture, 'push.log');
    spawn('bash', ['-c', `bash "${helper}" 2> "${log}" &`], {
      cwd: tree,
      env: hangingPushPath(),
      stdio: 'ignore',
    });
    const stopped = () =>
      existsSync(log) && /STOPPED: its parent process went away/.test(readFileSync(log, 'utf8'));
    expect(
      await until(stopped, 15_000),
      existsSync(log) ? readFileSync(log, 'utf8') : 'no log'
    ).toBe(true);
    expect(await until(() => recorded().every((p) => !running(p)), 8_000)).toBe(true);
    expect(existsSync(join(fixture, 'pushed'))).toBe(false);
    expect(remoteRef('agent/feature')).toBe('');
  });

  // Review of 6016f5d6, B2: one rule, not a race. nohup (SIGHUP ignored on
  // entry) or AGENT_PUSH_DETACHED=1 disarms the lost-parent stop; the outcome
  // is the same whether the launcher lingers or exits at once.
  for (const [name, launch] of [
    [
      'nohup, disown, launcher exits after 2 s',
      (h: string, l: string) => `nohup bash "${h}" > "${l}" 2>&1 & disown; sleep 2`,
    ],
    [
      'nohup, launcher exits at once',
      (h: string, l: string) => `nohup bash "${h}" > "${l}" 2>&1 &`,
    ],
    [
      'AGENT_PUSH_DETACHED=1, launcher exits at once',
      (h: string, l: string) => `AGENT_PUSH_DETACHED=1 bash "${h}" > "${l}" 2>&1 &`,
    ],
  ] as const) {
    it(`a detached launch (${name}) runs to a verified push`, async () => {
      const log = join(fixture, 'push.log');
      spawn('bash', ['-c', launch(helper, log)], {
        cwd: tree,
        env: slowPushPath(),
        stdio: 'ignore',
      });
      const done = () =>
        existsSync(log) && /VERIFIED|STOPPED|FAILED|REFUSED/.test(readFileSync(log, 'utf8'));
      expect(await until(done, 90_000)).toBe(true);
      const text = readFileSync(log, 'utf8');
      expect(text).not.toMatch(/STOPPED/);
      expect(text, text).toContain('VERIFIED');
      expect(remoteRef('agent/feature')).toBe(git(tree, 'rev-parse', 'HEAD'));
    });
  }

  // Review of 6016f5d6, N1 and N3, pinned at the source: the delayed SIGKILL
  // re-checks that each pid is still the process it was, a stop that lands
  // while a step is being started is held until the step is recorded, and the
  // steps stay in the helper's own process group (no `set -m`).
  it('re-checks a pid before SIGKILL, holds a stop during a step start and never moves steps to a group of their own', () => {
    const src = readFileSync(helper, 'utf8');
    expect(src).toMatch(/\[ "\$\(pid_start "\$pid"\)" = "\$line" \] && kill -KILL "\$pid"/);
    expect(src).toMatch(/STARTING=1\n\s+"\$@" &\n\s+STEP_PID=\$!/);
    expect(src).toMatch(/if \[ -n "\$STARTING" \]; then\n\s+PENDING_REASON=\$1/);
    expect(src).not.toMatch(/^\s*set -m/m);
  });
});
