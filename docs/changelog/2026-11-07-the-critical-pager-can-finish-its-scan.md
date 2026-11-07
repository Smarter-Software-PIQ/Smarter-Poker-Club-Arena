# 2026-11-07 - The Critical Pager Can Finish Its Scan

Found while tracing the 2026-11-07 Lightning join failures: `POST /rpc/fn_sp_critical_scan` (called every five minutes) failed with `canceling statement due to statement timeout` (service_role `statement_timeout` is 8 s) on 270 of 288 calls in the 24 hours to 2026-11-07 21:20 UTC (94%), counted from `edge_logs`, which record every status; at least 483 failures in the retained PostgREST logs back to 2026-11-06 00:50 UTC. The 18 calls that finished could still page (two Midway pages went out at 20:40 UTC), but on most five-minute ticks the pager that texts and emails the owner about ledger breaks, unexplained chip supply, stuck tournaments, payment failures and the Midway Free Buy board did not run to completion.

Correction (same day): the first version of this note said every call failed and that no page had been recorded since 2026-11-03. PostgREST logs only failures, so the success count came from `edge_logs`; and the 20:40 pages were written after that first reading.

## Cause

Probed branch by branch on production (rolled back): every branch of the scan takes milliseconds except `fn_sp_midway_free_buy_watch()` (3.7 s), and inside it the promo runway's 7-day sum over `chip_ledger` (26M rows, 29 GB): 4.6 s under EXPLAIN ANALYZE. Its legs are keyed by label and type, but the only usable indexes are `from/to_entity_id`; the union's wallet row receives 628,543 legs a week under other labels, so the read heap-read 159,043 blocks and discarded 626,384 rows to keep 8,421. The runway watch arrived on 2026-11-05 (20261105183114, 20261105233756).

## Fix

Migration 20261107203405 builds `idx_chip_ledger_union_promo_runway_legs` concurrently (the sanctioned preamble, as 20261107134957): partial on exactly the runway's three leg shapes, keyed by `created_at`, covering every column the read touches. The planner proves the read implies the predicate (checked on a 200,000-row probe: Index Only Scan). The transaction refuses a missing or INVALID build and refuses unless `EXPLAIN` of the runway read names the index. The pager function and its rules are unchanged; no budget was raised and nothing was scheduled.

## Missed pages

None found for the window: since 2026-11-05 18:00 UTC there are no ledger invariant findings, no supply snapshot past the 100-chip threshold, no tournament RUNNING over 12 hours and no failed Stripe webhook. Midway board findings will page on the first completed scan, as designed.

## Installed

Merged in #9944 (9be236f0c1c), applied by Apply Merged Migration run 42415069095 (success): `idx_chip_ledger_union_promo_runway_legs` valid and ready, 3.7 MB; `supabase_migrations.schema_migrations` holds 20261107203405. `fn_sp_midway_free_buy_watch()` measured 39 ms after install (3.7 s before). The pager's calls at 21:25:37 and 21:30:37 UTC returned 200.

Law test: `tests/the-critical-pager-can-finish-its-scan.law.test.ts`.
