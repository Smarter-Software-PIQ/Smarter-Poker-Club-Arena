# Automatic per-cycle pre-cutoff migration deferral for three-hourly cutovers (Optimization O3)

## Context

On the three-hourly engine cutover cadence (`01, 04, 07, 10, 13, 16, 19, 22`
America/Chicago), installing an ordinary migration between a Backup DB refresh
and a cycle's `:30` preparation cutoff breaks the `Backup copy migrations ==
production installed migrations` equality check and strands that cycle's
Backup certificate. Previously, all four lanes had to coordinate manual
cross-chat migration-merge holds before daytime cycles (`17:15-19:10`,
`20:15-22:10`), while only the 04:00 anchor had automatic deferral via
`RELEASE_SCHEMA_FREEZE_CHICAGO` (`23:45-04:15` Chicago).

## Change

1. **Pure planner (`scripts/ci/merged-migration-dispatch.mjs`):**
   - Preserves `RELEASE_SCHEMA_FREEZE_CHICAGO` (`23:45-04:15`) and
     `DAILY_GUARD_CHICAGO` (`03:50-04:10`) unchanged for `daily` and
     omitted/unknown schedules.
   - Adds optional `schedule` support to `admissibleAt`, `earliestDispatch`,
     `planDispatch`, and the CLI (`--schedule <freq>`), with zero network calls
     in the JS module.
   - Exports `THREE_HOURLY_START_HOURS = [1, 4, 7, 10, 13, 16, 19, 22]`,
     `THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES = 90`,
     `THREE_HOURLY_POST_SEAL_CLEAR_MINUTE = 10`,
     `THREE_HOURLY_DEFER_WAIT_BUDGET_MINUTES = 115`, `isThreeHourlySchedule`,
     `threeHourlyDeferralWindow`, and `inThreeHourlyCutoverDeferral`.
   - When `frequency === 'three-hourly'`, any ordinary migration merged inside
     `[cycleStart - 90m, cycleStart + 10m)` for a non-04:00 three-hourly cycle
     (DST-aware, first fall-back `01:00` only) is deferred inside the merge's
     own single bounded wait until `cycleStart + 10m` Chicago (`:10` UTC,
     outside the `:50-:03` DDL refusal window). Inside `23:45-04:15` the full
     nightly release schema freeze to `04:15` stays in force.
2. **Dispatcher shell (`.github/scripts/dispatch-merged-migrations.sh`):**
   - When a merged PR touches `supabase/migrations/`, reads
     `https://engine.smarter.poker/health` (read-only `curl -fsS --max-time 10`)
     for `.maintenance.schedule.frequency` and passes `--schedule` to both the
     `plan` and post-sleep `admitted` planner calls.
   - Follows CLAUDE.md 10.86: an unreadable or unrecognised `/health` response
     logs `COULD NOT TELL` and falls back cleanly to `daily` + `:50-:03`
     behavior without blocking or dropping a migration.
   - Logs and comments clearly when deferring:
     `Deferring ordinary migration install until <cycleStart+10m> Chicago to protect the <cycle> 3-hourly Backup certificate`.
   - Window migrations (`-- @install-window: daily-maintenance`) stay on the
     04:00 anchor unchanged.
3. **Workflow & Docs:**
   - Verified `.github/workflows/dispatch-merged-migrations.yml` `timeout-minutes: 300`
     covers both the 100-minute daytime deferral (115m budget) and the
     270-285-minute nightly freeze (285m budget), with zero crons, watchers, or
     retry loops.
   - Documented automatic per-cycle deferral in
     `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` and `docs/ENGINE-RELEASE-RUNBOOK.md`.

## Verification

Pinned by `tests/an-ordinary-migration-waits-for-the-three-hourly-engine-cutover.law.test.ts`
alongside all existing merged-migration, nightly-freeze, break-clock, and
runbook-citation laws.
