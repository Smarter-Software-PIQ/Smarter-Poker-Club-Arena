# The merge window opens on time (2026-11-27)

Lane: release-custody.

## What happened

At 04:15 Chicago on 2026-11-27 the required status "Migration merge window"
for PR #12191 (head `c506c56d78d0`) still read failure at 04:15:07, 04:15:48,
04:16:29 and 04:17:10. It turned success at 04:18:15.

The keeper was not missing. OpenClaw dispatched `mode=keep` at 04:04:01
(run 45978922451); it found the 04:15-04:27 window and swept every minute. At
04:15:02 its pass found 217 pull requests whose verdict had changed and wrote
them one at a time, about 0.86 seconds per write, in ascending pull request
order: #2303 at 04:15:12, #12191 at 04:18:15, the last at 04:18:18. The
manual sweep dispatched at 04:18:04 (run 45980926549) then cancelled this
keeper at 04:18:19, because both sat in the same `workflow_dispatch`
concurrency group.

Two more defects made it worse:

- A pass took every verdict with the clock it started on. The push keeper
  (run 45979992033) began a cold 3.5-minute read at 04:11:40 and wrote
  "failure (unchanged)" for #12191 at 04:15:14, after the window had opened.
- Push keepers ran beside the dispatch keeper (both wrote the same statuses
  from 04:15:44 to 04:16:19) and each new push cancelled the one before it,
  so each replacement started over with a cold read.

## The fix

`scripts/ci/migration-merge-window.mjs`:

- `publish()` writes in `publishOrder`: ready before draft, most recently
  updated first. GitHub allows about 80 status writes a minute, so writing
  faster cannot flip 217 statuses in a second; the order puts the pull
  requests people are merging in the first seconds.
- Each verdict is taken at its own write time, so a pass that crosses a
  boundary writes the new answer.
- The keeper reads `PREFETCH_LEAD_MS` (25 s) before each minute and writes on
  the minute, so the read no longer sits between 04:15:00 and the first write.

`.github/workflows/migration-merge-window.yml`: push, schedule and dispatch
runs share one `keeper` concurrency group that is never cancelled; a later run
waits behind the running keeper. Pull request events keep their own group.

Which minutes are open is unchanged. The OpenClaw job is unchanged.

Pinned by `tests/a-migration-merges-only-inside-its-install-window.law.test.ts`
("the window opens on time").
