# O21 Part 2: The Dispatcher Holds An Ordinary Migration 150 Minutes Before Each Cutover

## What Broke

A three-hourly engine candidate is certified on a copy of production. An ordinary
migration installed after that copy makes the candidate stale, and the cycle keeps
serving. With the dispatcher deferring only `[slot - 90m, slot + 10m)`, migrations
merged 94 to 133 minutes before a cycle installed after the copy and cost the cycle
on 2026-11-22 23:22Z, 2026-11-23 01:47Z and 02:17Z, and 2026-11-24 05:26Z.

Part 1 (#11947, migration `20261124162837`, installed) moved the install watch's SQL
helper to 150 minutes first, so no healthy file is paged before the dispatcher may
send it. Part 2 was a local commit that was never pushed; it is rebuilt here.

## What Changed

- `scripts/ci/merged-migration-dispatch.mjs`: `THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES`
  90 to 150, daytime wait budget 115 to 175, nightly-freeze wait budget 285 to 345.
- **A second defect found while doing it:** `threeHourlyDeferralWindow` looked only
  0 to 2 hours ahead for the next cycle. That fit 90 minutes; with 150 it would have
  deferred only about 120 minutes while every constant said 150. The look-ahead is now
  derived from the deferral (`ceil(150 / 60)` = offsets 0 to 3), as the SQL helper's
  `ARRAY[0, 1, 2, 3]` already does.
- `scripts/release/three-hourly-readiness.py`: same constant and the same look-ahead
  defect (`max_hours=3`), fixed the same way, so the readiness comment on #11599 no
  longer says OPEN during the first hour of a deferral.
- `.github/workflows/dispatch-merged-migrations.yml`: job timeout 300 to 360 minutes
  (a merge at 22:30 Chicago is released at 04:15, 345 minutes).

## Result

An ordinary Club Arena migration installs only in `[slot + 10m, slot + 30m)` after the
07, 10, 13, 16, 19 and 22 cycles, and 04:15-04:30: seven windows, 135 minutes a day.
`slot + 30m` is the next cycle's `- 150m`, so the windows never meet. Worst wait:
160 minutes daytime, 345 minutes for a late-evening merge. Outage installs keep their
override route.

## Hardening

- `tests/an-ordinary-migration-waits-for-the-three-hourly-engine-cutover.law.test.ts`
  derives every bound from the constant and now counts the admitted minutes of a whole
  CST and CDT day: exactly 135, in exactly those seven runs. This case fails on the
  fixed look-ahead (261 open minutes).
- `tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts` is
  tightened from "90 or 150" to equality with the SQL helper, and refuses 90.
- `tests/operations/three-hourly-readiness.test.py` moved to the 150-minute times,
  including spring-forward (04:30 CDT) and the copy-time advisory.
