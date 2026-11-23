# A Dedicated Engine Cutover Every Three Hours

Owner order, Dan, November 21, 2026 02:22-02:23 America/Chicago (Claude session `session_01Gw7aDsC1z7GdpSYmDAM2kv`), verbatim:

> "CREATE A DEDICATED ENGINE CUT OFF SWITCH TO WORK DIRECTLY WITH THE PLO STRATEGY CHAT, HORSE ON OFF SWITCHES CHAT, ANTIGRAVITY COORDINATION CHAT AND THE HORSE DECISIONS CHAT."
>
> "YOU OWN THIS CODE BASE AND MAKE ANY AND ALL DECISIONS AND CHOICES ON HOW THIS IS DONE. LAUNCH A SWARM TO HELP WITH THIS. I WANT A ENGINE CUT OVER EVERY 3 HOURS."

This is the task-specific owner instruction CLAUDE.md 10.85 requires for scheduled business work, and it turns the November 20 15:16 standing order (cutovers every three hours, until then hand-booked as owner windows) into the scheduled route itself.

## The Schedule

| Cycle (America/Chicago) | Preparation opens | Last-hand drain | Break       |
| ----------------------- | ----------------- | --------------- | ----------- |
| 01:00                   | 00:30             | 00:58           | 01:00-01:05 |
| 04:00 (anchor)          | 03:30             | 03:58           | 04:00-04:05 |
| 07:00                   | 06:30             | 06:58           | 07:00-07:05 |
| 10:00                   | 09:30             | 09:58           | 10:00-10:05 |
| 13:00                   | 12:30             | 12:58           | 13:00-13:05 |
| 16:00                   | 15:30             | 15:58           | 16:00-16:05 |
| 19:00                   | 18:30             | 18:58           | 19:00-19:05 |
| 22:00                   | 21:30             | 21:58           | 22:00-22:05 |

- Selected by `server/src/maintenance/maintenanceSchedulePolicy.json` (`frequency: "three-hourly"`, `startHours`). Setting `frequency` to `"daily"` restores the 04:00-only route with one field. The engine publishes `maintenance.schedule.frequency = "three-hourly"` and `startHours` on `/health`.
- Every cycle behaves exactly like the 04:00 break: the engine's own two-minute last-hand drain, the five-minute global break, park and v3 thaw. `hourlyCashFreeze` stays false. There is no player announcement beyond that drain (standing November 17 order, `scripts/ci/owner-notice-waiver.mjs`).
- Real IANA epoch hours. Fall-back day: 01:00 happens twice; it is ONE cycle, the first (CDT). Spring-forward day: 02:00 does not exist; 01:00 and 04:00 both happen, two real hours apart. Pinned by `tests/the-engine-cuts-over-every-three-hours.law.test.ts`.
- One certified cutover per cycle through the existing single route: `stage-engine-release.yml` reserves the cycle (at most 100 minutes early, so a run can never reserve a later cycle) and prepares protected main once at slot minus 30 minutes; `auto-deploy-hetzner.yml` is the single receiver; `server/scripts/engine-release-transaction.sh` drains, freezes, proves, seals or rolls back, and thaws. No second publisher, watcher, retry loop or repair job (CLAUDE.md 10.12).
- A missing or failed Backup certificate leaves the current engine running for that cycle. The next cycle tries again with whatever is certified then. Nothing is dispatched twice.
- Until a release carrying this schedule seals, the serving engine still breaks only at 04:00, so Stage and the receiver prepare ONLY the 04:00 anchor (they read `/health` and refuse every other cycle). The first sealed release that carries the three-hourly schedule turns on the other seven cycles by itself.

## What Stays Daily (04:00 Only)

