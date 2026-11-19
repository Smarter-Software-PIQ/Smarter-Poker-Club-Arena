# 2026-11-19 Snapshot retention pages by its covered index

Three background jobs were reported as slow connection holders from
`pg_stat_statements` (cumulative since 2026-10-04). Measured on production
2026-11-19 (read-only queries, `cron.job_run_details`, statement deltas):

## 1. `sp_prune_hand_state_snapshots` (cron `sp_prune_hand_state_snapshots_2m`) - FIXED

- Cumulative: 32,936 calls, mean 14.1 s, max 119.9 s (the postgres role's
  2 min `statement_timeout`; the cron's in-statement
  `set_config('statement_timeout','30s',true)` does not arm a timeout for the
  statement already running).
- `job_run_details`: 2026-11-18 11:00-20:00 UTC every run took 20.0 s (the
  function's budget), then 0.1-0.3 s once the pass reached the eight-day bound.
- Cause: about 627,000 expired snapshots (oldest 2026-09-18) hold no
  `horse_adaptive_disposal_certificates` row, so every one is refused. Each
  pass wraps and revisits them (correct: a refused witness may become
  disposable), but it did so one row at a time: a heap fetch per candidate
  (only a `created_at` index existed; a 10,000-row page read 11,642 heap
  blocks, 4.75 s) and one DELETE statement per row, which on the native
  fixture also evaluated `horse_snapshot_disposable` for uncertified rows
  (2,999 calls to delete 300 of 3,000).
- Fix (`20261119173316`): covering index `(created_at, id) INCLUDE
  (table_id, hand_number)` built CONCURRENTLY in the sanctioned preamble, and
  the function works set-based in sub-pages of 1,000: index-only page read,
  certificate and permit semi-joins, then the unchanged full DELETE predicate
  for certified rows only. Same rows deleted, same cursor, wrap, budget,
  `p_batch` bound, ACL. Proof:
  `scripts/ci/test-snapshot-retention-pages-by-covered-index.py`
  (workflow `snapshot-prune-reads-its-age-bound.yml`).

## 2. `sp_drain_daily_challenge_event_outbox` - no defect in its own path

- Cumulative mean 1.9 s is dominated by the pre-2026-10-03 era (each shard ran
  its full 45 s budget chasing arrivals, fixed by "a drain drains what was
  pending"). Last 3 h: per-shard mean 0.37-0.57 s; outbox 359 pending rows,
  0 dead-lettered.
- The remaining tails (19 s, 30 s, 57 s, 70 s on 2026-11-13..16) all start at
  06:40 UTC and end together with every other job started that minute
  (`ca-diamond-prune-history-daily`, `ca-ledger-replay-nightly`,
  `rake-law-adherence-hourly`; one "job startup timeout"): pg_cron start-up
  contention, not drain work. Not changed here.

## 3. `fn_prune_horse_adaptive_journal` (engine, PostgREST) - backlog drained

- Cumulative 230k calls, mean 1.9 s, max 8.0 s came from the October backlog
  drain. Now: nothing pending (`horse_adaptive_disposal_certificates`
  pending = 0, membership pending = false, activation cursor idle); the engine
  calls it a few times in 5 minutes, measured delta mean 228 ms. Not changed.

## Also found (not in this change)

- `sp_prune_hand_history` (cron 117, the other advisory-lock statement,
  190k calls, mean 9.0 s): its per-page cost is the deep accounting witness
  `horse_cash_retention_accounting_ready` -> `fn_pnl_cash_hand_evidence`
  (about 22 ms per captured cash hand; 2.2 s cold for a 250-row page). About
  3 million expired horse-only hands (2026-10-04..2026-11-11) are retained
  because their `cash_hand_provenance_receipts` are `uncertified` with
  `original_dealt_manifest_missing`; a page of those costs 40 ms. The
  retention gap is an accounting-provenance question, not a query defect,
  and was left for its owner.
