#!/usr/bin/env node
// THE ONE PUSH LOCK, at a place no external drive can take away.
//
//   node scripts/ops/push-lock.mjs path
//   node scripts/ops/push-lock.mjs status
//   node scripts/ops/push-lock.mjs acquire --owner "<lane and session> push of <branch> <sha>" --pid <wrapper pid>
//   node scripts/ops/push-lock.mjs release --pid <wrapper pid>
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
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formatLockOwner,
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

/** mkdir is the atomic test-and-set. Returns null when taken, else the current holder's owner line. */
function takeDir(deps, dir, ownerLine) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      deps.mkdir(dir);
      deps.writeFile(join(dir, 'owner'), ownerLine);
      return null;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readOwner(deps, dir);
      if (attempt === 0 && holder !== null && lockIsReclaimable(holder, deps.pidAlive)) {
        deps.removeLock(dir);
        continue;
      }
      return holder ?? '(held; owner file not written yet)';
    }
  }
  return '(held)';
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
  if (command === 'acquire') {
    const ownerLine = formatLockOwner({
      owner: flags.owner,
      pid,
      nowIso: deps.now().toISOString(),
    });
    if (legacy) {
      const holder = takeDir(deps, legacy, ownerLine);
      if (holder !== null) {
        deps.stdout(`push lock held (old lock): ${holder.trim()}`);
        return 1;
      }
    }
    const holder = takeDir(deps, lock, ownerLine);
    if (holder !== null) {
      if (legacy) dropDir(deps, legacy, pid);
      deps.stdout(`push lock held: ${holder.trim()}`);
      return 1;
    }
    deps.stdout(`push lock acquired at ${lock}${legacy ? ' (and the old lock)' : ''}`);
    return 0;
  }
  if (command === 'release') {
    if (!Number.isInteger(pid) || pid <= 1) throw new Error('release needs --pid <wrapper pid>');
    const a = dropDir(deps, lock, pid);
    const b = legacy ? dropDir(deps, legacy, pid) : false;
    deps.stdout(a || b ? 'push lock released' : 'push lock: nothing held by this pid');
    return 0;
  }
  throw new Error(`unknown subcommand "${command}". Expected: path, status, acquire, release`);
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
    });
  } catch (err) {
    console.error(`[push-lock] ${err.message}`);
    process.exitCode = 2;
  }
}
