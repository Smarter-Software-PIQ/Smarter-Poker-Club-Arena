# 2026-11-07 - A Job Failing Every Run Is Named

Dan, 19:45 Chicago: "a job that fails every run should alert someone."

## What happened

pg_cron job 117, `sp_prune_hand_history_10m` (every 10 seconds), failed on every run from 19:56 UTC with `TOURNAMENT_HAND_ARCHIVED_BY_OPERATOR`: about 360 rollbacks an hour, each after about 4 s of work, the load that timed out Lightning dealing calls. The prune itself is fixed separately (#9973). This change is about why nobody was told which job it was.

- `PgCronFailuresElevated` did fire, at 20:14 UTC, and reached the operational inbox, but as a **warning** that counted the whole fleet ("103 pg_cron failures in the last hour") and named no job. It cleared at 21:17 when the job recovered for five minutes and fired again at 21:44.
- The per-job watch `fn_ca_cron_failure_watch` raised at **00:37 UTC, 4 h 41 m in**. Its rules were "the last 3 runs failed and no success for 2 hours" or "more failures than successes over 24 hours". A 10-second job that fails almost every run still succeeds now and then (job 117 did through 21:18-21:23 and twice at 22:33), and each success restarted the 2-hour clock; 24 hours of earlier successes kept the second rule false.

## The fix

- `public.fn_cron_failing_jobs()` (migration `20261108020000`): a job is failing repeatedly when it has at least 3 consecutive failed runs for at least 10 minutes, or 18 of its last 20 runs failed over at least 10 minutes. A success ends the streak, so one transient failure never qualifies; ten minutes outlasts a maintenance freeze. It reads only the newest ~20,000 runs by primary-key range (the table's only index). `service_role` only.
- `fn_ca_cron_failure_watch` keeps both original rules and also raises every job the new read names, with the same `cron-failing:<job>:<date>` key (one incident per job per day) and the job, streak and last error in the message. A failure of the read is a critical incident. Live as soon as the migration is installed; the watch runs at :07 and :37.
- `server/scripts/collect-monitoring-health.sh` reads it into `poker_cron_job_failing_streak{jobname,guard}`, `poker_cron_job_failing_of_last_20` and `poker_cron_jobs_failing_repeatedly`. Optional like the client error half: a missing function or failed read only sets `poker_cron_failing_collect_ok 0`.
- `infra/monitoring/alert-rules.yml`: `PgCronJobFailingRepeatedly` (warning) and `PgCronGuardJobFailingRepeatedly` (critical, jobs in `ca_guard_inventory`) name the job in the summary (read from `poker_cron_job_failing_of_last_20`, present for every named job, since one named by 18 of its last 20 runs can have a current streak of 0), sit out maintenance, and hold a brief recovery as one episode (`keep_firing_for: 15m`). `CronFailingJobsBlind` fires if the read fails for 30 minutes. Runbook: `docs/runbooks/cron-job-failing-repeatedly.md`.

## Evidence

Run read-only against production's `cron.job_run_details` as of 2026-11-07 20:10 UTC, the rule names `sp_prune_hand_history_10m` (81 failed runs in a row, 13.4 minutes, last error `TOURNAMENT_HAND_ARCHIVED_BY_OPERATOR`) and no other job. Sampled every 30 minutes over the preceding 24 hours, it named no other job at any point. `scripts/ci/test-cron-failing-jobs.py` proves the rule, the watch, the grants and the collector rendering on PostgreSQL 17.

## When it is live

The function and the watch: when the migration is installed (Apply Merged Migration). The collector and the alert rules: the collector ships with the engine release, so the rules fire from the 04:00 Chicago engine release; until then `scripts/ci/check-alert-rules-match.mjs` reports the new metrics as ahead of the running engine, as it does for #9952's freeze gauge.
