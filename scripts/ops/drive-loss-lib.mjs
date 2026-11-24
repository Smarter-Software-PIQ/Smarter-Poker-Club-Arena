// SINGLE-DRIVE LOSS: the rules every lane resolves the same way when an external drive drops off the bus.
//
// 2026-11-22 19:12 America/Chicago: SSD1 disappeared for about 30 minutes. With it went the one push lock
// (it lived on SSD1), the primary coordination inbox, and every worktree checked out on SSD1. While it was
// gone a bare `git worktree prune` deleted the registrations of those worktrees (their folders looked
// deleted; they were only unmounted), and lanes improvised a second lock, so two pre-pushes ran at once.
//
// Three rules, all pure functions of what is mounted right now, so two sessions can never disagree:
//   1. The push lock lives in the shared clone's git common directory, which no external drive can take
//      away, and which `git rev-parse --git-common-dir` resolves identically from every worktree.
//   2. A worktree registration is pruned only when its folder is really gone. A folder under /Volumes whose
//      drive is not mounted is "missing drive", never "gone", and its registration survives every prune.
//   3. The coordination inbox has one canonical file (SSD2) and one mirror (SSD1). A post is never written
//      into a boot-disk scaffold folder that only looks like a drive.
//
// Nothing here watches, retries or repairs. Each rule is evaluated at the moment of the action it guards.
import { dirname, join, resolve } from 'node:path';

export const VOLUMES_ROOT = '/Volumes';
export const PUSH_LOCK_NAME = 'ca-push-lock';
export const PUSH_LOCK_MARKER = 'via scripts/ops/push-lock.mjs';

/** The lock every wrapper used before this rule. Honoured while it is reachable, so old and new wrappers exclude each other. */
export const LEGACY_PUSH_LOCK_PARENT =
  '/Volumes/SmarterWork/agent-work/shared-capacity/hs-locks-01UxDLnM4';
export const LEGACY_PUSH_LOCK_NAME = 'shepherd.lock';

/** Canonical first. core-gate-running.py has read the SSD2 file since 2026-11-20, and it kept every post of the outage. */
export const INBOX_CANONICAL =
  '/Volumes/SmarterArchives/agent-evidence/extreme-archive/COORDINATION-INBOX-FALLBACK-20261116.md';
export const INBOX_MIRROR = '/Volumes/SmarterArchives 1/agent-evidence/COORDINATION-INBOX.md';

function isUnderVolumes(path) {
  return path === VOLUMES_ROOT || path.startsWith(`${VOLUMES_ROOT}/`);
}

/** The deepest ancestor of `path` (or `path` itself) that exists. `probe.exists(p)` answers for one path. */
export function nearestExisting(path, probe) {
  let p = resolve(path);
  for (;;) {
    if (probe.exists(p)) return p;
    const up = dirname(p);
    if (up === p) return p;
    p = up;
  }
}

/**
 * Where a path stands with respect to the drives.
 *   present        the path exists on an external volume, or anywhere outside /Volumes
 *   gone           the path does not exist and its drive is mounted (or it is not on a drive at all)
 *   missing-drive  the path is under /Volumes and what answers for it is the boot disk: the drive is not
 *                  mounted, and any folder there is a compatibility scaffold, not the drive
 * `probe.dev(p)` is the device number of an existing path; `probe.bootDev` is the device number of "/".
 */
export function drivePresence(path, probe) {
  const p = resolve(path);
  const anchor = nearestExisting(p, probe);
  const exists = anchor === p;
  if (isUnderVolumes(p) && probe.dev(anchor) === probe.bootDev) return 'missing-drive';
  return exists ? 'present' : 'gone';
}

/** `git worktree list --porcelain` -> [{ path, prunable, locked }] in listing order (the first is the main clone). */
export function parseWorktreePorcelain(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length), prunable: false, locked: false };
      out.push(cur);
    } else if (cur && (line === 'prunable' || line.startsWith('prunable '))) {
      cur.prunable = true;
    } else if (cur && (line === 'locked' || line.startsWith('locked '))) {
      cur.locked = true;
    }
  }
  return out;
}

/**
 * What `git worktree prune` may delete now. A registration whose folder is gone on a mounted drive (or off
 * the drives altogether) is prunable. A registration on a drive that is not mounted must survive: `protect`
 * lists those not already locked, and the caller holds a git worktree lock on each for the length of the
 * prune (git never prunes a locked worktree), then unlocks exactly those.
 */
