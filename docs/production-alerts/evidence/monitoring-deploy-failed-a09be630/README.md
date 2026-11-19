# MonitoringDeployFailed episode a09be630 (Production Alerts, PRIMARY, 2026-11-10)

## Rows

| id | event_key suffix | status | received_at (UTC) |
| --- | --- | --- | --- |
| 353025 | (episode) | firing, delivery_count 3 | 2026-11-07 21:44 -> last 2026-11-09 02:52 |
| 353026 | failed-release:349a37a0 | info | 2026-11-07 21:44 |
| 353157 | failed-release:284b97e6 | info | 2026-11-08 02:55 |
| 370466 | failed-release:8d15892c | info | 2026-11-09 02:52 |
| 373822 | :resolved | resolved | 2026-11-10 04:54 |

The earlier episode da078c27 (rows 352230, 352231, 352797; 2026-11-07 13:36 -> 19:40) has the same cause.

## What the failing runs said

Run 42553095888 (8d15892c), job `deploy`, step `node scripts/ci/check-alert-rules-match.mjs`:

```
[alert-rules] repo declares 164; the box is running 164.
RULES AHEAD OF THE ENGINE THAT IS RUNNING (3) - they cannot fire:
   poker_client_freeze_refusal_users_10m   (alert-rules.yml)
   poker_cron_failing_collect_ok   (alert-rules.yml)
   poker_cron_job_failing_of_last_20   (alert-rules.yml)
  The engine is running 391f7bc0. ...
  Deploy the engine (auto-deploy-hetzner.yml, at the :55 break) ...
```

Run 42377551018 (669df20d): the same refusal for `poker_tournament_break_last_hand_wait_seconds`, engine 92e26a9f.

So the deploy itself worked: the box ran exactly the declared rules. The verifier correctly refused rules whose metric only a newer engine emits.

## Root cause

- Engines release once a day in the 04:00 America/Chicago window. A merge that adds a metric and its rule together is therefore always deployed to monitoring before its engine, so it always reaches this refusal. That refusal is correct.
- The defect: once the engine caught up, nothing ran the verification again. `deploy-monitoring.yml` ran only on a push touching `infra/monitoring/**` or on a manual recovery dispatch.
  - Engine release `bff6eed3` (run 42683596427) completed successfully at 2026-11-09T19:41Z.
  - The episode stayed firing until 2026-11-10T04:54Z. It closed only because #10260, an unrelated metric change, happened to touch `infra/monitoring` (run 42758515391).
  - Episode da078c27 closed the same way, by chance.
- The refusal text also told the reader to wait for "the :55 break", which has been retired since 2026-10-20.

## Fix

- `deploy-monitoring.yml` now also runs on `workflow_run` completion of `Auto-Deploy Hetzner Engine (on server/ changes)`.
- It runs only when that run was a successful `Engine Release` or `Engine Withdrawal` on main.
- It converges on current main exactly as a push run does: same steps, same compare-and-swap receipt.
- The verdict job carries the same condition. A failed release or a Private Horse Fleet Observation run skips the whole run and records no verdict, so it cannot raise a false "skipped" alert.
- The refusal text now names the daily window and says the re-run is automatic.

## Hardening

1. Regression test: `tests/an-engine-release-re-asks-the-monitoring-question.law.test.ts`. Run against the pre-fix workflow and checker, 4 of its 6 cases fail. All 6 pass after the fix.
2. Invariant: the workflow's own trigger and job conditions.
3. Detector: the existing `monitoring-deploy-verdict` job, routed to `operational_alert_events` with `target_task_id`. If the episode is still open after the re-run, the condition is real (engine still behind) and it stays firing.
4. CI gate: the test lives in `tests/`, which the Client Unit Tests shards run on every pull request. It is registered in `docs/laws.d/`.

## Local checks (this branch)

8 test files, 1695 tests passed:
- the new law
- `the-monitoring-deploy-deploys`
- `workflow-run-names-a-live-workflow`
- `law-registry`
- `superseded-ci-stops-at-the-push`
- `workflowConcurrencyGuard`
- `what-a-monitor-reads-is-what-the-repo-says`
- `clubArenaOwnsItsReleasePaths`
