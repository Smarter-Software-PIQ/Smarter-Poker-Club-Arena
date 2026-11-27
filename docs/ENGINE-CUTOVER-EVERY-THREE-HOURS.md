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
- The cycle belongs to the first eligible Stage run in its window that actually claims it (O25, 2026-11-24). A run that claims holds its job open until the cutoff, so an earlier run that finished green before the cutoff claimed nothing (its own reads failed, or it deferred) and is passed over; the next eligible run in the window owns the cycle. A run still going, a failed, cancelled or replayed run, and any record that cannot be read keep the cycle as before, so there are never two owners. A run tries its own creation time and the serving schedule three times at once before it gives the cycle up. Pinned by `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`.
- The completion of the post-seal Backup (`Backup after seal <run>-<attempt>`, started by the receiver after every seal) is an election trigger like the completion of a push Backup: first attempt, on main, under the same Stage run title `Automatic Backup daily reservation` (O25, 2026-11-24). Until O32 (2026-11-26) the Backup also had to have succeeded; since O32 one that failed or timed out elects the same way, because the election needs an event and not a certificate. It lands inside the next cycle's election window, so that cycle gets a reservation run even when no push or schedule event arrives. No trigger is added. Correction (O27b, 2026-11-26): the receiver starts that Backup with the job token, and GitHub creates no `workflow_run` event for a run the job token started, so this completion has not created a Stage run since O25 merged (for example Backup runs 45522710215, 45544078518 and 45565107439 on 2026-11-25 were followed by no Stage `workflow_run` run). The clause admits the completion only when GitHub delivers it; every cycle owner so far came from a push or a delivered schedule. Since 2026-11-27 the receiver sends that dispatch as the estate GitHub App `smarter-poker-autopilot[bot]`, whose runs do raise `workflow_run`, so the completion is delivered (section "The Estate App Starts The Next Cycle" below); it elects when it lands inside the next window, which a run that found nothing to certify does not.
- A missing or failed Backup certificate leaves the current engine running for that cycle. The next cycle tries again with whatever is certified then. Nothing is dispatched twice.
- Until a release carrying this schedule seals, the serving engine still breaks only at 04:00, so Stage and the receiver prepare ONLY the 04:00 anchor (they read `/health` and refuse every other cycle). The first sealed release that carries the three-hourly schedule turns on the other seven cycles by itself.

### The Post-Seal Backup Certifies The Next Candidate

Since 2026-11-24 (O24) the `Backup after seal <run>-<attempt>` run that the
receiver starts after every seal no longer re-certifies the build that just
sealed. After the same custody proof it certifies the next candidate: the
newest first-parent commit of its own commit touching `server/` or a
`CONTROL_INPUTS` path, when that commit is ahead of the sealed SHA, on a fresh
copy, with the rollback rehearsed against the sealed SHA. Before the copy it
waits at most 25 minutes, inside the existing `due` read, for migrations merged
in the last day to install; if one is still uninstalled it hands the host back
and writes no status. When nothing is ahead of the sealed SHA the run ends in
seconds without taking the host. This gives each cycle a first certification
that starts minutes after the previous seal and leaves time for a second
attempt. The export step also repeats itself once, after a fixed 45 second
pause, when production's schema evidence moved during the export.

## What Stays Daily (04:00 Only)

- Window migrations (`-- @install-window: daily-maintenance`, `scripts/ci/maintenance-window-migrations.mjs` 03:55-04:05) install only in the 04:00 break. Stage runs the window installer only for the 04:00 preparation.
- The nightly release schema freeze (23:45-04:15 Chicago, `scripts/ci/merged-migration-dispatch.mjs`), the Backup freeze baseline (`scripts/ci/backup-freeze-baseline.py`), the 03:00 readiness check (`fn_ca_cutover_readiness_watch`) and the 04:30 missed-cutover page (`fn_ca_engine_cutover_watch`) judge the 04:00 anchor only. Daytime cycles use ordinary push certification: the newest certified protected main whose Backup copy equals production.
- **Automatic per-cycle pre-cutoff migration deferral (Optimization O3):** while the serving engine reports `maintenance.schedule.frequency = "three-hourly"` on `/health`, `.github/scripts/dispatch-merged-migrations.sh` passes `--schedule three-hourly` to `scripts/ci/merged-migration-dispatch.mjs`, which automatically defers ordinary merged migrations landing inside `[cycleStart - 150m, cycleStart + 10m)` (150 minutes since 2026-11-25, O21; 90 before) for any non-04:00 three-hourly cycle until `cycleStart + 10m` Chicago (`07:10`, `10:10`, `13:10`, `16:10`, `19:10`, `22:10`, and `01:10` / nightly freeze to `04:15`, all strictly `:10` UTC outside the `:50-:03` DDL refusal window) in the merge's own single bounded dispatcher wait (at most 160 minutes daytime, budget 175 minutes; a merge from 22:30 Chicago waits for the nightly freeze to clear at 04:15, at most 345 minutes, inside the 360-minute workflow timeout; an ordinary file therefore installs only in `[cycleStart + 10m, cycleStart + 30m)` and 04:15-04:30, seven windows and 135 minutes a day, so a certified Backup copy cannot go stale between cycles; zero crons, watchers or retry loops). This eliminates manual cross-chat migration-merge holds before daytime cycles. Window migrations (`-- @install-window: daily-maintenance`) stay on the 04:00 anchor unchanged; an unreadable `/health` falls back cleanly to daily + `:50-:03` behavior (CLAUDE.md 10.86) and never drops a migration. Pinned by `tests/an-ordinary-migration-waits-for-the-three-hourly-engine-cutover.law.test.ts`.
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

