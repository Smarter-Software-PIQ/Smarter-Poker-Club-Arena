#!/usr/bin/env node
// THE ONE PUSH LOCK, at a place no external drive can take away.
//
//   node scripts/ops/push-lock.mjs path
//   node scripts/ops/push-lock.mjs status
//   node scripts/ops/push-lock.mjs acquire --owner "<lane and session> push of <branch> <sha>" --pid <wrapper pid>
//   node scripts/ops/push-lock.mjs release --pid <wrapper pid>
//   node scripts/ops/push-lock.mjs wait-acquire --owner "<who> push of <branch> <sha>" --pid <pid> \
//        --branch <branch> --head <sha> [--wait-seconds 3600] [--poll-seconds 10] [--gate-script <py>]
//
// The lock is the directory <git common dir>/ca-push-lock of the shared clone: every worktree of the clone
// resolves the same path with `git rev-parse --git-common-dir`, and it is on the boot disk beside the object
// store every push already needs, so losing SSD1 or SSD2 cannot remove it or split the lanes onto two locks.
//
// acquire never waits: exit 0 = you hold it, exit 1 = somebody else does (the holder is printed), exit 2 =
// it could not be evaluated. A wrapper loops on exit 1 with its own load and gate checks, as before.
//
// Transition: while the old lock's drive is mounted, acquire also takes
// /Volumes/SmarterWork/agent-work/shared-capacity/hs-locks-01UxDLnM4/shepherd.lock (first), and treats one
// held by an old wrapper as held. So a lane on this helper and a lane on an old wrapper still exclude each
// other. When that drive is not mounted the old lock cannot be held by anyone and is ignored.
//
// A lock whose recorded wrapper pid no longer exists is taken over (only locks this helper wrote carry a
// pid). That is evaluated inside acquire, at the moment it matters; nothing watches or sweeps.
//
// RE-ENTRANT (2026-11-26). scripts/agent-push.sh now takes this lock itself for every push to GitHub, and
// most pushes run under a lane wrapper that already holds it (or holds only the old SSD1 lock). A lock held
// on behalf of this push is not taken twice and never waited for: its holder pid is --pid or an ancestor of
// --pid (walked with `ps -o ppid= -p`), or its owner line says it is pushing exactly --branch at --head (the
// hd-* wrappers record no pid). acquire then takes only what is free, so the clone lock is always held for
// the push, and release --pid drops only what this pid itself took.
//
// wait-acquire is acquire in a bounded loop for scripts/agent-push.sh: exit 0 = held for this push (taken
// or re-entrant), exit 1 = still busy after --wait-seconds (nothing taken, nothing stolen), exit 2 = could
// not be evaluated. With --gate-script it first asks scripts/ops/core-gate-running.py whether the PLO core
// gate is running; exit 0 (running) and anything but exit 1 (clear), an unreadable inbox included, are
// busy: an unreadable inbox is never read as clear.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formatLockOwner,
  heldForThisPush,
  legacyPushLockDir,
  lockIsReclaimable,
  parseLockOwner,
  pushLockDir,
} from './drive-loss-lib.mjs';
import { fsDriveProbe } from './fs-drive-probe.mjs';

function readOwner(deps, dir) {
  try {
    return deps.readFile(join(dir, 'owner'));
  } catch {
    return null;
  }
}

/**
 * mkdir is the atomic test-and-set. Returns { state: 'taken' } when this call took it, { state: 'ours' }
 * when it is already held for this push (see heldForThisPush), else { state: 'held', holder }.
 */
function takeDir(deps, dir, ownerLine, self) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      deps.mkdir(dir);
      deps.writeFile(join(dir, 'owner'), ownerLine);
      return { state: 'taken' };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readOwner(deps, dir);
      if (holder !== null && heldForThisPush(holder, self)) return { state: 'ours', holder };
      if (attempt === 0 && holder !== null && lockIsReclaimable(holder, deps.pidAlive)) {
        deps.removeLock(dir);
        continue;
      }
      return { state: 'held', holder: holder ?? '(held; owner file not written yet)' };
    }
  }
  return { state: 'held', holder: '(held)' };
}

function dropDir(deps, dir, pid) {
  const holder = readOwner(deps, dir);
  if (holder === null || parseLockOwner(holder).pid !== pid) return false;
  deps.removeLock(dir);
  return true;
}

