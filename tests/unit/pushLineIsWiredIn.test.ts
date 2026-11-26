/**
 * LAW: the push line is wired in, not just merged (2026-11-26).
 *
 * PR #11886 added the clone push lock, the safe worktree pruner and the drive-loss rules, but three gaps
 * stayed open: the scheduled janitor still ran a bare `git worktree prune` from a stale checkout and from
 * every clone's own pruner; only one lane's private wrapper took the clone push lock, so other pushes held
 * only the SSD1 lock or nothing; and core-gate-running.py lived only on SSD1, so with SSD1 gone the PLO core
 * gate check silently read as clear. These tests pin the fixes and fail the build if any gap reopens.
 * See docs/ops/single-drive-loss.md.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_PUSH_LOCK_PARENT,
  formatLockOwner,
  heldForThisPush,
  isSelfOrAncestor,
  lockHolderPid,
} from '../../scripts/ops/drive-loss-lib.mjs';
import { runPushLock } from '../../scripts/ops/push-lock.mjs';
import { DEFAULT_CORE_GATE_SCRIPT } from '../../scripts/ops/grade-holdem-option-lib.mjs';
import { gitFixtureEnvironment } from '../helpers/gitFixtureEnvironment';

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const code = (text: string) =>
  text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(#|\/\/|\*|\/\*)/.test(line));

const CLONE_GIT = '/bootdisk/dev/club-arena/.git';
const LOCK = `${CLONE_GIT}/ca-push-lock`;
const OLD = `${LEGACY_PUSH_LOCK_PARENT}/shepherd.lock`;
const BRANCH = 'agent/lane/fix/x';
const HEAD = 'a'.repeat(40);

/**
 * A fake machine for push-lock.mjs: `ssd1` decides whether the old lock's drive is mounted, `tree` maps a
 * pid to its parent, `alive` lists running pids, and every sleep advances the clock (and may run `onSleep`).
 */