## The Custodian Checklist (Learned 2026-11-26)

Every rule below cost at least one cutover on 2026-11-26 (01:00, 10:00 and 13:00 CST kept serving). The release custodian follows it every cycle; the other lanes follow rules 1 and 2.

1. **No `CONTROL_INPUTS` merge outside the merge window.** Since 2026-11-26 this is enforced: the required status `Migration merge window` fails a pull request that changes a projected file except 10 to 27 minutes after a cycle and 04:15 to 04:27 CST (`scripts/ci/release-control-paths.mjs`, law `tests/a-release-control-change-merges-only-after-a-cycle.law.test.ts`). When no selectable certificate exists for any commit and the change cannot wait, use the label `migration-outage-override` with an `Outage override:` line of at least 20 characters. A merge that touches the projection (`scripts/ci/read-engine-prequalification.py` `CONTROL_INPUTS`, minus the O9 and O31 exclusions) makes every existing certificate unselectable, and a new one takes about an hour. Batch release-control changes into one merge at the start of a post-seal slot. On 2026-11-26 an O27 merge at 22:50 CST stranded the 01:00 candidate, a Horse script edit at 07:15 stranded the 07:04 certificate, and the O31 batch at 12:40 stranded the 13:32 certificate.
2. **New Horse research scripts go under an excluded directory or prefix** (`oop-reraise-range/`, `omaha-reraised-pot-priced/`, `generate-`, `feature-ablation-`, `gto-v31-`, `assemble-public215-`; see `NON_RELEASE_SERVER_SCRIPT_PREFIXES` in `read-engine-prequalification.py`). Anything else under `server/scripts` is release control.
3. **At S-90 minutes run `python3 -B scripts/release/three-hourly-readiness.py`.** `READY` means a certificate whose projection equals main exists. Anything else is the custodian's problem now, not at the cutoff: a certification takes about 45 minutes after the host is free.
4. **Never queue a certification that cannot be selected.** There is one Backup host. A run for a commit whose projection differs from main, or that the selector already refused, holds the host for an hour and certifies nothing useful. Check projection equality first (rule 3) and cancel your own useless runs.
5. **When every candidate is refused on the same gate, suspect the copy before the code.** On 2026-11-26 five candidates were refused with `rollback_rehearsal_failed_to_132ef19f0770`; two of those were only the frozen copy left by the first failure, and `beb889fee8a1`, which contains every suspected Horse change, then passed on a fresh copy. Dispatch `backup-engine.yml` with `refresh=true` to force a fresh copy. Since O30 a failed rehearsal marks the copy spent and writes `rehearsalFailure` into the certificate; since O30b the hung engine's maintenance log is in the certify job log. Read both before touching anyone's code.
6. **A database update that only adds Horse option registry rows does not stale a certificate** (O33, `#12118`, `engine_inert()` in `server/scripts/engine-release-installed-migrations.py`; it lands in the 16:00 CST post-seal slot, and until then such an update still stales a certificate). Any other installed migration the copy lacks still does: recertify after the post-seal installs, as the post-seal Backup (O24) does.
7. **Every cycle has an outcome line on issue #11599.** If a cycle has none by its start plus 30 minutes, the O32 look-back posts `NO OWNER` or `NO OUTCOME` and messages the owner. A custodian who sees one does not wait for the next cycle to act.
8. **A merged migration the applier refuses blocks every engine release.** Every later commit carries a migration production does not hold, so O7 defers it and the O29 step-down finds nothing below it once release controls have moved. After each merge check its Apply Merged Migration run; if it was refused and the fix is not quick, revert the merge at once. On 2026-11-26 `20261126203947` (#12129) was refused at 16:17 CST, its proof timing out against live data, and blocked the 19:00 CST cycle until revert #12154 merged at 18:43 CST.
9. **Post every custody decision on #11599** (holds, dispatches, reverts), in Chicago time, so the other lanes and the next agent see it.
10. **When every candidate fails the same late gate, read the failure tail before blaming code.** A failed qualification step prints the tail of its own log (#12165). On 2026-11-26 three builds passed both swaps and failed the tournament freeze qualification with `OSError: [Errno 28] No space left on device`: the Backup host was full, and the 22:00 CST cycle kept serving.
11. **The Backup host reclaims its disk before every certification (O34).** Each certify log starts with `disk: removed N engine image(s) older than 24h; free X GiB`; a run that would start under 12 GiB free is refused as `backup_disk_low:<n>GiB` before it builds. First live reading, 22:15 CST on 2026-11-26: 366 images removed, 114 GiB free. If `backup_disk_low` appears, look at what the reclaim does not touch (the standby database volume and restore dumps) from the Mac with `ssh ca-backup`, read-only.

## Checking Readiness Before Any Cycle

Any of the four lanes (PLO Strategy, Horse On/Off Switches, Antigravity Coordinator, Horse Decisions) or the Dedicated Engine Cutover owner can inspect the next scheduled cycle with one read-only command:

```bash
python3 -B scripts/release/three-hourly-readiness.py
```

Options: `--json` (machine-readable payload), `--limit N` (default `10` first-parent commits displayed on `refs/remotes/origin/main` since the serving SHA, automatically extending up to `60` commits when none of the first `10` is `SELECTABLE` while skipping local `CONTROL_INPUTS`-mismatched commits with zero extra API calls; an explicit `--limit N` caps the walk at `N`, O19), `--repo owner/name` (default `Smarter-Software-PIQ/Smarter-Poker-Club-Arena`), `--repo-dir <path>` (optional path to a local git checkout when invoking the CLI from outside the repository; falls back to the script's repository root if `.git` exists, else current working directory, else fails closed to `UNKNOWN` with exit `3`).

The `selection` job in `.github/workflows/stage-engine-release.yml` also appends a strictly read-only, non-blocking Markdown summary to `$GITHUB_STEP_SUMMARY` with the `daily-selection.json` outcome, serving/target SHAs, deferred candidate reasons/details, and the `three-hourly-readiness.py` one-line verdict so all four lanes see selection readiness directly in the GitHub Actions UI.

The Stage run that owns a cycle also posts that verdict on the Engine cutover log issue #11599 while there is still time to act (O25, 2026-11-24): once when it reserves the cycle (ten minutes or more before the cutoff) and once 45 minutes before the cutoff when it reserved earlier than that. One line each, plus the Stage run URL: `Cycle: <YYYY-MM-DD HH:00 CST> | Readiness at T-<minutes>m: <verdict>`, where the verdict is `READY <sha12>`, `IN_FLIGHT <sha12> (<what it waits on>)`, `AT RISK: no certified candidate; newest refusal: <sha12> <reason>`, `NO CHANGE: protected main is the serving engine <sha12>`, or `readiness unknown (...)` when the check could not tell. T is the preparation cutoff (cycle start minus 30 minutes). The comments are posted from inside the owner's existing wait for the cutoff, are bounded to 185 seconds each, never fail or delay the run, and are never posted by a run that does not own the cycle or by a replay.

What it reports without mutating git, dispatching workflows, or touching credentials:

- Live `https://engine.smarter.poker/health` serving `releaseSha`, `frequency`, `startHours`, `phase`, and `stalledTables`.
- Next DST-aware `America/Chicago` cycle start, preparation cutoff (`start - 30m`, UTC and Chicago), per-cycle O3 deferral / nightly freeze bounds (`o3DeferStart`, `o3Clear`), and recommended combined migration + release-control hold start (`cutoff - 75m`).
- `NEXT OPEN CYCLE`: the first scheduled cycle whose preparation cutoff is still in the future (equals the next scheduled cycle before `:30`, and automatically advances to the following cycle once the current cycle's cutoff has passed).
- `MIGRATION GATE`: deterministic `NIGHTLY_FREEZE` (`23:45-04:15` Chicago), `O3_DEFERRAL` (`[cycleStart - 150m, cycleStart + 10m)` on three-hourly cadence), or `OPEN` status matching `scripts/ci/merged-migration-dispatch.mjs`, with exact clear time or next deferral start. When the gate is `OPEN` and an active non-post-seal Backup run or selectable certified copy already started before `o3DeferStart`, `copyHold` (`migrationHoldAdvisory`) flags an immediate migration hold from that Backup copy time using already-fetched data and zero extra API calls (O19).
- Active `stage-engine-release.yml` reservation run and active `backup-engine.yml` runs on `main`, each shown with its status and triggering event (`push`, `schedule`, `repository_dispatch`, `workflow_dispatch`) so a late-delivered schedule run or a post-seal Backup is told apart from a push run (O14), plus closed-cycle `stage-engine-release.yml` completion visibility (`closedCycleStageRun`, reused from the existing workflow runs fetch with zero extra API calls when the cutoff has passed and no Stage run is active).
- Recent first-parent commits on `refs/remotes/origin/main` since the serving SHA with `backup-engine/certified` state, latest `engine-release-prequalification.yml` status and run ID, `CONTROL_INPUTS` projection equality vs `origin/main` (via `scripts/ci/read-engine-prequalification.py`, which keeps `server/scripts` fail-closed while excluding pure unit/law tests under O4 and verified unreferenced offline HUD/horse/benchmark/probe/generator scripts under O9), and per-candidate `SELECTABLE`, `PENDING`, or `DISQUALIFIED` classification with an exact single-line reason. A `pending` certificate whose owning Backup run is already completed in the same recent-runs read (an O1 mid-soak yield, a stand-down or a cancellation, none of which writes a verdict) is shown as `pending (#<run> ended)`, its reason says it needs a new Backup run, and it no longer counts as in flight (O14); an active Backup run on the same SHA, or an owning run outside that read, keeps the plain `pending` reading.
- Top-level verdict: `READY`, `IN_FLIGHT`, `NO_CANDIDATE` (exit `0`), or `UNKNOWN` (exit `3`) whenever any live health, git, or GitHub API read is unavailable (CLAUDE.md 10.86).

## Rolling Back The Cadence

Set `frequency` to `"daily"` in `server/src/maintenance/maintenanceSchedulePolicy.json`, merge, and let the next 04:00 release seal; the engine then breaks only at 04:00 again, and every cycle-aware surface follows the serving schedule.

## A Cycle That Did Not Seal Gets A Fresh Certificate (O27, 2026-11-25; Corrected By O27b, 2026-11-26)

GitHub delivers few of Stage's scheduled runs, so a cycle is prepared only when a push, a delivered schedule or a delivered Backup completion creates a Stage run inside its election window. After a kept-serving cycle, or a selected cycle whose receiver did not seal, the cycle owner's Stage run waits once to the cycle start + 25 minutes and starts one certification of main on a fresh copy, titled `Backup after keep-serving <cycle> <nonce>` (job `next-candidate-after-cycle`, decisions in `scripts/release/next-candidate-after-cycle.py`).

What O27 claimed and what was true (run ids in `docs/changelog/2026-11-26-o27b-the-keep-serving-backup-proves-its-intent.md`):

- **The Backup did no work.** Stage sends the dispatch with the job token, and every secret-holding job of `backup-engine.yml` refuses a job-token dispatch. Run 45775146770 planned a commit, skipped `refresh` and `certify`, and ended green in nine seconds. Since O27b the Stage job is a trusted dispatch-intent sender (`scripts/ci/dispatch-intent.mjs`, operation `backup-after-keep-serving`): it records the exact intent on its own run before sending, and `refresh` and `certify` admit exactly `workflow_dispatch` with `after_cycle` and prove that intent as their first step. A person's manual dispatch is unchanged.
- **A green run could mean nothing was certified.** A run carrying `after_cycle` now ends with the job `keep-serving-outcome`, which is red unless the run certified, planned nothing, or handed the Backup host back (deferred). The Stage job also reads the run it started and fails when its `refresh` job was skipped.
- **Its completion did not start the next election (corrected 2026-11-27, section "The Estate App Starts The Next Cycle" below).** GitHub creates no `workflow_run` event for a run the job token started (nine of nine job-token Backup runs from 2026-11-24 to 2026-11-26, checked against both listeners of that workflow). The election's readers (Stage, `scripts/ci/read-engine-prequalification.py`, `server/scripts/engine-release-window-doors.py`) count only events a job token cannot create: a push, a schedule, a delivered Backup completion and the operator's own dispatch. So the next cycle still needs one of those inside its window. Since O32 (2026-11-26) a failed or timed-out push Backup's completion counts as one, and a cycle that still gets none is no longer silent: the next Stage run of any kind posts `NO OWNER` on the cutover log and the owner gets one note (section "Every Cycle Has An Owner Or Says So" below). Stage's listener clause for the `Backup after keep-serving ` title stays for a run a person starts with `after_cycle`, whose completion GitHub does deliver.

The arithmetic, from the cycle start: the next cutoff is at +150 minutes and the election window is `[+50, +150)`. The dispatch is at +25 and a real certification takes about 71 minutes (plan 1, refresh 15, certify 55), so the certificate is written near +96, 54 minutes before the cutoff. A run that ends in under 25 minutes certified nothing. Changelogs: `docs/changelog/2026-11-25-o27-a-cycle-that-did-not-seal-starts-the-next-one.md` and `docs/changelog/2026-11-26-o27b-the-keep-serving-backup-proves-its-intent.md`.

## A Hand Install Waits For The Same Windows As The Dispatcher (O28, 2026-11-26)

The merge dispatcher defers an ordinary migration through `[cycle - 150 m, cycle + 10 m)` of every non-04:00 cycle (O21), so the copy a candidate certifies on still equals production at its cutoff. The applier itself only knew the nightly 23:45 to 04:15 Chicago freeze. A hand dispatch of Apply Merged Migration in the daytime therefore still installed inside a cycle's hold; the soak in flight then yielded (O16) and that cycle kept serving.

`scripts/ci/release-freeze-admission.mjs` now refuses a hand install inside every cycle hold, with nothing sent, and names the cycle and the minute it clears. The exceptions are the ones the nightly freeze already has: a dry run, the maintenance-window route, the dispatcher's own proven job-token send, and an outage named in at least 20 characters with `release_freeze_override`. A hand install lands only in `[cycle + 10 m, cycle + 30 m)` and 04:15 to 04:30 Chicago: 135 minutes a day, minute for minute the dispatcher's windows.

The cadence is read from this revision's `server/src/maintenance/maintenanceSchedulePolicy.json`. Only an explicit `daily` lifts the cycle hold; a policy that cannot be read holds.

This is the applier's rule, not a database trigger. World Hub shares the migration history, and its migrations do not stale a Club Arena copy (O23), so refusing every repository's DDL for most of the day would cost that lane its installs and protect nothing here.

Law: `tests/a-hand-install-respects-the-release-freeze.law.test.ts`.

## A Shorter Certification With A Judged Memory Gate (2026-11-26)

**Why.** Two certification attempts should fit comfortably in one cycle. One attempt (refresh plus certify) took a median 67.9 minutes, so two used 136 of the 145 minutes between a break's end (start + 5) and the next cutoff (start + 150). The soak was 30 of those minutes and judged no memory.

**Measured.** 73 certificates, 2026-11-21 02:51Z to 2026-11-26 05:09Z, 1800 s soaks, two `docker stats` readings each:

| n = 73                  | Min    | Median | P95    | Max    |
| ----------------------- | ------ | ------ | ------ | ------ |
| Start (MiB)             | 608.5  | 969.6  | 1157.3 | 1243.1 |
| End (MiB)               | 711.3  | 1144.8 | 1397.6 | 1689.6 |
| Growth (MiB)            | -271.7 | 194.7  | 525.2  | 767.1  |
| Growth per minute (MiB) | -9.1   | 6.5    | 17.5   | 25.6   |

**The gate.** `judge_soak_memory_growth` in `server/standby/standby-engine.sh` samples the engine RSS (`/health` `memory.rssMb`, else `docker stats`) on every soak loop pass and refuses a build (`memory_growth_exceeded`) only when the median pairwise slope is above 141 MiB per minute over the whole soak and above half of that in each half. 141 = (26,624 MiB container limit minus the 1,243 MiB largest healthy start) / 180 minutes: growth that would reach the limit before the next cycle could replace the build. That is 5.5 times the largest healthy slope, 2.7 times the worst case of a healthy build's whole 30-minute growth landing inside the soak, and 6 times stricter than the out-of-memory kill the old soak relied on (854 MiB per minute). Too few readable samples is `memory_growth_unreadable`, which withholds the certificate and is never a pass. The certificate carries the whole check and its sample series as `memoryGrowthCheck`.

**The soak.** 900 s on all three surfaces (`backup-engine.yml`, `standby-engine.sh`, `select-daily-engine.py`). The hand-gap judge already graded at most 15 minutes. The selector accepts a soak under 1800 s only with `memoryGrowthCheck.status == "pass"`; a certificate without the key (made before this change) still needs 1800 s.

**The timetable.** Certify projects from a median 53.7 to about 38.7 minutes, one attempt from 67.9 to about 52.9, and two attempts from 136 to about 106 of the 145 minutes, leaving about 39 instead of 9.

**What stops it regressing.** `tests/a-shorter-soak-judges-memory-growth.law.test.ts`, with the 73 real certificates embedded.

**Not verified live.** The first real certification with the new judge is the live proof and is pending; the durations above are projections until then. Details, the limits of the measurement and the ceilings left at their old values: `docs/changelog/2026-11-26-shorter-certification-with-a-judged-memory-gate.md`.

## A Held Migration Does Not Block The Commit Below It (O29, 2026-11-26)

A migration that merges inside a migration hold (the hold around a cycle, or the nightly release schema freeze) is not installed until the hold ends, and a commit that carries it cannot be certified until then. That used to stop every certification: on November 26 the 01:00 CST cycle kept serving because main's head carried `20261126021630`, held until 04:15 CST, while the release-control commit one below it was shippable and never certified. The Backup run that would hand the host back for a held migration now first asks `scripts/release/step-down-past-held-migration.py` for the newest commit below the migration that touches `server/` or a release control, is ahead of the serving build, carries the control's release-control projection and has nothing of its own uninstalled, and certifies that commit instead (`STEPPED DOWN` in the run log and summary). Push, post-seal and `Backup after keep-serving` runs ask; a run given an explicit `sha`, the freeze baseline and a booking commit are untouched. With no such commit, or any answer it could not read, the run hands back exactly as before and the line says why. For the lanes: a migration merged inside a hold still rides the first cycle after it installs, and it no longer costs the other lanes the cycles in between. Changelog: `docs/changelog/2026-11-26-o29-a-held-migration-does-not-block-the-commit-below-it.md`.

## A Horse Research Script Does Not Cost A Certificate (O31, 2026-11-26)

A certificate is selectable only while the certified commit and the control commit have the same release-control projection, and that projection hashes `server/scripts`. On November 26 at 07:15 CST a Horse merge (`ad8d1e8f1`, #12085) changed `server/scripts/oop-reraise-range/league.ts`, a research league no release surface reads; the certified build `13bce958d4c3` became unselectable and the 10:00 CST cycle had nothing to ship. The projection now leaves out five more Horse families (`oop-reraise-range/`, `omaha-reraised-pot-priced/`, `feature-ablation-*`, `gto-v31-*`, `assemble-public215-*`) and `prepare-public215-feature-request.py`. Everything else under `server/scripts` is still hashed, and a new script is hashed until a release-control change proves it out. For the lanes: an edit inside those families, or the families already excluded (`horse-*`, `holdem-*`, `generate-*`, `gen-*`, `measure-*`, `benchmark-*`, `opponent-hud-*`, `audited-*`, `hvh48-*`, `nash-push-fold/`, `fixtures/`), never invalidates a certificate; a new Horse script with any other name still does until it is added, so put new research scripts in one of those directories or under one of those prefixes. The change to the rule is itself a release-control change and merges only in the post-seal slot. `tests/the-release-projection-names-only-release-files.law.test.ts` keeps every script the release route reaches inside the projection. Changelog: `docs/changelog/2026-11-26-o31-the-projection-names-only-release-files.md`.

## Every Cycle Has An Owner Or Says So (O32, 2026-11-26)

**Why.** The 10:00 CST cycle of November 26 had no owner. Its election window was 07:50 to 09:50 CST. The pushes that day were at 07:02 to 07:15 CST and at 10:20 CST, GitHub delivered no scheduled run, and the only events inside the window were the completions of two failed push Backups (Stage runs 45842790604 at 08:49 CST and 45846574486 at 09:11 CST) and one failed scheduled Backup (45850278483 at 09:33 CST). The election refused all three because the Backup had not succeeded. No selection ran, nothing was posted to the cutover log and nobody was told.

**The election needs an event, not a certificate.** A first-attempt push Backup completion on main now elects whether the Backup succeeded, failed or timed out, under the same run title `Automatic Backup daily reservation`. Nothing after the admission reads the Backup that woke the run: the owner binds protected main at the cutoff, and the selector picks the newest certified commit or keeps serving and says so. The three readers of the election (Stage's admission step, `scripts/ci/read-engine-prequalification.py`, `server/scripts/engine-release-window-doors.py`) name runs by event and title only, so none of them changes. A cancelled or skipped Backup, a second attempt, another branch and a Backup started by a schedule or by a manual dispatch stay outside the election, as before. With this rule the 08:49 CST completion owns the 10:00 CST cycle.

**No silent cycle.** Every Stage run, whatever started it, runs the job `cycle-look-back` once (`scripts/release/cycle-without-outcome.py`). No trigger, timer or wait is added. For each scheduled cycle of the last 26 hours whose election window has closed and that has no result on issue #11599 and no record on the outcome ledger, it replays that cycle's election from the Stage run list and posts one line:

| Line                 | Meaning                                                               | Said From                                                  |
| -------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `Result: NO OWNER`   | No eligible run created in the election window claimed the cycle.     | The window's close (start - 10 minutes), plus two minutes. |
| `Result: NO OUTCOME` | A run held the cycle and neither the log nor the ledger has a result. | 30 minutes after the cycle start.                          |

That line is the cycle's result, so a later run posts nothing. The job `cycle-without-outcome-note` then sends the owner one Messenger note through `public.fn_ca_note_cycle_did_not_seal` (one per cycle, idempotent in the database), for example "The 10:00 AM engine cutover on November 26 did not run: nothing started it. The engine kept running the current version." It runs only when a line was posted, so the service-role key is not loaded on an ordinary run. The owner run's `cutover-outcome-record` job writes the same finding to the outcome ledger as a `no-owner` or `no-outcome` record (`cutover-outcome-ledger.py record --gaps`); the owner run stays the ledger's only writer, and a gap record neither resets nor breaks the same-gate check.

**Could not tell.** An unreadable cutover log, run list, job record, ledger or serving schedule makes that cycle unknown: a warning in the run, nothing posted, nothing recorded, and the next run asks again. A cycle other than the 04:00 anchor is judged only while the serving engine's `/health` schedule is three-hourly, the same rule the admission uses.

**Why the look-back cannot hurt the election.** The election reads a failed or still-running earlier run as one that keeps its cycle. Both new jobs are `continue-on-error`, are bounded to four and three minutes, hold no wait, and no release job needs them.

**What is still open.** A window with no push to main, no delivered schedule and no Backup completion still has no owner. The job token cannot create one: GitHub creates no `workflow_run` run for work the job token started, and all three election readers refuse the events it can create. Closing that needs either the estate GitHub App as the dispatch identity or a job-token election class in all three readers (engine tree included); neither is made here. (The estate App identity was built on 2026-11-27, section "The Estate App Starts The Next Cycle" below.) Such a cycle is now announced at the next Stage run. Two smaller limits: two Stage runs created in the same seconds can both post the line (each reads the log again just before posting; the note is still sent once), and a note that fails three immediate attempts is not sent again once the line is on the log.

Law: `tests/every-cycle-has-an-owner-or-says-so.law.test.ts`. Changelog: `docs/changelog/2026-11-26-o32-every-cycle-has-an-owner-or-says-so.md`.

## The Estate App Starts The Next Cycle (2026-11-27)

**Why.** The post-seal Backup and the keep-serving Backup exist so that their completion creates the next cycle's Stage run when nobody pushes. Both were started with the Actions job token, and GitHub raises no `workflow_run` event for a run the job token started, so neither ever did. The 10:00 CST cycles of November 25 and November 26 had no owner.

**The fix.** Both dispatches are sent as the estate GitHub App `smarter-poker-autopilot[bot]`. A run the App starts raises `workflow_run` like a person's, and Stage's election already admits the completion of a first-attempt `Backup after seal` or `Backup after keep-serving` run on main under the title `Automatic Backup daily reservation`. No trigger, timer or election rule changed.

- Stage: `next-candidate-after-cycle` decides, records and publishes the intent; the job `start-backup-as-estate-app` sends the recorded body.
- Receiver: `certify-production` sends its one certification dispatch the same way.
- Each sending job is in the main-only environment `github-app-main` and mints a token scoped to this repository and to the one permission its dispatch needs.
- Backup and Post-Deploy E2E prove an App dispatch that cites an intent exactly as they prove the job token's. What may start a Backup is unchanged.

**When the App token cannot be had.** The job does not fail. The dispatch goes out with the job token as before, the log says so in a warning (`NO ESTATE APP TOKEN, JOB TOKEN FALLBACK` or `ESTATE APP DISPATCH FAILED, JOB TOKEN FALLBACK`), the Backup still certifies, and its completion starts no election. The operator fallback cron on the Mac Studio (`scripts/ops/cutover-operator-preparation.mjs`) stays in place for that case.

**For the custodian.** The sending step's log says who started the Backup run, read back from GitHub, and whether its completion will elect. A job-token fallback warning on a cycle means the next cycle's owner must come from a push, a delivered schedule or the Mac cron; check it at S-90 with the readiness command as usual.

**What is still open.** The next election window opens 50 minutes after a cycle starts. A Backup that ends before that elects nothing, whoever started it: a post-seal run with nothing ahead of the sealed build ends near start + 7 minutes, and a keep-serving run that plans nothing or hands the host back ends near start + 26. A stretch with no push and nothing to certify therefore still relies on a delivered schedule or the Mac cron, and the O32 look-back still announces a cycle nobody owned.

Law: `tests/the-estate-app-starts-the-next-cycle.law.test.ts`. Changelog: `docs/changelog/2026-11-27-the-estate-app-starts-the-next-cycle.md`.

## An Engine-Inert Migration Does Not Stale A Certificate (O33, 2026-11-26)

**Why.** The 1:00 PM CST cycle of November 26 was lost. The only certified candidate, `13bce958d4c3`, was refused at selection: "Backup copy lacks installed migration 20261126011318, 20261126014018, 20261126014434, 20261126064723" (issue #11599, 12:30 PM CST). Those four merged and installed at about 7:15 AM CST, after the certified copy was taken. Each one is only `BEGIN`, `SET LOCAL lock_timeout`, one or two `fn_ca_horse_option_register(...)` calls with literal arguments, and `COMMIT`: one row of `public.ca_horse_option_whitelist` per call. No engine code reads that table. The engine's only runtime reads that reach it, `fn_ca_horse_option_switch_effective` and `fn_ca_horse_style_switch_effective`, go through `fn_ca_horse_option_switch_states` and use only an option's kind, which a register call never changes for an option that already has a switch row. A copy lacking such rows certifies the same engine.

**The class.** `engine_inert()` in `server/scripts/engine-release-installed-migrations.py`. After whole-line `--` comments and blank lines are dropped, every line must be exactly one of:

- `BEGIN;` (first line, once) and `COMMIT;` (last line, once);
- `SET LOCAL lock_timeout = '<1 to 3 digits>s';`;
- `SELECT public.fn_ca_horse_option_register('<option>', 'plain'|'style', true|false, 'none'|'on_shadow'|'shadow', '<migration>');`;
- `SELECT public.fn_ca_horse_option_allow_shadow('<option>', 'on_shadow'|'shadow', '<migration>');`;
- `SELECT public.fn_ca_horse_option_unlock('<option>', ARRAY['<migration>'(, '<migration>')*], '<migration>');`.

`<option>` is `[A-Za-z][A-Za-z0-9]{0,62}` and `<migration>` is `[0-9]{14}_[a-z0-9]+(_[a-z0-9]+)*`, so no literal can hold a quote, a semicolon or an expression. At least one call is required. Anything else (another statement, a trailing or block comment, a DO block, a subquery or concatenation, two statements on one line, unreadable bytes) is not inert. All three functions write only the whitelist.

**The rule.** A version whose one file in the control tree is inert, and which the exact target's tree does not ship, is compared on neither side, like a foreign version (O23), by the selector (`judge`) and `refresh-due`. The reason text says `left out as engine-inert: <versions>`. The certificate's digest is unchanged: it still names the copy's own set. At cutover, `status` accepts production when its set equals that digest, as before, or when removing some non-empty subset of the inert versions production holds gives exactly that digest, that is, production is the certified copy plus inert versions and nothing else; the line names them. At most 10 such versions are tried; with more, nothing is left out anywhere (`bounded_inert`), so the selector never accepts a copy the cutover cannot recognise. No control, an invalid SHA, or a tree or blob git cannot read leaves nothing out as inert. The exact candidate's own migration files are never inert and are still required by version and name.

**What stops it returning, and what would remove it.** `tests/an-engine-inert-migration-does-not-stale-a-certificate.law.test.ts` classifies the four real files inert and fourteen mutations not inert, runs the judge fixtures, and re-checks the premise on every change: no engine code outside tests and `HorseOptionSwitchMigrationLists.ts` names the whitelist or the functions that change it, the database functions that read the whitelist are exactly the known eleven, the engine calls only the two effective reads among them, those use the whitelist only as `@> ARRAY['canary']` (the style kind), and the whitelist guard keeps a kind for ever. If any of that changes, the law fails and the carve-out must be removed or narrowed.

**Not covered.** A copy holding an inert version that production lacks is accepted by the selector but refused at cutover (the subset search only removes versions from production's side); production losing a version is not expected. The selection of `13bce958d4c3` itself is not replayed here: whether its certificate is still selectable (soak and cutoff rules, and the count of inert versions production holds) was not checked.

Law: `tests/an-engine-inert-migration-does-not-stale-a-certificate.law.test.ts`. Changelog: `docs/changelog/2026-11-26-o33-an-engine-inert-migration-does-not-stale-a-certificate.md`.