export function runPushLock(argv, deps) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) {
      throw new Error(`bad argument "${rest[i]}"`);
    }
    flags[rest[i].slice(2)] = rest[i + 1];
  }
  const lock = pushLockDir(deps.gitCommonDir());
  const legacy = legacyPushLockDir(deps.probe);

  if (command === 'path') {
    deps.stdout(lock);
    return 0;
  }
  if (command === 'status') {
    const holders = [lock, legacy].filter(Boolean).map((d) => [d, readOwner(deps, d)]);
    const held = holders.filter(([d, o]) => o !== null || deps.probe.exists(d));
    if (held.length === 0) deps.stdout('push lock: free');
    for (const [d, o] of held) deps.stdout(`push lock HELD at ${d}: ${(o ?? '?').trim()}`);
    if (!legacy)
      deps.stdout('push lock: the old lock drive is not mounted; only the clone lock counts');
    return held.length === 0 ? 0 : 1;
  }
  const pid = Number(flags.pid);
  const self = {
    pid,
    parentOf: deps.parentOf ?? (() => null),
    branch: flags.branch,
    head: flags.head,
  };
  /** One attempt: { code: 0 | 1, message }. Takes only what is free; holds nothing when it reports 1. */
  const acquireOnce = () => {
    const ownerLine = formatLockOwner({
      owner: flags.owner,
      pid,
      nowIso: deps.now().toISOString(),
    });
    const old = legacy ? takeDir(deps, legacy, ownerLine, self) : null;
    if (old && old.state === 'held') {
      return { code: 1, message: `push lock held (old lock): ${old.holder.trim()}` };
    }
    const cur = takeDir(deps, lock, ownerLine, self);
    if (cur.state === 'held') {
      if (old && old.state === 'taken') dropDir(deps, legacy, pid);
      return { code: 1, message: `push lock held: ${cur.holder.trim()}` };
    }
    const states = [cur, old].filter(Boolean).map((r) => r.state);
    if (states.every((st) => st === 'ours')) {
      return {
        code: 0,
        message: `push lock already held for this push (${cur.holder.trim()}); not taken again`,
      };
    }
    const how =
      cur.state === 'ours' ? 'already held for this push' : `acquired at ${lock} for pid ${pid}`;
    const oldHow = !old
      ? ''
      : old.state === 'ours'
        ? '; old lock already held for this push'
        : ' (and the old lock)';
    return { code: 0, message: `push lock ${how}${oldHow}` };
  };
  if (command === 'acquire') {
    const r = acquireOnce();
    deps.stdout(r.message);
    return r.code;
  }
  if (command === 'wait-acquire') {
    if (!Number.isInteger(pid) || pid <= 1) throw new Error('wait-acquire needs --pid <pid>');
    const waitSeconds = Number(flags['wait-seconds'] ?? 3600);
    const pollSeconds = Number(flags['poll-seconds'] ?? 10);
    if (!(waitSeconds >= 0) || !(pollSeconds > 0))
      throw new Error('bad --wait-seconds/--poll-seconds');
    const started = deps.now().getTime();
    let lastLog = null;
    for (;;) {
      let reason;
      const gate = flags['gate-script'] ? deps.gateState(flags['gate-script']) : null;
      if (gate && gate.state === 'running') {
        reason = `the PLO core gate is running (${gate.output})`;
      } else if (gate && gate.state !== 'clear') {
        reason = `the core gate could not be confirmed clear, treated as busy (${gate.output})`;
      } else {
        const r = acquireOnce();
        if (r.code === 0) {
          deps.stdout(r.message);
          return 0;
        }
        reason = r.message;
      }
      const waited = Math.floor((deps.now().getTime() - started) / 1000);
      if (waited >= waitSeconds) {
        deps.stdout(
          `push lock: still busy after ${waited}s (limit ${waitSeconds}s): ${reason}. Nothing was taken or stolen.`
        );
        return 1;
      }
      if (lastLog === null || waited - lastLog >= 60) {
        deps.stdout(`push lock: waiting (${waited}s of ${waitSeconds}s): ${reason}`);
        lastLog = waited;
      }
      deps.sleep(pollSeconds * 1000);
    }
  }
  if (command === 'release') {
    if (!Number.isInteger(pid) || pid <= 1) throw new Error('release needs --pid <wrapper pid>');
    const a = dropDir(deps, lock, pid);
    const b = legacy ? dropDir(deps, legacy, pid) : false;
    deps.stdout(a || b ? 'push lock released' : 'push lock: nothing held by this pid');
    return 0;
  }
  throw new Error(
    `unknown subcommand "${command}". Expected: path, status, acquire, wait-acquire, release`
  );
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    process.exitCode = runPushLock(process.argv.slice(2), {
      gitCommonDir: () => {
        const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
          encoding: 'utf8',
        });
        if (r.status !== 0) throw new Error('not inside a git worktree of the shared clone');
        return r.stdout.trim();
      },
      probe: fsDriveProbe(),
      mkdir: (d) => mkdirSync(d),
      writeFile: (f, s) => writeFileSync(f, s),
      readFile: (f) => readFileSync(f, 'utf8'),
      removeLock: (d) => {
        rmSync(join(d, 'owner'), { force: true });
        rmdirSync(d);
      },
      pidAlive: (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (err) {
          return err.code === 'EPERM';
        }
      },
      now: () => new Date(),
      stdout: (s) => console.log(s),
      // One `ps -o ppid= -p` per step up the tree; never a whole-table listing.
      parentOf: (p) => {
        const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(p)], { encoding: 'utf8' });
        const n = Number(String(r.stdout ?? '').trim());
        return r.status === 0 && Number.isInteger(n) && n > 0 ? n : null;
      },
      sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
      gateState: (script) => {
        const r = spawnSync('python3', [script], { encoding: 'utf8' });
        const output = `${String(r.stdout ?? '').trim()} ${String(r.stderr ?? '').trim()}`.trim();
        if (r.status === 0) return { state: 'running', output };
        if (r.status === 1) return { state: 'clear', output };
        return {
          state: 'unreadable',
          output: output || `core-gate-running.py exited ${r.status ?? r.signal ?? r.error?.code}`,
        };
      },
    });
  } catch (err) {
    console.error(`[push-lock] ${err.message}`);
    process.exitCode = 2;
  }
}
