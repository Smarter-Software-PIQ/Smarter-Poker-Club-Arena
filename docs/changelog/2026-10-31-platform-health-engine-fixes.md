# 2026-10-31 - Platform health: engine fixes (phase 6 of the health programme)

Fifteen engine and release-control fixes from the October 31 Platform Health deep dive.
Every one either removes a false signal at its source or turns a silent failure into a
counted, alerted one. None adds a repair loop: the three that first shipped as automatic
retries (straggler force-park, orphan-claim retry, Lightning drain) were converted to
detect-and-report before this pull request was opened.

## What changed

| Area | Change |
| --- | --- |
| Memory | `observability/memoryGovernor.ts`. Ships in **observe** mode (`MEMORY_GOVERNOR_MODE` unset). Soft ceiling holds new tables and shrinks the horse decision journal's archive ring; the hard-ceiling hand-off only runs with `MEMORY_GOVERNOR_HARD_ACTION=handoff` and at least one hour of uptime, so it cannot cause a restart storm. Ceilings derive from `MEMORY_LIMIT_MB` (soft 80%, hard 95%). |
| Journal | Memory pressure bounds the archive ring; releasing pressure restores the configured size; a malformed retention is ignored rather than shrinking the ring to zero. |
| Maintenance | A second consecutive uncertified break reports its stragglers by reason (`straggler_reported`, `refusing_accounting_pending`). It does not force-park anyone. |
| Deploy | `auto-deploy-hetzner.yml`: the release step always writes `result=`, and every exit path is recorded by `record-engine-deploy-exit.mjs`. `PostDeployVerificationIncomplete` names its run, release and steps. |
| Tournaments | The leader claims a RUNNING tournament with no lease row on its next tick. An orphan claim waits out a cooldown and stops after five failures, then raises an alert. A closed Diamond arena tournament is skipped quietly, not retried. |
| Lightning | Pending post-commit obligations are counted at startup and before a break, and alert when present. Nothing drains them automatically. |
| Rakeback | A watermark more than one interval behind runs bounded back-to-back cycles of the live settler, so it reaches the present instead of falling further behind. |
| SLO | `poker_fleet_table_stall_max_ms` measures only tables that should be dealing (two or more dealable seats, and not paused by design inside the 30-minute bound). Per-table `poker_table_ms_since_progress` samples carry `paused="0|1"`, which the database's 60-second stall watch reads. |

## Database

The two migrations this work needs (`restart_gate_records_breaks_since_restart_certified_and_second_break`,
`engine_deploy_exit_paths_are_recorded_for_every_run`) are already installed in production as
`20261031202221` and `20261031202222`. Their byte-exact recordings ship in the companion
recording pull request, so this branch does not carry a second copy.

## Deployment requirements

- Routine release: daily 04:00 America/Chicago through `stage-engine-release.yml` then
  `auto-deploy-hetzner.yml`. No emergency admission.
- Set `MEMORY_LIMIT_MB` to the container's real memory limit. Leave
  `MEMORY_GOVERNOR_MODE` and `MEMORY_GOVERNOR_HARD_ACTION` unset (observe only) until a
  week of `/health` memory samples shows the ceilings are right.
- After cutover: `/health` reports the new revision; `/metrics` per-table samples carry
  the `paused` label; `poker_fleet_table_stall_max_ms` excludes paused and short-handed
  tables; the stall watch (`fn_ca_table_stall_watch_tick`) keeps reading `/metrics`
  without a `StallWatchBlind` alert.

## Verification before merge

- `npx tsc --noEmit -p server`: clean.
- 9 server test files touched by the series: 208 tests pass.
- `tests/unit/deployAndPublishAreHonest.test.ts`, `tests/unit/theDeployNamesEveryExitPath.test.ts`,
  `scripts/ci/record-post-deploy-verdict.test.mjs`: pass.
