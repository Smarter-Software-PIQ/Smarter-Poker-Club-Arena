# A pg_cron job is failing repeatedly

Alerts: `PgCronJobFailingRepeatedly` (warning), `PgCronGuardJobFailingRepeatedly` (critical, the job is in `ca_guard_inventory`), `CronFailingJobsBlind`. The per-job watch `fn_ca_cron_failure_watch` raises the same condition as a drift incident (`cron-failing:<job>:<date>`).

**What it means.** `public.fn_cron_failing_jobs()` names a job that has failed at least 3 runs in a row for at least 10 minutes, or 18 of its last 20 runs over at least 10 minutes. A single transient failure never qualifies, and a maintenance freeze (at most seven minutes) is excluded. The job is not doing its work: a retention job falls behind, a settlement or guard job stops protecting money.

**Read it.**

```sql
SELECT * FROM public.fn_cron_failing_jobs();
SELECT runid, status, start_time, left(return_message, 300)
  FROM cron.job_run_details d JOIN cron.job j USING (jobid)
 WHERE j.jobname = '<job>' ORDER BY runid DESC LIMIT 20;
SELECT schedule, command FROM cron.job WHERE jobname = '<job>';
```

**Fix the cause, not the schedule.** The error is in `return_message`. Fix the function or the data it trips on, through a migration on protected main. Do not unschedule the job, lengthen its interval, or add a retry or repair job to quiet the alert (no watcher stands in place of a fix). If the job must be stopped while the fix ships, say so in the incident and in the fixing PR.

**Example.** 2026-11-07 19:56 UTC: `sp_prune_hand_history_10m` (every 10 s) failed every run with `TOURNAMENT_HAND_ARCHIVED_BY_OPERATOR`. One archived tournament hand on its page was refused by the archive guard, so the cursor never moved, and each run did about 4 s of work before rolling back, which slowed the whole database. The fleet alert counted failures without naming the job; this alert names it within ten minutes.

**`CronFailingJobsBlind`.** The collector could not read `fn_cron_failing_jobs()` for 30 minutes. The fleet gauges are unaffected. Check the function exists (migration `20261108020000`) and that `service_role` can execute it.
