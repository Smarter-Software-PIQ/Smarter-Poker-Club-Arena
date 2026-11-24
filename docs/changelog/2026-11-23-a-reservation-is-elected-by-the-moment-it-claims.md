# 2026-11-23 - A reservation is elected by the moment it claims

## What happened at 01:00 Chicago

The 01:00 America/Chicago three-hourly engine cycle of November 23 (07:00 UTC)
was never prepared. No Stage run bound protected source at the 00:30 cutoff,
nothing was offered to the receiver, and the engine kept serving release
`735299cd` (the 19:00 release) straight through the 01:00 break. Two merged
changes waiting for that cutover missed it: Phase 1 private-game holds and the
Phase 4 waiting-list engine parts.

Run record (`stage-engine-release.yml`, job "Prove Whether The Server Tree
Changed", step `admission`):

| run         | event | pushed_at            | created_at           | said                                                   |
| ----------- | ----- | -------------------- | -------------------- | ------------------------------------------------------ |
| 45114163784 | push  | 2026-11-23T04:49:59Z | 2026-11-23T04:50:01Z | "Routine engine updates are queued ..."                |
| 45121321101 | push  |                      | 2026-11-23T06:00:51Z | "belongs to earlier run 45114163784; prepares nothing" |
| 45123768860 | push  |                      | 2026-11-23T06:23:25Z | "belongs to earlier run 45114163784; prepares nothing" |

Under the three-hourly policy the 01:00 cycle's preparation is 06:30-06:50 UTC
and its reservation opens 100 minutes earlier, at 04:50:00 UTC
(epoch 1795409400). Run 45114163784's push time, 1795409399, is one second
before that.

## Cause

The admission step judged a run's own eligibility and the election that other
runs apply to it with two different clocks:

- the run's own claim used `moment="${PUSHED_AT:-}"` for a push
  (`github.event.repository.pushed_at`), and the run's `created_at` for every
  other event;
- the election lists this workflow's runs with
  `created=<reservation>..<end>` and counts every earlier eligible run whose
  `created_at` is in that range as the owner. It cannot see another run's push
  time.

Run 45114163784 was pushed one second before the reservation opened and created
two seconds after it. By its push time it had no window, so it claimed nothing.
By its creation time it was the first run in the window, so every later run
deferred to it. Any push made before an opening whose run is created after it
(GitHub's event-to-run lag, two seconds here) stranded the cycle the same way.

## Fix

`.github/workflows/stage-engine-release.yml`, step `admission`: a push is now
judged by its run's own `created_at`, read the same way as for schedule,
workflow_run and operator runs (`gh api repos/$REPO/actions/runs/$RUN_ID --jq
.created_at`). The `PUSHED_AT` env entry is removed; nothing else read it.

So the claim and the election use one clock and one interval, and a run the
election counts is a run that claims. Nothing else changed: cycle hours, the
100-minute (three-hourly) and five-hour (daily) lookback, the 20-minute window,
once per cycle, the release-controls ownership rule, the serving-schedule check,
the cutoff wait and source binding, and everything about certification, drain,
freeze, seal and thaw.

**The delayed-event protection still holds, and is stricter.** A run is created
after its push, never before, so `created_at >= pushed_at`. A run created at or
after a window's end finds no window and claims nothing. Under the old clock a
push stamped 06:49:59 whose run was created at 06:50:00 would still have
claimed the expired cycle (the test below shows it). The only runs the new
clock admits that the old one did not are runs created inside the window whose
push came just before it, which the election already counted as owners.

**An unreadable own creation time is said out loud.** The read now prints
`DAILY PREPARATION UNKNOWN::Could not read this run's own creation time; this
run prepares nothing.` instead of folding into the ordinary "queued" line
(CLAUDE.md 10.86). A push did not depend on this read before; it does now, like
every other event.

## Why it broke

The 2026-11-01 change ("daily preparation does not wait for a punctual cron")
introduced the election by `created_at` and gave each event "its own instant":
`created_at` for a schedule run and `pushed_at` for a push. The two agree
except for the few seconds between a push and its run, so the gap only bites
when a push lands in the seconds before a reservation opens. The daily policy
had one opening a day, at 22:30 Chicago; the three-hourly policy (2026-11-21)
has eight, around the clock, so the same edge is crossed eight times as often.

## How it is pinned

`tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`
executes the real admission step and now carries the incident as written:

- run 45114163784 (pushed 1795409399, created 04:50:01Z) owns and prepares the
  `2026-11-23T01` cycle, cutoff 06:30Z, lookback 6000 s;
- runs 45121321101 and 45123768860 defer to it by name;
- a run created at 06:50:00Z, 06:50:01Z or 07:20:00Z claims nothing even with
  an in-window push time;
- for runs created at 04:49:59, 04:50:00, 04:50:01, 06:49:59 and 06:50:00
  (each pushed two seconds earlier), the run claims exactly when a later run in
  the window defers to it;
- a push whose own creation time cannot be read prints UNKNOWN and prepares
  nothing.

Against the previous workflow (origin/main `c12c2539d`) four of those five
cases fail; the "later runs defer" case passes on both clocks by design. The
`PUSHED_AT` env pin is moved in the same commit to require that no admission
code reads the push time.

Harness changes in the same commit, each because a push now reads its run's
`created_at`: the existing push cases in that law file pass `createdAt`;
`tests/daily-engine-maintenance.law.test.ts` gives a push case a daytime
`created_at` (its push cases set only the runner hour, which the admission
never reads, and passed before only because a push had no moment at all);
`tests/operations/engine-release-recovery-window.py` stubs `gh` with a
daytime push run instead of an empty `PUSHED_AT`.

## Not covered here

The election still counts an earlier eligible run as owner whatever that run's
own outcome was. If an owner run's own reads fail (its creation time, or the
run list), it prepares nothing and later runs still defer to it. That is the
existing once-per-cycle rule, not changed here.
