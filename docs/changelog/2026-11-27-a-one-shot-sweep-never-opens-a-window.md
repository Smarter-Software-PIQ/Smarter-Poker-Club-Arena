# A One-Shot Sweep Never Opens A Window; The Reclaim Keeps An Unknown Serving Image (2026-11-27)

Lane: release-custody. An independent review of the merge-window keeper and the Backup disk reclaim found the defects below. Each was checked against the code and the logs before it was changed.

## What Broke And Why

1. **A run started in a window's last minute wrote green and left.** `nextMergeWindow` rounded the clock up to the next whole minute before looking for an open one. At 1:26:31 PM `mergeWindowOpen` was true, yet the answer was the 4:10 PM window, so `keep()` logged "No merge window opens within 25 minutes; one sweep.", wrote its verdict and returned, and `pushAction` answered `sweep` from 1:26:00.001 to 1:26:59.999. Seen live: run 46056717952 at 1:26:57 PM CST on 2026-11-27 (its pull request had no migration, so nothing was left green that time).
2. **A hand dispatch with the default `mode=sweep` inside a window** painted every held pull request green with nobody to close it. The same was true of any one-shot pass whose writes crossed into a window, because each verdict is taken at its own write time.
3. **The closing write could miss a head pushed in the last 25 seconds.** The keeper reads `PREFETCH_LEAD_MS` before the close and writes on it. A branch pushed after that read, and turned green by its own pull request run, was not in the closing write.
4. **One pass was unbounded.** A refused write was retried after 2, 5 and 12 s, the publish loop had no deadline, the hard stop was read only between passes, and no `gh` call had a timeout. The 4:10 PM window of 2026-11-27 (run 46074283399) wrote 427 statuses, 215 at the open and 212 at the close, against GitHub's 500 content-creating requests an hour. A limit tripped in the closing pass would have cost about 19 s per remaining write and the 50-minute job timeout could have ended the run with pull requests still green.
5. **The close took 2 min 36 s** (4:27:00.75 to 4:29:36.40 PM), nearly all of the 3-minute in-flight margin.
6. **The reclaim removed the serving image when `/health` could not be read.** An empty serving sha protected nothing, so a serving image older than 24 h was removed by age and the rollback rehearsal rebuilt it, which is what #12219 set out to stop.
7. **A refused qualification-image removal ended the certification.** `docker image ls ... | while read -r tag; do [ -n "$tag" ] && docker image rm "$tag"; done` under `set -Eeuo pipefail` exits the script when the last listed image cannot be removed. Reproduced in isolation (exit 1, nothing after the loop ran).

## Root-Cause Fixes

- `nextMergeWindow` returns the current minute when the window is open, so `keep()` and `pushAction` hold an open window to its close.
- Every mode of `migration-merge-window.mjs` (`sweep`, `keep`, `on-push`, with or without `--pr`) goes through `keep()`. With no window open or within 25 minutes it is one sweep that stops writing before the next window opens (`ONE_SWEEP_BUDGET_MINUTES`), so it can never write "window open".
- After a clean closing write the keeper reads once more, at or after the close, and closes whatever that read still shows open. Only then is the window closed. This holds for the all-pull-request keeper and for a pull request's own run.
- `publish()` has a deadline (`PASS_BUDGET_MS`, cut shorter by the keeper's hard stop). A write GitHub refuses as rate-limited is not retried and ends the pass: the rest are marked `writeFailed` and `keep()` retries the close every 15 s up to its hard stop. Reads time out after 120 s and writes after 20 s.
- A draft is never opened: GitHub will not merge it. Its status is one failure text that names no time, so it is written once and never at a boundary. `ready_for_review` and `converted_to_draft` are now events of the workflow.
- `chicagoTime` says CDT in daylight time (label only).
- `reclaim_backup_disk` removes no engine image by age when the serving release is unknown. It still removes qualification images, dangling images, build cache and old folders, logs `serving release unknown, no engine image removed by age`, and the existing `backup_disk_low` floor refuses by name if space is short. With a known serving release the log line ends `kept serving <sha12>`.
- The qualification-image loop reads from a process substitution and logs and skips a refused removal.

## What The Review Had Wrong

The review expected most of the 427 writes to be pull requests whose verdict does not depend on the window. They are not: those are already skipped (`success (unchanged)`, their text is constant). The 4:27 PM close wrote 212 statuses for 212 pull requests that really are held: 189 with an ordinary migration and 23 with a release-control file. Of those, 58 are drafts, and 195 had no update in 7 days (140 in more than 30).

## Expected Write Counts

Measured on the 212 held pull requests of 4:27 PM on 2026-11-27: 58 drafts drop out, so about 154 writes at the open and 154 at the close (308 an hour, from 427), and a close of about 1 min 50 s at the measured 0.73 s per write. Ready, recently updated pull requests are still written first, so the ones being merged close in the first seconds.

## Deferred

Holding pull requests with no update in 7 days through a window would cut each boundary to about 17 writes. It is not in this change: `merge-window-watch.mjs` decides "held or missed" from the least recently updated pull requests turning green, so it has to be reworked in the same change or it goes blind or pages falsely.

## Law Changed In This Commit

`tests/the-backup-host-reclaims-its-disk.law.test.ts` pinned "still reclaims when serving is unknown". It now pins the opposite: no engine image is removed by age when serving is unknown. Its first case passes a serving sha, because age-based removal now needs one.

## Tests

- "a one-shot sweep never opens a window (2026-11-27)" in `tests/a-migration-merges-only-inside-its-install-window.law.test.ts`: 11 cases.
- `tests/the-backup-host-reclaims-its-disk.law.test.ts`: the unknown-serving case, the kept-image log line and a docker stub that refuses the last qualification image.

## Live Proof

Pending: the first window held by this code, and the first certify log that reads `kept serving`.
