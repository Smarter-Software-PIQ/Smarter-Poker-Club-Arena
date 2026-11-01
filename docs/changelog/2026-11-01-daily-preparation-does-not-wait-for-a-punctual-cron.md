# 2026-11-01 - Daily preparation does not wait for a punctual cron

Owner order (Dan, 2026-11-01 07:29 CT): "FIX ANY AND ALL BLOCKERS NOW AND
FINISH THIS UP, PUSH AND PUBLISH EVERYTHING."

## What broke

`stage-engine-release.yml` prepares the owner-requested daily 04:00
America/Chicago engine release (CLAUDE.md section 13): it dispatches the exact
main SHA to the one receiver and runs `install-window-migrations.mjs`, which
installs every `-- @install-window: daily-maintenance` migration inside the
04:00 freeze. That preparation belonged to ONE schedule event a day (`30 8` /
`30 9` UTC, guarded to the 03:30 Chicago twin), and admission was judged by the
run's _nominal_ instant, so a late run was still admitted.

Measured schedule-run creation times (UTC):

| date       | runs                    | result                                                     |
| ---------- | ----------------------- | ---------------------------------------------------------- |
| to 10-29   | 08:33-09:48             | on time (3-20 minutes late, inside the window)             |
| 2026-10-30 | 15:08, 16:03            | 6 h late; dispatched a receiver that could not reach 04:00 |
| 2026-10-31 | 14:37, 15:24            | 5-6 h late; installer answered NOTHING QUEUED / skipped    |
| 2026-11-01 | none at all (13:30 UTC) | no preparation                                             |

So migration `20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql`
(#9054) never got its window, and every newer engine build failed the
receiver's "Prove The Exact Engine Has Every Production Door"
(`fn_ca_cancel_tournament_abort_unsettled_hand` missing, e.g. receiver
41286975364). Meanwhile protected-main pushes ran this same workflow every few
minutes for most of the night.

## The fix (root cause: the preparation was owned by an event GitHub does not deliver on time)

- **The preparation belongs to a window, not to an event.** The admission step
  computes the run's own instant - the schedule run's `created_at`, or the push
  payload's `repository.pushed_at` - and admits the daily preparation only when
  it falls inside **03:30-03:50 America/Chicago** (DST aware, `ZoneInfo`).
  03:30 is the existing preparation boundary (the v1 activation floor's
  preparation epoch is 1800 s before 04:00); 03:50 keeps the receiver's ~19
  minute preflight and its staging ahead of the 04:00 boundary (a dispatch at
  03:46 CDT on 2026-10-24 shipped; the one at 03:51 on 2026-10-26 failed).
- **A late cron prepares nothing.** A run created outside the window is judged
  by when it arrived, so the 6-hour-late runs of 10-30/10-31 would now refuse.
- **Once per Chicago date.** Inside the window the step lists this workflow's
  runs created in the window (`created=<start>..<end>`). The first push or
  schedule run on main (lowest run id) owns the preparation; any later run
  prints "belongs to earlier run N" and prepares nothing - no second dispatch,
  no second installer run. A list that cannot be read, or that is truncated, is
  UNKNOWN (CLAUDE.md 10.86) and prepares nothing. The receiver's per-SHA
  concurrency and the installer's own "queued = not in schema_migrations" plus
  its `daily-maintenance-window-migrations` concurrency group stay as the
  inner guards.
- **More chances, same business schedule.** The two `:30` ticks become
  `31,35,39,43 8 * * *` and `31,35,39,43 9 * * *`: odd minutes off GitHub's
  congested `:00/:30`, covering both DST states. Together with the push runs
  they are only chances to be the first run in the window.
- `window-migrations` now runs on `daily_preparation == 'true'` (the owned
  preparation) or an owner window, instead of on any `schedule` event; that
  also closes a latent path where an off-hour schedule run admitted as an
  engine emergency would have started the installer.

Unchanged: daytime pushes still queue; commit urgency is still nothing; the
measured emergency, the `daily-maintenance-transition` trailer and owner
windows keep their routes; there is still exactly one publisher and one
receiver; no watcher, timer service, retry agent or repair loop was added.

## Known limit, recorded rather than hidden

The receiver's production-door check runs before 04:00, but a window migration
installs inside the 04:00 freeze. So an engine build that needs a function a
window migration creates still cannot activate on the same morning that
migration installs; it activates at the next daily window. For #9054 that
means the migration installs at the first preparation this fix delivers and
the engines that call it ship the following 04:00.

## Proof

- `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`
  executes the real admission step: in-window schedule and push runs prepare
  (CST, CDT, both DST transition days, last second), out-of-window and
  measured late runs prepare nothing and never list runs, earlier owners win,
  dispatch/foreign-branch/out-of-window runs do not compete, unreadable and
  truncated lists are UNKNOWN, emergency and transition routes survive a
  refused duplicate. All 10 cases fail against origin/main 4e9c322854.
- Pins moved in the same commit, with this reason: the schedule pairs in
  `no-workflow-gains-a-new-timer`, `a-window-migration-waits-for-the-daily-break`,
  `an-owed-engine-release-is-offered-until-production-holds-it`,
  `the-deploy-can-always-ship`; the late-cron refusal added to
  `daily-engine-maintenance`.
