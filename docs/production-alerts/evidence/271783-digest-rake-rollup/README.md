# 271783-digest-rake-rollup

Production Alerts fleet, PRIMARY lane, 2026-11-23T03:45Z.

## Rows
- `operational_alert_events` 271783: `sp-daily-digest` / `DailyDigest.rake_rollup_mismatch`, day 2026-10-24. Ledger 343,158.54, rollup 0.00.
- `operational_alert_events` 281560: the same alert for day 2026-10-26. Ledger 431,016.15, rollup 0.00.

## What was read (production, read-only, 2026-11-23 ~03:40Z)

### The money was never wrong
`club_rake_daily_user` totals now match the ledger to the cent:

| day | `club_rake_daily_user` total | ledger in the alert |
|---|---|---|
| 2026-10-24 | 343,158.54 | 343,158.54 |
| 2026-10-26 | 431,016.15 | 431,016.15 |

The stored `sp_daily_metrics` snapshots for these two days still read rollup 0. They are left unchanged.

### Cause 1: the digest compared against a stale snapshot
`fn_sp_daily_digest` compared the ledger with a metrics snapshot taken before the hourly rollup catch-up had written the day. The fix is 20261025143717 (installed 2026-10-25). It re-reads `club_rake_daily_user` when the digest is sent and records `rollup_rechecked_at`. The live function contains the recheck (`pg_get_functiondef` md5 `393b94d1910abc1622fbfabc01afd3f4`).

### Cause 2: the catch-up ran out of time
On 2026-10-26 the alert fired again after the recheck was installed. The re-read itself still found 0 because the catch-up had not finished. Cron job 128, `club-rake-rollup-catchup` (`25 * * * *`), was hitting its 300 s budget by reading the day's facts several times.

The fixes:
- 20261027005822 reads each club cutoff once.
- 20261027063331 reads one MATERIALIZED day of facts for all five report relations.

Both are installed.

## Live verification
- **Job 128 since 2026-11-08** (the oldest retained `cron.job_run_details`): 354 of 354 runs `succeeded`. The longest took 2 min 38 s.
- **Recurrence:** no `DailyDigest.rake_rollup_mismatch` row since 2026-10-27 06:00Z.
- **Snapshots:** every `sp_daily_metrics` day from 2026-10-27 to 2026-11-21 has ledger = rollup.

## Hardening
1. **Regression test:** `tests/the-digest-compares-rake-against-the-rollup-as-it-stands.law.test.ts` (vitest 4.0.18).
   - With the three migrations it passes 6 of 6.
   - With them absent it fails 5 of 6.
2. **Invariant:** the digest compares the ledger against the rollup as it stands when the digest is sent, and the catch-up reads one bounded set of day facts. No later redefinition may drop either; the law enforces this.
3. **Detection:** `fn_sp_digest_attention` raises `rake_rollup_mismatch` into `operational_alert_events` with `payload.target_task_id`, and that path still runs. Failures of the catch-up job itself are routed by `fn_ca_cron_failure_watch`.
4. **CI gate:** Client Unit Tests runs every `tests/` file on every PR.
