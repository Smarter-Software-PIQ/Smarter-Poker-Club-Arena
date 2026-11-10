# Table Seats Live Indexes Keep A Real Row Estimate (issue #10361)

Dan, 2026-11-10 09:46 Chicago: join, buy-in, first deal and fold-to-next-hand were all slow.

## What was measured

- Lightning's own legs were fast (fold ack ~1 ms, back to pool ~83 ms, match to hand ~300 ms, first render 61-97 ms).
  The slow minutes were bursts of a database-wide stall: up to 647 lock messages and 116 statement timeouts a minute,
  13 of 41 PostgREST backends waiting on one advisory lock.
- The lock was the settlement lane of the 495-player "Morning Free Buy (NLH)". Hand commits hold it shared and
  `fn_ca_resume_hand_submission` exclusive. The lock design is correct; what held it for 8 s was one statement.
- 1,516 of the hour's timeouts were the tournament stack cross-check in `fn_ca_settle_hand_stacks_absolute`. Its plan
  scanned the whole of `idx_table_seats_status` once per playing player of the tournament.

## Root cause

All six partial indexes on `table_seats WHERE left_at IS NULL` had `reltuples = 0`. ANALYZE samples 30,000 of
~3.14M rows; ~772 are live, so the sample usually holds none and every autoanalyze recorded zero. The planner treats a
zero-row index as free and picks it over the unique `(table_id, user_id)` index.

Same statement, same SQL, generic plan: > 15,000 ms with `reltuples = 0`; 11.5 ms after one ANALYZE at target 1000.

## Fix

`20261110160345_table_seats_live_partial_indexes_keep_a_real_row_estimate.sql`: `table_seats.left_at` statistics
target 1000, so the sample is 300,000 rows (~74 expected live rows). SHARE UPDATE EXCLUSIVE only; no logic, lock or money
path changed. `tests/unit/tableSeatsLiveIndexStatistics.test.ts` pins that no later migration lowers it.
