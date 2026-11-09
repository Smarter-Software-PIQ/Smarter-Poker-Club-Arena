# A missed 4 AM engine cutover, and a lobby close that keeps failing, page the owner

2026-11-09. Migration `20261109024836`. Owner request, 2026-11-08.

## What went wrong on November 8

- Production kept serving `391f7bc0` through the 04:00 Chicago window although
  main already held a newer engine. GitHub delivered the scheduled Stage run
  six hours late, so nothing was prepared, and nothing told anyone.
- The 3 AM Spin and Sit & Go lobby close failed 108 times between 03:00 and
  05:05 Chicago (first the shared-trigger `late_reg_levels` defect, then
  `CANCELLATION_GLOBAL_LANE_BUSY`). Every failure was a quiet warning.
- The root of the second: on November 7 `fn_guard_managed_game_lifecycle()`,
  shared by `tournaments` and `tables`, read `late_reg_levels` in the same
  condition as its `TG_TABLE_NAME` test and broke every `tables` update.

## What changed

- **Missed-cutover alarm.** `fn_ca_engine_cutover_watch()` runs in the
  database every 5 minutes (pg_cron), so it does not wait on any GitHub event.
  From 04:30 Chicago (DST-aware) it reads the serving build from
  `engine.smarter.poker/health` (checked against `engine_leader`) and the
  newest engine-runtime commit on main before 03:30 from GitHub's public API.
  If production does not contain it, one critical `EngineCutoverMissed` alert
  names the build still serving, the build owed, and the reason: the
  receiver's own receipt in `engine_deploy_exit_paths` (refused at a stage, or
  failed), otherwise whether that date's `daily-engine-selection` artifact
  exists ("refused selection") or not ("no preparation run"). It pages the
  owner through the existing route (new page kind `releases`) and resolves
  itself when production holds the owed build. A day it cannot read is
  "unknown" and raises nothing.
- **Lobby close paging.** `fn_ca_daily_window_lobby_close_page()` raises one
  critical `DailyWindowLobbyCloseKeepsFailing` (page kind `daily_window`) when
  the lobby close has been failing for 15 minutes or more, and resolves after
  10 quiet minutes.
- **Digest line.** `fn_sp_daily_digest` returns `engine_cutover`: the live
  build, since its sealed release, and whether the next morning's 04:00
  cutover sealed, was missed, or was not owed. The World Hub digest prints it
  in Platform Health.
- **Shared-trigger law.**
  `tests/a-shared-trigger-reads-only-fields-its-table-has.law.test.ts` fails
  when a trigger function attached to more than one table reads a NEW/OLD
  field only some of them have outside a branch that already tested the
  relation. It catches the November 7 body and passes all 155 shared trigger
  functions on production today.

## Proof

`scripts/ci/test-a-missed-engine-cutover-is-paged.py` (native PostgreSQL 17,
19 behaviours): fires at 04:30 in CST and CDT and not at 04:25; quiet when
nothing was owed and when the cutover sealed; names each reason; one page, not
one every five minutes; closes when the owed build is held; unreadable sources
raise nothing; the lobby close pages at 15 minutes and not at 14, once, and
resolves; the digest line.
