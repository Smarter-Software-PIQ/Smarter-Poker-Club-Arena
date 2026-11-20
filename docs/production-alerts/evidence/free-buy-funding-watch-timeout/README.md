# free-buy-funding-watch-timeout (operational_alert_events 446169)

Alert: alertmanager `PgCronJobFailingRepeatedly`, job `ca-free-buy-funding-watch-15m`, 2026-11-20 05:45 UTC.

## Production readings (read-only, 2026-11-20 05:40-05:50 UTC)

- `cron.job_run_details`: runs at 05:11, 05:26, 05:41 failed with
  `canceling statement due to statement timeout` inside the `gtd` CTE
  (duration 60.05-60.08 s); 02:41 failed the same way; every successful run
  overnight took 54.3-59.5 s. Job command:
  `SET statement_timeout = '60s'; SELECT public.fn_ca_free_buy_funding_watch();`
- `gtd` selects 433 events (window `max(2026-11-05 22:25, now() - 14 days)`,
  full since 2026-11-19).
- `fn_ca_guarantee_funding` once per event over the 433: 25.39 s.
- `fn_ca_guarantee_house_supplements` once per event: 4.15 s (called twice
  inside `fn_ca_guarantee_funding`; left unchanged).
- The gtd CTE exactly as the watch writes it, inlined with finding's WHERE:
  41.36 s, 0 findings.
- Free Buy branches (fb build 0.19 s, voucher 1.37 s, entry_without_ticket
  1.46 s, early_prize_promo 0.79 s): about 4 s.
- Live definition md5 `37dd9112a5a5830b1847e0fe31065f77` (pre-image guard).

## Native proof (PostgreSQL 16, scratch cluster, never production)

The migration's function body was installed over a minimal schema with five
finalized guaranteed events and a `fn_ca_guarantee_funding` stub that counts
its calls and reports each event overfunded:

| body | funding calls for 5 events | findings |
| --- | --- | --- |
| pre-fix (`WITH gtd AS (`) | 35 | 5 guarantee_overfunded |
| post-fix (`WITH gtd AS MATERIALIZED (`) | 5 | 5 guarantee_overfunded (same rows, no new alerts) |

## Regression test

`tests/the-free-buy-funding-watch-reads-each-guarantee-once.law.test.ts`:
fails on main without the migration (newest definition is
20261106194903 and has no MATERIALIZED), passes with it.
