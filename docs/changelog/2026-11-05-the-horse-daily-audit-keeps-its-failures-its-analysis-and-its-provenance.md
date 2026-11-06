# The Horse Daily Audit Keeps Its Failures, Its Analysis And Its Provenance

**Incident.** From 2026-11-01 every run of `fn_run_horse_daily_audit` raised
`record "r" is not assigned yet`. The 2026-10-31 variant-mix CTE aliased
`horse_review_rollup` as `r`, the function's loop record. The engine claimed
Nov 1-4, wrote nothing, and the 07:30Z fallback failed silently four times.
The lost-audit check lived inside the failing function, and the analysis
setter dropped the Nov 1-3 analyses because their audit rows did not exist.

**Recorded here.** `20261105172255` (alias fix, first watchdog) and
`20261105202216` (watchdog for lost analysis) were applied directly during
the outage with no transaction. Their exact SQL is on main inside a
BEGIN/COMMIT envelope as `20261105230744` and `20261105230750`, marked
SUPERSEDED BY `20261105220227` and mapped by `applied-migration-aliases.json`.

**Changed by `20261105220227`.**

- `horse_daily_audit_runs`: every watchdog, fallback and backfill attempt, with
  run id, stage, error, SQLSTATE and context, surviving the failed transaction.
- `fn_horse_audit_set_agent_analysis` returns an explicit result, logs every
  submission, holds early analysis as pending (no placeholder audit row), and
  never overwrites a stored analysis. A trigger attaches pending analysis when
  the audit row lands.
- Every audit row carries `stats.provenance` (calc version, run id, mode, UTC
  period, engine versions that day, source coverage). Backfilled live-state
  sections are marked `evaluated_at_run_time`. The function is pinned to UTC.
- Watchdog retries are bounded (6 failures per day per 7 days), alerts are one
  per day and kind, and `fn_horse_daily_audit_watch_status` / the admin
  `ca_horse_audit_watch_status` report missing, failed, running, pending,
  recovered and completed per day.
- A counted stage gate turns short deck, pineapple and PLO8 silence warnings
  into `layer_no_stage` notes only while that hand type dealt zero hands.
- League legality: `illegal_actions` no longer includes truncated streets; the
  harness counts its own coercions and the brain's exception fallback; rows
  carry `engine_sha`; the audit judges each. Null means not measured.

**Proof.** Reproduced the failure on scratch Postgres 17 with the exact
pre-fix production source; the migration was exercised there end to end
(pending, attach, no overwrite, controlled failure, dedupe, retry budget,
claim release, UTC boundary under a Chicago session).
