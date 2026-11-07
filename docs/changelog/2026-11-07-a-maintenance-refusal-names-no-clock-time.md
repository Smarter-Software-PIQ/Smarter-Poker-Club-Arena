# 2026-11-07 - A Maintenance Refusal Names No Clock Time

Dan, 13:21 Chicago: "I JUST TRIED TO JOIN NO LIMIT AND PLO LIGHTNING, AND FAILED TO JOIN BOTH... GET TO THE ROOT CAUSE OF THE ISSUE AND FIX IT."

## What happened

Every attempt (edge log 19:20:07 to 19:21:01 UTC, eleven `POST /rpc/fn_lightning_rejoin_seated` returning 400 from his iPhone) was refused by the freeze guard: Postgres logged `PLATFORM_FROZEN` at the exact instant of each 400. `engine_maintenance_thaws` holds the window: announced 19:14:37, frozen 19:16:37, release target 19:21:37 UTC, contract 3, engine 40bc2467. That was the owner-ordered Horse fold provenance worker cutover booked in `server/release/owner-maintenance-windows.json` (`2026-11-07-horse-fold-provenance-engine-1800z`, "GET THIS DONE NOW, NOT AT 4AM", #9903). The Lightning door raises `PLATFORM_FROZEN` before it reads anything, so nothing was held or debited.

The freeze was correct and ended at 19:21:37. Lightning pool entries resumed at 19:21, 19:24 and 19:27, and `fn_platform_frozen()` read false at 19:26.

## The defect

The player line for that refusal said: "The Platform Is On Its Scheduled Maintenance Break ... Please Try Again When Play Resumes At The Top Of The Hour." Cash games stopped freezing hourly when engine 40bc2467 went live; a freeze now comes from the daily 04:00 window, a certified cutover or a recovery window, at any minute. So an unscheduled one-minute wait read as a broken join with a forty-minute retry time.

## Fix

`src/utils/platformFrozen.ts`: `PLATFORM_FROZEN_MESSAGE` is now "The Platform Is On A Short Maintenance Break. Nothing Is Lost. Please Try Again In A Few Minutes." Every surface that maps the freeze (Lightning and cash joins through `JOIN_GAME_REFUSALS`, `safeErrorMessage`, cashier, buy-in, add-on, tournaments) uses this one constant. Law test `tests/a-maintenance-refusal-names-no-clock-time.law.test.ts` refuses a clock time or "scheduled" in the line and proves the rejoin door's exact refusal maps to it.
