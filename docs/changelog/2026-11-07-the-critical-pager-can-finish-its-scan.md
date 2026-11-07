# 2026-11-07 - The Critical Pager Can Finish Its Scan

Found while tracing the 2026-11-07 Lightning join failures: `POST /rpc/fn_sp_critical_scan` returned 500 on every call (every five minutes, at :x0:45 and :x5:45) in the retained logs, from at least 2026-11-06 00:50 UTC to 2026-11-07 20:25 UTC, 483 calls. Postgres logged `canceling statement due to statement timeout` for each (service_role `statement_timeout` is 8 s). `sp_critical_pages` has no page after 2026-11-03 07:15 UTC. The pager that texts and emails the owner about ledger breaks, unexplained chip supply, stuck tournaments, payment failures and the Midway Free Buy board was blind.

## Cause

Probed branch by branch on production (rolled back): every branch of the scan takes milliseconds except `fn_sp_midway_free_buy_watch()` (3.7 s), and inside it the promo runway's 7-day sum over `chip_ledger` (26M rows, 29 GB): 4.6 s under EXPLAIN ANALYZE. Its legs are keyed by label and type, but the only usable indexes are `from/to_entity_id`; the union's wallet row receives 628,543 legs a week under other labels, so the read heap-read 159,043 blocks and discarded 626,384 rows to keep 8,421. The runway watch arrived on 2026-11-05 (20261105183114, 20261105233756).

## Fix

Migration 20261107203405 builds `idx_chip_ledger_union_promo_runway_legs` concurrently (the sanctioned preamble, as 20261107134957): partial on exactly the runway's three leg shapes, keyed by `created_at`, covering every column the read touches. The planner proves the read implies the predicate (checked on a 200,000-row probe: Index Only Scan). The transaction refuses a missing or INVALID build and refuses unless `EXPLAIN` of the runway read names the index. The pager function and its rules are unchanged; no budget was raised and nothing was scheduled.

## Missed pages

None found for the window: since 2026-11-05 18:00 UTC there are no ledger invariant findings, no supply snapshot past the 100-chip threshold, no tournament RUNNING over 12 hours and no failed Stripe webhook. Midway board findings will page on the first completed scan, as designed.

Law test: `tests/the-critical-pager-can-finish-its-scan.law.test.ts`.