- Window migrations (`-- @install-window: daily-maintenance`, `scripts/ci/maintenance-window-migrations.mjs` 03:55-04:05) install only in the 04:00 break. Stage runs the window installer only for the 04:00 preparation.
- The nightly release schema freeze (23:45-04:15 Chicago, `scripts/ci/merged-migration-dispatch.mjs`), the Backup freeze baseline (`scripts/ci/backup-freeze-baseline.py`), the 03:00 readiness check (`fn_ca_cutover_readiness_watch`) and the 04:30 missed-cutover page (`fn_ca_engine_cutover_watch`) judge the 04:00 anchor only. Daytime cycles use ordinary push certification: the newest certified protected main whose Backup copy equals production.
- **Automatic per-cycle pre-cutoff migration deferral (Optimization O3):** while the serving engine reports `maintenance.schedule.frequency = "three-hourly"` on `/health`, `.github/scripts/dispatch-merged-migrations.sh` passes `--schedule three-hourly` to `scripts/ci/merged-migration-dispatch.mjs`, which automatically defers ordinary merged migrations landing inside `[cycleStart - 90m, cycleStart + 10m)` for any non-04:00 three-hourly cycle until `cycleStart + 10m` Chicago (`07:10`, `10:10`, `13:10`, `16:10`, `19:10`, `22:10`, and `01:10` / nightly freeze to `04:15`, all strictly `:10` UTC outside the `:50-:03` DDL refusal window) in the merge's own single bounded dispatcher wait (at most 100 minutes daytime, budget 115 minutes inside the unchanged 300-minute workflow timeout; zero crons, watchers or retry loops). This eliminates manual cross-chat migration-merge holds before daytime cycles. Window migrations (`-- @install-window: daily-maintenance`) stay on the 04:00 anchor unchanged; an unreadable `/health` falls back cleanly to daily + `:50-:03` behavior (CLAUDE.md 10.86) and never drops a migration. Pinned by `tests/an-ordinary-migration-waits-for-the-three-hourly-engine-cutover.law.test.ts`.
- Break scorecard (`fn_ca_record_break_scorecard`, updated in migration `20261122002835_three_hourly_break_scorecard_and_weekly_report.sql`): grades every cycle that actually ran via `engine_maintenance_break_log`, and in the `break_never_started` fallback detects three-hourly cadence from recent break-log history (any scheduled non-04 Chicago slot in `{1, 7, 10, 13, 16, 19, 22}` within the last 24h) to check expected `:05` ends across all eight slots (excluding the repeated 01:00 CST hour on fall-back day), falling back to the 04:05 anchor when daily. The ad-hoc `service_role` helper `fn_maintenance_week_report` (updated in the same migration, not scheduled by cron) reports `observed_cadence` (`three-hourly` vs `daily`), `expected_breaks_per_day` (`8` vs `1`), `:00-:04` Chicago dealing buckets, and cadence-aware `breaks_without_thaw_note`.
- The 04:00-06:00 games-closed daily window (`server/src/maintenance/dailyWindow.ts`) and the lobby day start are unrelated to the engine break and unchanged.
- Pre-deploy web clients already open in a browser treat `maintenance.schedule.frequency = "three-hourly"` as `"unknown"` until refreshed (`src/utils/maintenanceSchedule.ts`), which suppresses only predictive pre-break copy while active engine break banners continue to render normally.

## Coexistence With Booked Owner Windows

`scripts/release/book-owner-engine-window.py` and the owner-window playbook still work. A booked window and a scheduled cycle can never break within the same rolling hour: the seal's recovery reservation (`scheduled_cycle_spacing` in `server/scripts/engine-release-seal.py`) defers an owner-window announcement until one hour after the nearest cycle while the serving engine is three-hourly. A dead or wedged engine (`engine-degraded`) is never held.

## The Contract With The Four Lanes

For the PLO Strategy, Horse On/Off Switches, Antigravity Coordinator and Horse Decisions chats:

1. **Your engine work rides the next cycle** when, before that cycle's preparation opens (cycle minus 30 minutes), it is merged to protected main with green required checks and every migration it needs is installed in production, and Backup certifies the resulting commit. Merging later rides the cycle after. Nobody books, dispatches or pauses anything to catch a cycle.
2. **Horse option switches flip live** through `fn_ca_horse_option_switch_set` with evidence; no release is needed. Do not write a switch between a cycle's preparation opening (minus 30 minutes) and its SEALED result (about plus 10 minutes): a switch row the candidate does not accept makes every Horse option run at its release default (the fleet-reset trap, `server/scripts/engine-release-switch-rows.py`).
3. **A new option** needs its generated whitelist migration merged and installed before the preparation of the cycle that should carry it.
4. **What shipped** is posted after every cycle, sealed or refused, as one comment on issue #11599 "Engine cutover log" (cycle time, sealed SHA, PRs included since the previous seal, or the refusal reason). It is written by the receiver with the job token and is reporting only.
5. No lane edits release controls (`server/release/**`, `server/scripts/engine-release-*`, `server/src/maintenance/**`, the release workflows) while a booked owner window is open.

## Checking Readiness Before Any Cycle

Any of the four lanes (PLO Strategy, Horse On/Off Switches, Antigravity Coordinator, Horse Decisions) or the Dedicated Engine Cutover owner can inspect the next scheduled cycle with one read-only command:

```bash
python3 -B scripts/release/three-hourly-readiness.py
```

Options: `--json` (machine-readable payload), `--limit N` (default `10` first-parent commits displayed on `refs/remotes/origin/main` since the serving SHA, automatically extending up to `60` commits when none of the first `10` is `SELECTABLE` while skipping local `CONTROL_INPUTS`-mismatched commits with zero extra API calls; an explicit `--limit N` caps the walk at `N`, O19), `--repo owner/name` (default `Smarter-Software-PIQ/Smarter-Poker-Club-Arena`), `--repo-dir <path>` (optional path to a local git checkout when invoking the CLI from outside the repository; falls back to the script's repository root if `.git` exists, else current working directory, else fails closed to `UNKNOWN` with exit `3`).

The `selection` job in `.github/workflows/stage-engine-release.yml` also appends a strictly read-only, non-blocking Markdown summary to `$GITHUB_STEP_SUMMARY` with the `daily-selection.json` outcome, serving/target SHAs, deferred candidate reasons/details, and the `three-hourly-readiness.py` one-line verdict so all four lanes see selection readiness directly in the GitHub Actions UI.

What it reports without mutating git, dispatching workflows, or touching credentials:

- Live `https://engine.smarter.poker/health` serving `releaseSha`, `frequency`, `startHours`, `phase`, and `stalledTables`.
- Next DST-aware `America/Chicago` cycle start, preparation cutoff (`start - 30m`, UTC and Chicago), per-cycle O3 deferral / nightly freeze bounds (`o3DeferStart`, `o3Clear`), and recommended combined migration + release-control hold start (`cutoff - 75m`).
- `NEXT OPEN CYCLE`: the first scheduled cycle whose preparation cutoff is still in the future (equals the next scheduled cycle before `:30`, and automatically advances to the following cycle once the current cycle's cutoff has passed).
- `MIGRATION GATE`: deterministic `NIGHTLY_FREEZE` (`23:45-04:15` Chicago), `O3_DEFERRAL` (`[cycleStart - 90m, cycleStart + 10m)` on three-hourly cadence), or `OPEN` status matching `scripts/ci/merged-migration-dispatch.mjs`, with exact clear time or next deferral start. When the gate is `OPEN` and an active non-post-seal Backup run or selectable certified copy already started before `o3DeferStart`, `copyHold` (`migrationHoldAdvisory`) flags an immediate migration hold from that Backup copy time using already-fetched data and zero extra API calls (O19).
- Active `stage-engine-release.yml` reservation run and active `backup-engine.yml` runs on `main`, each shown with its status and triggering event (`push`, `schedule`, `repository_dispatch`, `workflow_dispatch`) so a late-delivered schedule run or a post-seal Backup is told apart from a push run (O14), plus closed-cycle `stage-engine-release.yml` completion visibility (`closedCycleStageRun`, reused from the existing workflow runs fetch with zero extra API calls when the cutoff has passed and no Stage run is active).
- Recent first-parent commits on `refs/remotes/origin/main` since the serving SHA with `backup-engine/certified` state, latest `engine-release-prequalification.yml` status and run ID, `CONTROL_INPUTS` projection equality vs `origin/main` (via `scripts/ci/read-engine-prequalification.py`, which keeps `server/scripts` fail-closed while excluding pure unit/law tests under O4 and verified unreferenced offline HUD/horse/benchmark/probe/generator scripts under O9), and per-candidate `SELECTABLE`, `PENDING`, or `DISQUALIFIED` classification with an exact single-line reason. A `pending` certificate whose owning Backup run is already completed in the same recent-runs read (an O1 mid-soak yield, a stand-down or a cancellation, none of which writes a verdict) is shown as `pending (#<run> ended)`, its reason says it needs a new Backup run, and it no longer counts as in flight (O14); an active Backup run on the same SHA, or an owning run outside that read, keeps the plain `pending` reading.
- Top-level verdict: `READY`, `IN_FLIGHT`, `NO_CANDIDATE` (exit `0`), or `UNKNOWN` (exit `3`) whenever any live health, git, or GitHub API read is unavailable (CLAUDE.md 10.86).

## Rolling Back The Cadence

Set `frequency` to `"daily"` in `server/src/maintenance/maintenanceSchedulePolicy.json`, merge, and let the next 04:00 release seal; the engine then breaks only at 04:00 again, and every cycle-aware surface follows the serving schedule.
