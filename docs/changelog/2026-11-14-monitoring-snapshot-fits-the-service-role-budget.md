# The monitoring snapshot fits inside the service_role budget (2026-11-14)

Incident fa23c973, HorseFleetThroughputPolicyUnknown, 10:25:49 AM CST to
10:26:59 AM CST.

The cash admission policy was never unreadable. Every call to
`fn_lightning_admission_policy` in the window returned 200. The
monitoring-health collector calls `fn_monitoring_health_snapshot` first and
stops on failure, and four consecutive snapshot calls (10:21:37-10:24:44 AM CST)
were cancelled by the service_role 8 s statement timeout (57014, PostgREST log).
No run for four minutes aged `poker_health_collected_timestamp_seconds` past
180 s, so `sp:lightning_admission_policy:readable` became 0 and the alert fired.

The snapshot cost about 2.1 s on a quiet database. Two reads did table-wide work
for small answers: the last hour of `cron.job_run_details` (982,004 rows,
sequential scan, 367 ms) and each job's latest run from 30 days of
`cron_execution_log` (142,181 rows sorted, 780 ms). Migration
`20261114163644` reads both by index: a primary-key range for the last hour and
one backward probe per job name. Measured on production read-only: 2,084 ms
before, 803 ms after, same values. The alert rule and the collector are
unchanged. The remaining ~0.8 s is `v_openclaw_job_staleness`.
