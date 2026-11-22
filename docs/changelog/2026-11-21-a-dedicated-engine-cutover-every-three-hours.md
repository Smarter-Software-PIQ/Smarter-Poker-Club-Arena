# A Dedicated Engine Cutover Every Three Hours

November 21, 2026. Owner order (Dan, 02:22-02:23 America/Chicago, Claude session `session_01Gw7aDsC1z7GdpSYmDAM2kv`), verbatim:

> "CREATE A DEDICATED ENGINE CUT OFF SWITCH TO WORK DIRECTLY WITH THE PLO STRATEGY CHAT, HORSE ON OFF SWITCHES CHAT, ANTIGRAVITY COORDINATION CHAT AND THE HORSE DECISIONS CHAT."
>
> "YOU OWN THIS CODE BASE AND MAKE ANY AND ALL DECISIONS AND CHOICES ON HOW THIS IS DONE. LAUNCH A SWARM TO HELP WITH THIS. I WANT A ENGINE CUT OVER EVERY 3 HOURS."

## What Changed

The only automatic certified cutover was the daily 04:00 Chicago route; every other cutover of the November 20 three-hour cadence was a hand-booked owner window. The scheduled route itself now runs every three hours, at 01, 04, 07, 10, 13, 16, 19 and 22 Chicago, with exactly the same machinery.

- **Policy.** `server/src/maintenance/maintenanceSchedulePolicy.json` is a v2 policy (`engine-maintenance-schedule/v2`, `policyId three-hourly-01Gw7aDs`, `frequency`, `startHours`, the verbatim order). `maintenanceSchedule.ts` gains the `three-hourly` frequency; `daily` and `phase1-hourly` are intact, and `frequency: "daily"` reverts. Windows are computed over real epoch hours: the fall-back 01:00 is one cycle (the first), and nothing is invented at spring forward.
- **Engine.** `/health` `maintenance.schedule` carries `frequency: "three-hourly"` and `startHours`; `hourlyCashFreeze` stays false. A new gauge `poker_maintenance_scheduled_breaks_per_day` lets `EngineCannotBeReplaced` keep its meaning in time (>= 16 uncertified three-hourly breaks, 48 hours; >= 6 for any other engine).
- **Stage.** Crons cover each preparation hour in both offsets. The admission keys the reservation by cycle start (once per cycle, at most 100 minutes early, so a later cycle is never reserved early; 5 hours for the daily policy), refuses a non-anchor cycle unless the serving engine's `/health` is three-hourly, and runs the window-migration installer only for the 04:00 anchor.
- **Receiver.** `auto-deploy-hetzner.yml` admits the 30-50 minute preparation of any scheduled cycle the target's policy names (and, for a non-anchor cycle, that the serving engine breaks on), derives the cycle's selection cutoff, and after the release settles posts one comment on issue #11599 "Engine cutover log" (reporting only).
- **Host.** `engine-release-transaction.sh` reads the target's start hours once (`routine_start_hours`, `ROUTINE_START_HOURS`) and its cutover clock, admission predicates and next-break clock accept each cycle; every certificate still requires the serving engine's own durable break. `engine-release-seal.py` validates the v2 policy and defers a booked owner-window announcement until a full hour after the nearest cycle while the serving engine is three-hourly (never an `engine-degraded` one). `engine-release-activation-floor.py`, `select-daily-engine.py`, `read-engine-prequalification.py` and `prestage-engine-image.sh` accept each cycle's cutoff.
- **Client.** `src/utils/maintenanceSchedule.ts`, the maintenance banner and the late-registration countdown read the three-hourly schedule and keep reading `daily` and `phase1-hourly`.
- **Database.** Forward migration `20261121091106_freeze_marks_follow_every_three_hourly_engine_cycle.sql` makes `fn_ca_capture_freeze_mark` take its observation-only pre/post marks at every cycle: 04:00 unconditionally as before, any other cycle only when the engine's own durable break row announced it (so nothing changes while the engine is daily); crons `ca-freeze-mark-pre`/`-post` run at :00/:05 of every hour and the function decides.
- **Laws.** `tests/the-engine-cuts-over-every-three-hours.law.test.ts` pins the eight hours on every surface and both DST days; `tests/the-break-clocks-agree.law.test.ts` and the schedule unit tests move with it.

## What Did Not Change

Certification, drain, freeze, proof, rollback, seal, v3 thaw and post-seal Backup; the single receiver; no watcher, retry or repair job; no player announcement beyond the two-minute drain. Window migrations, the nightly release schema freeze (23:45-04:15), the Backup freeze baseline, the 03:00 readiness check and the 04:30 missed-cutover page stay at the 04:00 anchor; the break scorecard already grades every break that actually runs, and only its missing-break expectation stays at 04:00.

## How It Reaches Production

The serving engine adopts the schedule only when a release carrying it seals. Until then it breaks only at 04:00, and Stage and the receiver prepare only that anchor. The first scheduled route that can carry it is the next 04:00 Chicago cycle after the merge (or an owner window booked by the release custodian). From that seal the other seven cycles start by themselves.