export function worktreePruneDecision(worktrees, probe) {
  const missingDrive = [];
  const protect = [];
  const gone = [];
  for (const wt of worktrees.slice(1)) {
    const presence = drivePresence(wt.path, probe);
    if (presence === 'missing-drive') {
      missingDrive.push(wt.path);
      if (!wt.locked) protect.push(wt.path);
    } else if (presence === 'gone' && !wt.locked) {
      gone.push(wt.path);
    }
  }
  return { missingDrive, protect, gone };
}

/** Rule 1. The one push lock, for every worktree of one clone, whatever is or is not mounted. */
export function pushLockDir(gitCommonDir) {
  if (!gitCommonDir || isUnderVolumes(resolve(gitCommonDir))) {
    // A clone on an external drive would put the lock back on a drive that can vanish.
    throw new Error(
      `push lock: the shared clone's git common directory must be off /Volumes, got "${gitCommonDir}"`
    );
  }
  return join(resolve(gitCommonDir), PUSH_LOCK_NAME);
}

/** The legacy lock directory when its drive is mounted, else null (an unmounted drive cannot hold a lock). */
export function legacyPushLockDir(probe, parent = LEGACY_PUSH_LOCK_PARENT) {
  return drivePresence(parent, probe) === 'present' ? join(parent, LEGACY_PUSH_LOCK_NAME) : null;
}

/** One owner line: who, what, when, and the pid of the long-lived wrapper that holds the lock. */
export function formatLockOwner({ owner, pid, nowIso }) {
  const who = String(owner ?? '').trim();
  if (!who || /[\n\r]/.test(who)) throw new Error('push lock: --owner must be one non-empty line');
  if (!Number.isInteger(pid) || pid <= 1)
    throw new Error('push lock: --pid must be the wrapper pid');
  return `${who} pid=${pid} ${nowIso} ${PUSH_LOCK_MARKER}\n`;
}

/** { owner, pid, viaHelper } from an owner line; pid is null for a lock no helper wrote. */
export function parseLockOwner(text) {
  const line = String(text ?? '').split('\n')[0];
  const viaHelper = line.includes(PUSH_LOCK_MARKER);
  const m = /\spid=(\d+)\s/.exec(line);
  return { owner: line, pid: viaHelper && m ? Number(m[1]) : null, viaHelper };
}

/**
 * A lock whose holder is provably dead may be taken over: only a lock this helper wrote (it carries the
 * wrapper pid) and only when that pid no longer exists. A legacy wrapper's lock is never judged stale here.
 */
export function lockIsReclaimable(ownerText, pidAlive) {
  const { pid, viaHelper } = parseLockOwner(ownerText);
  return viaHelper && pid !== null && !pidAlive(pid);
}

/**
 * Rule 3. Where a coordination post is written. The canonical file must be on its mounted drive; the mirror
 * is written when its drive is mounted and skipped when it is not. A scaffold folder is never written.
 */
export function inboxTargets(probe, canonical = INBOX_CANONICAL, mirror = INBOX_MIRROR) {
  const targets = [];
  const skipped = [];
  for (const [role, path] of [
    ['canonical', canonical],
    ['mirror', mirror],
  ]) {
    const presence = drivePresence(path, probe);
    if (presence === 'present') targets.push({ role, path });
    else skipped.push({ role, path, why: presence });
  }
  return { targets, skipped, canonicalReachable: targets.some((t) => t.role === 'canonical') };
}

/** One inbox post in the format the lanes and core-gate-running.py read. Pure ASCII, ends with GATE END. */
export function formatInboxPost({ from, to, subject, body, nowIso }) {
  for (const [k, v] of Object.entries({ from, to, subject })) {
    if (!String(v ?? '').trim() || /[\n\r]/.test(String(v))) {
      throw new Error(`inbox post: --${k} must be one non-empty line`);
    }
  }
  const text = `\n## ${nowIso} FROM ${from} TO ${to} - SUBJECT: ${subject}\n${String(body ?? '').replace(/\s+$/, '')}\nGATE END\n`;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c > 126 || (c < 32 && c !== 10)) {
      throw new Error(`inbox post: non-ASCII or control character at offset ${i}`);
    }
  }
  return text;
}