function lockWorld({
  ssd1 = false,
  tree = {} as Record<number, number>,
  alive = [] as number[],
  gate = () => ({ state: 'clear', output: 'core gate clear' }),
  onSleep = (_n: number) => {},
} = {}) {
  const BOOT = 1;
  const SSD1 = 11;
  const paths = new Set<string>(['/', '/Volumes', CLONE_GIT, '/Volumes/SmarterWork']);
  const mounts: Record<string, number> = { '/': BOOT };
  if (ssd1) {
    mounts['/Volumes/SmarterWork/agent-work/shared-capacity'] = SSD1;
    paths.add('/Volumes/SmarterWork/agent-work');
    paths.add('/Volumes/SmarterWork/agent-work/shared-capacity');
    paths.add(LEGACY_PUSH_LOCK_PARENT);
  }
  const dev = (p: string) => {
    let best = '/';
    for (const m of Object.keys(mounts)) {
      if ((p === m || p.startsWith(`${m}/`)) && m.length > best.length) best = m;
    }
    return mounts[best];
  };
  const files = new Map<string, string>();
  const out: string[] = [];
  let clock = Date.parse('2026-11-26T06:00:00Z');
  let sleeps = 0;
  const deps = {
    gitCommonDir: () => CLONE_GIT,
    probe: { exists: (p: string) => paths.has(p), dev, bootDev: BOOT },
    mkdir: (d: string) => {
      if (paths.has(d)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      paths.add(d);
    },
    writeFile: (f: string, s: string) => void files.set(f, s),
    readFile: (f: string) => {
      if (!files.has(f)) throw new Error('ENOENT');
      return files.get(f) as string;
    },
    removeLock: (d: string) => {
      files.delete(`${d}/owner`);
      paths.delete(d);
    },
    pidAlive: (pid: number) => alive.includes(pid),
    now: () => new Date(clock),
    stdout: (s: string) => out.push(s),
    parentOf: (pid: number) => tree[pid] ?? null,
    sleep: (ms: number) => {
      sleeps += 1;
      clock += ms;
      onSleep(sleeps);
    },
    gateState: () => gate(),
  };
  const hold = (dir: string, line: string) => {
    paths.add(dir);
    files.set(`${dir}/owner`, line);
  };
  return {
    deps,
    files,
    out,
    paths,
    hold,
    sleeps: () => sleeps,
    owner: (d: string) => files.get(`${d}/owner`) ?? null,
  };
}

const helperLine = (owner: string, pid: number) =>
  formatLockOwner({ owner, pid, nowIso: '2026-11-26T05:59:00Z' });
const waitAcquire = (pid: number, extra: string[] = []) => [
  'wait-acquire',
  '--owner',
  `agent-push.sh push of ${BRANCH} ${HEAD}`,
  '--pid',
  String(pid),
  '--branch',
  BRANCH,
  '--head',
  HEAD,
  '--wait-seconds',
  '30',
  '--poll-seconds',
  '10',
  ...extra,
];

describe('push-lock.mjs is re-entrant for the push it is already held for', () => {
  it('re-entrant when an ancestor holds it: not taken again, not waited for, not released', () => {
    // wrapper 100 -> subshell 200 -> agent-push.sh 300
    const w = lockWorld({ tree: { 300: 200, 200: 100, 100: 1 }, alive: [100, 200, 300] });
    const wrapperLine = helperLine('lane-a push of other/branch bbb', 100);
    w.hold(LOCK, wrapperLine);
    expect(runPushLock(waitAcquire(300), w.deps)).toBe(0);
    expect(w.sleeps()).toBe(0);
    expect(w.owner(LOCK)).toBe(wrapperLine);
    expect(w.out.join('\n')).toContain('already held for this push');
    expect(runPushLock(['release', '--pid', '300'], w.deps)).toBe(0);
    expect(w.owner(LOCK)).toBe(wrapperLine); // the wrapper's lock outlives the helper
  });

  it('an hd-* wrapper holding only the SSD1 lock (no pid) is recognised by branch and commit; the clone lock is still taken', () => {
    const w = lockWorld({ ssd1: true, tree: { 300: 1 }, alive: [300] });
    const hd = `hd-01BNteGZ session_x push of ${BRANCH} ${HEAD} 2026-11-26T05:58:00Z\n`;
    w.hold(OLD, hd);
    expect(runPushLock(waitAcquire(300), w.deps)).toBe(0);
    expect(w.owner(OLD)).toBe(hd);
    expect(w.owner(LOCK)).toContain('pid=300');
    expect(runPushLock(['release', '--pid', '300'], w.deps)).toBe(0);
    expect(w.paths.has(LOCK)).toBe(false);
    expect(w.owner(OLD)).toBe(hd);
  });

  it('a different commit of the same branch, or a non-ancestor pid, is somebody else', () => {
    const self = { pid: 300, parentOf: (p: number) => ({ 300: 200, 200: 1 })[p] ?? null };
    expect(
      heldForThisPush(`x push of ${BRANCH} ${'b'.repeat(40)} t\n`, {
        ...self,
        branch: BRANCH,
        head: HEAD,
      })
    ).toBe(false);
    expect(heldForThisPush(helperLine('y', 999), { ...self, branch: BRANCH, head: HEAD })).toBe(
      false
    );
    expect(heldForThisPush(helperLine('y', 200), { ...self, branch: BRANCH, head: HEAD })).toBe(
      true
    );
    expect(isSelfOrAncestor(1, 300, self.parentOf)).toBe(false); // launchd/init is everybody's ancestor
    expect(lockHolderPid('old push of x 2026-11-26T05:37:38Z pid=18658\n')).toBe(18658);
    expect(lockHolderPid('hd push of x abc 2026-11-26T05:37:38Z\n')).toBeNull();
  });
});

describe('push-lock.mjs wait-acquire takes, waits, and never steals', () => {
  it('acquires and releases when nobody holds it', () => {
    for (const ssd1 of [false, true]) {
      const w = lockWorld({ ssd1, tree: { 300: 1 }, alive: [300] });
      expect(runPushLock(waitAcquire(300), w.deps)).toBe(0);
      expect(w.owner(LOCK)).toContain('pid=300');
      expect(w.paths.has(OLD)).toBe(ssd1);
      expect(runPushLock(['release', '--pid', '300'], w.deps)).toBe(0);
      expect(w.paths.has(LOCK)).toBe(false);
      expect(w.paths.has(OLD)).toBe(false);
    }
  });

  it('waits and never steals when another push holds it, then gives up with nothing taken', () => {
    const w = lockWorld({ ssd1: true, tree: { 300: 1 }, alive: [300, 999] });
    const other = helperLine('lane-b push of other/branch ccc', 999);
    w.hold(LOCK, other);
    w.hold(OLD, other);
    expect(runPushLock(waitAcquire(300), w.deps)).toBe(1);
    expect(w.sleeps()).toBe(3);
    expect(w.owner(LOCK)).toBe(other);
    expect(w.owner(OLD)).toBe(other);
    const log = w.out.join('\n');
    expect(log).toContain('push lock: waiting');
    expect(log).toContain('lane-b push');
    expect(log).toContain('Nothing was taken or stolen');
  });

  it('takes it as soon as the other push releases it', () => {
    const other = helperLine('lane-b push', 999);
    const w = lockWorld({
      tree: { 300: 1 },
      alive: [300, 999],
      onSleep: (n) => {
        if (n === 2) w.deps.removeLock(LOCK);
      },
    });
    w.hold(LOCK, other);
    expect(runPushLock(waitAcquire(300), w.deps)).toBe(0);
    expect(w.sleeps()).toBe(2);
    expect(w.owner(LOCK)).toContain('pid=300');
  });

  it('a running or unreadable PLO core gate is busy, never clear', () => {
    for (const state of ['running', 'unreadable']) {
      const w = lockWorld({
        tree: { 300: 1 },
        alive: [300],
        gate: () => ({ state, output: state }),
      });
      expect(runPushLock(waitAcquire(300, ['--gate-script', 'g.py']), w.deps)).toBe(1);
      expect(w.paths.has(LOCK)).toBe(false);
      expect(w.out.join('\n')).toMatch(
        state === 'running' ? /core gate is running/ : /treated as busy/
      );
    }
    const ok = lockWorld({ tree: { 300: 1 }, alive: [300] });
    expect(runPushLock(waitAcquire(300, ['--gate-script', 'g.py']), ok.deps)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// scripts/agent-push.sh end to end, against a local bare repository that the clone reaches through a
// github.com URL (url.<bare>.insteadOf), so the helper takes the lock exactly as it does for a lane push.
// Runs where the old SSD1 lock folder is absent and the fixture is off /Volumes (CI): on the shared Mac the
// real SSD1 lock would be touched, and a clone under /Volumes cannot carry the lock by design.
// ---------------------------------------------------------------------------------------------------------
const onIsolatedHost =
  !existsSync(LEGACY_PUSH_LOCK_PARENT) && !resolve(tmpdir()).startsWith('/Volumes/');

describe.skipIf(!onIsolatedHost)(
  'scripts/agent-push.sh holds the clone push lock for git push',
  () => {
    const helper = resolve(ROOT, 'scripts/agent-push.sh');
    const FAKE_URL = 'https://github.com/example-org/push-lock-fixture.git';
    let fixture: string;
    let bare: string;
    let clone: string;
    let tree: string;
    let hookLog: string;
    let lockDir: string;
    let hookExit: string;
    const children: ChildProcess[] = [];
    const env = () => gitFixtureEnvironment();
    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync(
        'git',
        [
          '-c',
          'user.name=F',
          '-c',
          'user.email=f@example.invalid',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd, env: env(), encoding: 'utf8' }
      );
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const push = (extra: NodeJS.ProcessEnv = {}) =>
      spawnSync('bash', [helper], {
        cwd: tree,
        env: { ...env(), AGENT_PUSH_LOAD_WAIT_SECONDS: '0', ...extra },
        encoding: 'utf8',
      });
    const remoteRef = () =>
      spawnSync(
        'git',
        ['--git-dir', bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/agent/feature'],
        {
          env: env(),
          encoding: 'utf8',
        }
      ).stdout.trim();

    beforeEach(() => {
      fixture = mkdtempSync(join(tmpdir(), 'push-line-'));
      bare = join(fixture, 'origin.git');
      clone = join(fixture, 'clone');
      tree = join(fixture, 'tree');
      hookLog = join(fixture, 'hook.log');
      hookExit = join(fixture, 'hook.exit');
      writeFileSync(hookExit, '0');
      spawnSync('git', ['init', '--bare', '--initial-branch=main', bare], { env: env() });
      git(fixture, 'clone', bare, clone);
      git(clone, 'commit', '--allow-empty', '-m', 'base');
      git(clone, 'push', 'origin', 'HEAD:refs/heads/main');
      git(clone, 'config', 'remote.origin.url', FAKE_URL);
      git(clone, 'config', `url.${bare}.insteadOf`, FAKE_URL);
      lockDir = join(clone, '.git', 'ca-push-lock');
      const hooks = join(fixture, 'hooks');
      mkdirSync(hooks);
      // The stub pre-push records who held the clone lock while git was pushing, then passes or fails.
      writeFileSync(
        join(hooks, 'pre-push'),
        `#!/usr/bin/env bash\n{ cat "${lockDir}/owner" 2>/dev/null || echo NO-LOCK; } >> "${hookLog}"\nexit "$(cat "${hookExit}")"\n`
      );
      chmodSync(join(hooks, 'pre-push'), 0o755);
      git(clone, 'config', 'core.hooksPath', hooks);
      git(clone, 'worktree', 'add', '-b', 'agent/feature', tree);
      git(tree, 'commit', '--allow-empty', '-m', 'feature work');
    });
    afterEach(() => {
      for (const c of children.splice(0)) c.kill('SIGKILL');
      rmSync(fixture, { recursive: true, force: true });
    });

    it('acquires the lock for git push and releases it when the push is done', () => {
      const r = push();
      expect(r.status, r.stderr).toBe(0);
      expect(remoteRef()).toBe(git(tree, 'rev-parse', 'HEAD'));
      const seen = readFileSync(hookLog, 'utf8');
      expect(seen).toContain('agent-push.sh push of agent/feature');
      expect(seen).not.toContain('NO-LOCK');
      expect(existsSync(lockDir)).toBe(false);
    });

    it('releases the lock when the push fails', () => {
      writeFileSync(hookExit, '1');
      const r = push();
      expect(r.status).not.toBe(0);
      expect(readFileSync(hookLog, 'utf8')).toContain('agent-push.sh push of agent/feature');
      expect(existsSync(lockDir)).toBe(false);
      expect(remoteRef()).toBe('');
    });

    it('is re-entrant when an ancestor (the calling wrapper) holds the lock, and leaves it held', () => {
      mkdirSync(lockDir);
      const wrapperLine = formatLockOwner({
        owner: 'wrapper push',
        pid: process.pid,
        nowIso: 'now',
      });
      writeFileSync(join(lockDir, 'owner'), wrapperLine);
      const r = push();
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(hookLog, 'utf8')).toContain('wrapper push');
      expect(readFileSync(join(lockDir, 'owner'), 'utf8')).toBe(wrapperLine);
    });

    it('waits for another push and never steals its lock; gives up with exit 4 and nothing pushed', () => {
      const other = spawn('sleep', ['120'], { stdio: 'ignore' });
      children.push(other);
      mkdirSync(lockDir);
      const otherLine = formatLockOwner({
        owner: 'lane-b push',
        pid: other.pid as number,
        nowIso: 'now',
      });
      writeFileSync(join(lockDir, 'owner'), otherLine);
      const r = push({ AGENT_PUSH_LOCK_WAIT_SECONDS: '1' });
      expect(r.status, r.stderr).toBe(4);
      expect(`${r.stdout}\n${r.stderr}`).toContain('lane-b push');
      expect(readFileSync(join(lockDir, 'owner'), 'utf8')).toBe(otherLine);
      expect(existsSync(hookLog)).toBe(false);
      expect(remoteRef()).toBe('');
    });
  }
);

describe('hardening: the gaps cannot reopen', () => {
  const BARE_PRUNE = /\bgit\b[^\n|;&]*\bworktree\s+prune\b/;

  it('(a) the janitors never run a bare prune and never take a helper from $CLONE or the repo root', () => {
    for (const f of ['scripts/agent-tree-janitor.sh', 'scripts/prune-stale-worktrees.sh']) {
      for (const { line, n } of code(read(f))) {
        expect(BARE_PRUNE.test(line), `${f}:${n} runs a bare git worktree prune`).toBe(false);
        expect(
          /\$\{?CLONE\}?\/scripts\//.test(line),
          `${f}:${n} resolves a helper from $CLONE`
        ).toBe(false);
        expect(
          /\$\{?REPO_ROOT\}?\/scripts\//.test(line),
          `${f}:${n} resolves a helper from the repo root`
        ).toBe(false);
      }
    }
    const janitor = read('scripts/agent-tree-janitor.sh');
    expect(janitor).toContain('SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)');
    expect(janitor).toContain('SAFE_PRUNE="$SELF_DIR/ops/safe-worktree-prune.mjs"');
    expect(janitor).toMatch(
      /if \[ -f "\$SAFE_PRUNE" \]; then\n\s+node "\$SAFE_PRUNE" --repo "\$CLONE"/
    );
    expect(janitor).toContain('PRUNE REFUSED');
    expect(read('scripts/prune-stale-worktrees.sh')).toContain(
      'SAFE_PRUNE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ops/safe-worktree-prune.mjs"'
    );
  });

  it('(a) the janitor run in report mode from a copy outside any clone prunes nothing and reaches no bare prune', () => {
    const work = mkdtempSync(join(tmpdir(), 'janitor-copy-'));
    try {
      const env = gitFixtureEnvironment();
      const repo = join(work, 'repo');
      spawnSync('git', ['init', '--initial-branch=main', repo], { env });
      spawnSync(
        'git',
        [
          '-C',
          repo,
          '-c',
          'user.name=F',
          '-c',
          'user.email=f@x',
          'commit',
          '--allow-empty',
          '-m',
          'b',
        ],
        { env }
      );
      // A registration whose folder is gone: a bare prune would delete it; report mode must not.
      spawnSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', join(work, 'gone')], {
        env,
      });
      rmSync(join(work, 'gone'), { recursive: true, force: true });
      const copy = join(work, 'extracted', 'scripts');
      mkdirSync(join(copy, 'ops'), { recursive: true });
      for (const f of ['agent-tree-janitor.sh', 'prune-stale-worktrees.sh']) {
        writeFileSync(join(copy, f), read(`scripts/${f}`));
      }
      for (const f of ['safe-worktree-prune.mjs', 'drive-loss-lib.mjs', 'fs-drive-probe.mjs']) {
        writeFileSync(join(copy, 'ops', f), read(`scripts/ops/${f}`));
      }
      const r = spawnSync('bash', [join(copy, 'agent-tree-janitor.sh')], {
        env: { ...env, CA_CLONE: repo },
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('[safe-worktree-prune] dry run');
      const list = spawnSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
        env,
        encoding: 'utf8',
      }).stdout;
      expect(list).toContain(join(work, 'gone'));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('(b) agent-push.sh never runs git push without the clone push lock, and releases it on every way out', () => {
    const lines = code(read('scripts/agent-push.sh')).map(({ line }) => line);
    const pushAt = lines.findIndex((l) => /owned "\$\{REMOTE_GIT\[@\]\}" push /.test(l));
    const acquireAt = lines.findIndex((l) => /owned node "\$PUSH_LOCK_JS" wait-acquire/.test(l));
    expect(pushAt).toBeGreaterThan(0);
    expect(acquireAt).toBeGreaterThan(0);
    expect(acquireAt).toBeLessThan(pushAt);
    expect(lines.filter((l) => /\bpush -u\b/.test(l))).toHaveLength(1);
    expect(lines[pushAt + 2]).toMatch(/^\s*release_push_lock\s*$/);
    const text = read('scripts/agent-push.sh');
    expect(text).toMatch(/trap '[^']*release_push_lock[^']*' EXIT/);
    expect(text).toContain('PUSH_LOCK_JS="$SCRIPT_DIR/ops/push-lock.mjs"');
    expect(text).toMatch(/--pid "\$MAIN_PID"/);
    // A missing helper refuses the push; it never falls through to an unlocked push.
    expect(text).toMatch(/if \[ ! -f "\$PUSH_LOCK_JS" \]; then\n[^\n]*REFUSED[^\n]*\n\s+exit 4/);
    expect(lines.join('\n')).not.toMatch(/--no-verify/);
  });

  it('(c) no repository script reads core-gate-running.py from the SSD1 lock folder', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '_archive') continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(sh|bash|mjs|cjs|js|ts|py)$/.test(name) && !full.includes('/.husky/')) continue;
        if (st.size > 2_000_000 || full.endsWith('scripts/ops/core-gate-running.py')) continue;
        for (const { line, n } of code(readFileSync(full, 'utf8'))) {
          if (!line.includes('core-gate-running.py')) continue;
          if (/hs-locks-|lockDir\}?\/core-gate|\$\{?L\}?\/core-gate/.test(line)) {
            offenders.push(`${full.slice(ROOT.length + 1)}:${n}`);
          }
        }
      }
    };
    for (const top of ['scripts', '.husky', 'operations']) walk(join(ROOT, top));
    expect(offenders).toEqual([]);
    expect(DEFAULT_CORE_GATE_SCRIPT).toBe(join(ROOT, 'scripts/ops/core-gate-running.py'));
    expect(read('scripts/agent-push.sh')).toContain(
      '--gate-script "$SCRIPT_DIR/ops/core-gate-running.py"'
    );
  });
});

describe('scripts/ops/core-gate-running.py keeps its contract (0 running, 1 clear, 2 unreadable)', () => {
  const python = spawnSync('python3', ['--version']).status === 0;
  it.skipIf(!python)(
    'reads only CORE-POOLED-2 GATE START/DONE headings and says unreadable as exit 2',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'core-gate-'));
      try {
        const script = join(ROOT, 'scripts/ops/core-gate-running.py');
        const inbox = join(dir, 'inbox.md');
        const run = () => spawnSync('python3', [script, inbox], { encoding: 'utf8' });
        writeFileSync(
          inbox,
          [
            '## 2026-11-20T22:33Z FROM PLO-OWNER lane CORE-POOLED-2 (Claude s) TO lead - SUBJECT: GATE START run 4',
            '## 2026-11-20T23:00Z FROM HD lane (re CORE-POOLED-2) TO lead - SUBJECT: GATE DONE quoted, not theirs',
            '',
          ].join('\n')
        );
        expect(run().status).toBe(0);
        writeFileSync(
          inbox,
          `${readFileSync(inbox, 'utf8')}## 2026-11-21T00:23Z FROM PLO-OWNER lane CORE-POOLED-2 (Claude s) TO lead - SUBJECT: GATE DONE run 4\n`
        );
        expect(run().status).toBe(1);
        rmSync(inbox);
        expect(run().status).toBe(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
