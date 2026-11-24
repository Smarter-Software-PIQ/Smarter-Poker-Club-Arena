# Losing One External Drive

On 2026-11-22 at 19:12 America/Chicago SSD1 dropped off the bus for about 30 minutes. Three things went with it, and each now has one rule that every lane resolves the same way. The rules are functions of what is mounted at the moment of the action. Nothing watches, retries or repairs.

How a missing drive is recognised: a path under `/Volumes` whose nearest existing folder is on the boot disk. `/Volumes/SmarterWork` and `/Volumes/SmarterArchives` are compatibility folders on the boot disk; a drive is present only where a different device answers. `scripts/ops/drive-loss-lib.mjs` holds the rule (`drivePresence`), and `tests/unit/singleDriveLoss.test.ts` pins it.

## The Push Lock

The lock is the directory `ca-push-lock` inside the shared clone's git common directory. Every worktree of the clone resolves the same path, and no external drive can remove it.

```bash
node scripts/ops/push-lock.mjs path
node scripts/ops/push-lock.mjs status
node scripts/ops/push-lock.mjs acquire --owner "<lane and session> push of <branch> <sha>" --pid $$
node scripts/ops/push-lock.mjs release --pid $$
```

`acquire` never waits: exit 0 means you hold it, exit 1 means another lane does (its owner line is printed), exit 2 means it could not be evaluated. A wrapper loops on exit 1 with its own load and gate checks. Pass the pid of the long-lived wrapper, not of a subshell: a lock whose recorded pid no longer exists is taken over by the next `acquire`.

Transition from the old lock (`.../shared-capacity/hs-locks-01UxDLnM4/shepherd.lock` on SSD1): while that drive is mounted, `acquire` takes the old lock first and the clone lock second, and treats an old lock held by an old wrapper as held. A lane on the helper and a lane on an old wrapper therefore still exclude each other. When SSD1 is not mounted the old lock cannot be held and is ignored, so the clone lock is the only lock. Do not create any other fallback lock. Once every lane's wrapper calls the helper, the old-lock leg can be deleted from `push-lock.mjs`.

What this does not cover: a lane still on an old wrapper stalls while SSD1 is gone (its lock path is unreachable), and a push it started before the drop keeps running without holding the clone lock. Both end when that wrapper moves to the helper.

## Worktree Registrations

A bare `git worktree prune` deletes the registration of every worktree whose folder is absent, and a worktree on an unmounted drive is absent in exactly that way. Never run it. Use:

```bash
node scripts/ops/safe-worktree-prune.mjs --repo /Users/smarter.poker/Documents/club-arena [--dry-run]
```

It takes a git worktree lock on each registration whose drive is not mounted, prunes, and unlocks exactly the ones it locked. git never prunes a locked worktree. `scripts/prune-stale-worktrees.sh` and `scripts/agent-tree-janitor.sh` call it; the law test fails if any script or hook runs the bare command.

If a registration was already lost, the branch and its commits are intact. Recreate the tree with `git worktree add <path> <branch>`, or reconnect a folder that still exists with `git worktree repair <path>`.

## The Coordination Inbox

The canonical inbox is the SSD2 file `.../extreme-archive/COORDINATION-INBOX-FALLBACK-20261116.md`. The SSD1 file `COORDINATION-INBOX.md` is its mirror. After any outage, read the canonical file.

```bash
node scripts/ops/coordination-inbox-post.mjs --from "<lane (session)>" --to "<lanes>" --subject "<...>" --body-file <file>
node scripts/ops/coordination-inbox-post.mjs targets
```

A post goes to the canonical file and, when SSD1 is mounted, to the mirror. With SSD1 gone it lands in the canonical file alone. With SSD2 gone it is refused unless `--mirror-only` is given. A boot-disk folder that carries a drive's name is never written. The body must be pure ASCII and the post ends with `GATE END`.

## What Tells You a Drive Dropped

`operations/ops-mac/heartbeat.sh` raises `HostVolumeNotMounted` when a drive has no mounted path (PR #11793). This page adds no alert of its own.
