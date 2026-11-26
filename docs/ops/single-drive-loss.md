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

### Every Push Holds It (2026-11-26)

Until 2026-11-26 only the lanes whose private wrapper called the helper held the clone lock. The other wrappers took only the SSD1 `shepherd.lock`, and a push launched without any wrapper took nothing, so two pre-push gates could still run at once, and with SSD1 gone nothing was held at all. The one entry point every push already runs, `scripts/agent-push.sh`, now holds the clone lock itself for the length of `git push`, through:

```bash
node scripts/ops/push-lock.mjs wait-acquire --owner "agent-push.sh push of <branch> <sha>" --pid <pid> \
  --branch <branch> --head <sha> [--wait-seconds 3600] [--poll-seconds 10] [--gate-script scripts/ops/core-gate-running.py]
```

- Re-entrant. A lock held for this push is not taken again and never waited for: its holder pid is the helper's own pid or one of its ancestors (the wrapper that ran it, walked with `ps -o ppid= -p`), or its owner line says it is pushing exactly this branch at exactly this commit (the hd-\* wrappers record no pid). `acquire` takes only what is free, so the clone lock is always held while git pushes, and `release --pid` drops only what that pid took.
- Free: taken with the helper's pid, released as soon as `git push` returns, and by the EXIT trap on every other way out (failure, stop signal).
- Held by another push: waited for, one log line a minute, never stolen. After `AGENT_PUSH_LOCK_WAIT_SECONDS` (default 3600) nothing is pushed and the helper exits 4.
- Only a push to GitHub takes it. A push to a local fixture remote (the tests' bare repositories) does not contend with live lanes.

Wrappers keep working unchanged: one that holds the lock (clone or old) is recognised as this push's holder. No lane wrapper file needs editing.

A push already running when SSD1 drops keeps the clone lock it holds; a lane still on an old wrapper whose lock path is unreachable now waits on the clone lock inside `agent-push.sh` instead of pushing unlocked.

## The PLO Core Gate Check

`scripts/ops/core-gate-running.py` is the repository copy of the check that used to live only in the SSD1 lock folder. Wrappers called it as `[ -f "$L/core-gate-running.py" ] && python3 ...`, so when SSD1 dropped the file vanished and the gate silently read as clear. It reads the SSD2 inbox: exit 0 running, 1 clear, 2 inbox unreadable. `agent-push.sh` (on the Mac) and `scripts/ops/grade-holdem-option.mjs` call the repository copy, and anything but exit 1, an unreadable inbox included, counts as busy. The SSD1 copy stays in place for wrappers that still read it.

## Worktree Registrations

A bare `git worktree prune` deletes the registration of every worktree whose folder is absent, and a worktree on an unmounted drive is absent in exactly that way. Never run it. Use:

```bash
node scripts/ops/safe-worktree-prune.mjs --repo /Users/smarter.poker/Documents/club-arena [--dry-run]
```

It takes a git worktree lock on each registration whose drive is not mounted, prunes, and unlocks exactly the ones it locked. git never prunes a locked worktree. `scripts/prune-stale-worktrees.sh` and `scripts/agent-tree-janitor.sh` call it; the law test fails if any script or hook runs the bare command.

### The Scheduled Janitor Runs Current Main (2026-11-26)

The launchd job `~/Library/LaunchAgents/com.smarterpoker.agent-tree-janitor.plist` (04:30 and 16:30 local) used to run `scripts/agent-tree-janitor.sh` from the shared clone's checked-out working tree, which was older than the safe pruner and still ran a bare prune, and the janitor ran each clone's own `prune-stale-worktrees.sh` (every one of them with a bare prune). Now:

- `agent-tree-janitor.sh` resolves `prune-stale-worktrees.sh` and `ops/safe-worktree-prune.mjs` beside itself, never from `$CLONE`, and `prune-stale-worktrees.sh` resolves the safe pruner beside itself. A missing helper means nothing is pruned (fail closed, logged).
- The job runs `~/bin/ca-tree-janitor-run`. It fetches `origin/main` in the shared clone (no checkout, no reset), extracts `scripts/agent-tree-janitor.sh`, `scripts/prune-stale-worktrees.sh` and `scripts/ops/` with `git archive` into `~/Library/Application Support/ca-janitor/<sha>/` (internal disk, so a dropped drive cannot take it), verifies them, and runs the extracted janitor once per clone. If anything is missing it runs nothing. Arguments are passed through (`--apply` from the job; none means report only).
- `~/bin/ca-tree-janitor` (the old fallback) now runs the same runner.
- Backups of the previous plist and crontab are in `~/Library/Application Support/ca-janitor/backups/`.

The user crontab line for `scripts/agent-recovery-janitor.sh` was removed: that script was retired on purpose in #4189 (`tests/unit/resetGuardCannotSaveTheWorktree.test.ts` requires it to stay retired), and every half-hour run only logged "No such file".

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
