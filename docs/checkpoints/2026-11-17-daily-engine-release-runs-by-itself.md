# Daily 04:00 engine release runs by itself (checkpoint, 2026-11-17)

Owner: Daily-release lane (swarm agent D, Claude session_01BNteGYXUmHpokgqTdUPGbx). Branch `claude/daily-release-runs-by-itself-20261117`.

## Owner instruction (verbatim, Dan, 11:04 America/Chicago 2026-11-17)

"YOU NEED TO MAKE SURE THAT ALL OF THESE THINGS ARE PRESENT BEFORE 4AM CUT OVER, THAT THE AGENTS KNOW TO ADD THESE IN, OR THE AUTOMATIC CUT OVER ENGINE NEEDS TO BUILD AND ADD THESE AUTOMATICALLY IF THEY ARE MISSING BEFORE THE 4AM CUT OVER, THIS IS SUPPOSED TO RUN AUTOMATICALLY AT 4AM CST EVERY DAY, AND HAS NOT SUCCESSFULLY RAN AUTOMATICALLY ONCE BY ITS SELF..."

Scope (relayed by the coordinator): source changes to the daily release route (release controls, selector, Backup and stage workflows, migration dispatcher gating). Not authorized: an off-cycle cutover, a manual dispatch, hand certification. Also recorded in `/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md` (2026-11-17T17:40Z).

## History of the routine daily route (Stage reservation runs and `ca_engine_deploy_attempts`)

The daily-only route began with the owner direction of 2026-11-06. Before that, hourly and owner releases sealed many times a day, and the 04:00 attempts of 2026-10-24 to 2026-10-28 sealed automatically.

| Chicago date | Routine outcome            | Cause                                                                                                                |
| ------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 11-07        | refused before host intake | window-migration DB prerequisite missing (run 42360536751)                                                           |
| 11-08        | no preparation run         | GitHub delivered the schedule six hours late (fixed: five-hour reservation)                                          |
| 11-09        | refused selection          | exit 2 at 09:30Z (run 42562159686); artifact expired                                                                 |
| 11-10        | not routine                | owner window 0650z sealed 840429a3 at 04:11 (workflow_dispatch)                                                      |
| 11-11        | not owed                   | owner window sealed f7735cca at 03:29                                                                                |
| 11-12        | refused                    | "Release controls changed during reservation" (43155291080)                                                          |
| 11-13        | refused                    | same (43366032752)                                                                                                   |
| 11-14        | refused                    | same (43577236622); fixed by #10765                                                                                  |
| 11-15        | **SEALED by itself**       | 54c9aac8 at 04:05 (Stage 43686182166, receipt 43699594563-1)                                                         |
| 11-16        | keep-serving               | Backup copy lacked installed 20261116005904, 010528, 011129, 073430 (43824655446)                                    |
| 11-17        | keep-serving               | Backup copy lacked installed 20261117053627 (07:04Z) and 151020/153059/195541 (owner DB window 07:51Z) (44034697186) |

The routine run did seal by itself once (11-15), so "never" is not exact, but it succeeded 1 time in the 11 days of the daily-only route.

## Causes ranked

1. Release controls changed during reservation: 3 days (11-12/13/14). Already fixed on main (#10765): the date follows the controls the cutoff binds.
2. Backup copy older than production's installed schema: 2 days (11-16/17), the only cause still open. **Fixed here.**
3. One-off: window-migration prerequisite (11-07), late schedule (11-08), unknown exit 2 (11-09).

Separately, the "Install Queued Daily-Maintenance Migrations" job failed on 11-13, 11-14 and 11-17 (lock timeout; a dependency function missing). It does not decide the engine selection; it belongs to the migration-install alert owner (agent E).

## Fix

`scripts/ci/merged-migration-dispatch.mjs` `RELEASE_SCHEMA_FREEZE_CHICAGO`: ordinary merged migrations are held from 23:45 to 04:15 Chicago, in the merge's own single bounded wait, so the 00:07 nightly Backup copy equals production at the 03:30 selection. No release-control input changes, so no certificate is invalidated by this merge. No watcher, timer, retry or certification path is added.

Regression: `tests/an-ordinary-migration-waits-for-the-daily-engine-selection.law.test.ts` (7 of 8 cases fail on pre-fix main), updated `tests/a-merged-migration-is-dispatched-by-its-merger.law.test.ts`.

## Remaining limits

- An owner-booked database window, or a hand outage install, inside 23:45-04:15 still stales the night's certificate. The selector then keeps serving, which is safe.
- If GitHub delivers the nightly Backup schedule more than about two hours late, no current certificate exists at 03:30.
- An engine change merged after about 02:00 Chicago cannot be certified by 03:30 and waits a day.

## Follow-up: a window migration installs against production before it merges

The "Install Queued Daily-Maintenance Migrations" job refused its queue on 11-13, 11-14 and 11-17; each defect (a missing function or table, a lock timeout, a raising guard) was first found inside the 04:00 break. `.github/workflows/window-migrations-install-before-merge.yml` now answers it on the pull request: a default-branch, read-only job captures production's schema with the Backup engine's own export, and a secret-free job restores it into a throwaway PostgreSQL and installs production's uninstalled ordinary migrations, then every uninstalled `-- @install-window: daily-maintenance` file (main's and the branch's) in the installer's order. A window file the branch adds or changes that does not install fails the check before merge. One answer per pull-request event: no schedule, no watcher, nothing installed in production.

Regression: `scripts/ci/test-window-queue-rehearsal.sh` (native, in the existing maintenance-window-migrations lane) proves a window file calling a function production lacks fails and names it, and a file depending on an earlier queued window file passes; `tests/a-window-migration-installs-against-production-before-it-merges.law.test.ts` pins the workflow's trust split and the lane wiring.

Recovery note: agent D was ended by a session restart during its third pre-push attempt. Attempts 1-3 failed only on vitest timeouts (load 30-40 on 28 cores from unrelated evaluation jobs), never an assertion. The continuing push uses the documented `VITEST_MAX_THREADS` budget (`scripts/ci/client-vitest-worker-budget.mjs`) to bound local parallelism; no check is skipped.
