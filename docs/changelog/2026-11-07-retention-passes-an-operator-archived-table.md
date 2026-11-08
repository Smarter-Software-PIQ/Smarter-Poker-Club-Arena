# 2026-11-07 - Retention Passes An Operator-Archived Table

Asked after three of four `fn_lightning_instance_begin_dealing` timeouts (01:31, 12:53, 19:08 UTC) coincided with `sp_prune_hand_history` batches of 14-22 s.

## Measured

- `cron.job_run_details` for job 117 (every 10 s): from 19:56:38 UTC every run failed, 896 runs, ~4.2 s each, with `TOURNAMENT_HAND_ARCHIVED_BY_OPERATOR` raised by `smarter_private.tournament_abort_archived_write_guard` from `compact_settled_horse_requests` inside `hand_submission_retention_disposal`. The guard refuses writes on the 25 tables holding a `tournament_abort_hand_dispositions` row (archived 2026-11-05); the cursor's page (250 hands from 2026-10-29 04:45) held one such hand, so the page rolled back and the cursor never moved.
- Backlog: 938,846 hands past the eight-day boundary (cursor 2026-10-29 04:45, boundary 2026-10-30 22:34). Inflow ~500k hands/day (~6/s). A job behind its boundary runs full pages back to back, which is the continuous 10-20 s load.
- One page profiled on production inside a rolled-back block (199 hands): selection 1.8 s (820 ms of it the restoration-case anti-join: 245 cases x 200 hands = 49,000 `jsonb_array_elements` calls), disposal 3.7 s (stats basis 1.2 s, request payload clear 1.3 s, fact cards 0.9 s, adaptive 0.8 s), cash-play compaction 0.75 s, settlement keys 0.44 s, index archive 0.28 s, both deletes under 0.2 s. No missing foreign-key index: the only unindexed child (`ca_hand_notes.hand_id`) is empty.

## Fix (migration 20261107224000)

- Candidates exclude a hand of a table with a `tournament_abort_hand_dispositions` row. It is the operator's record and the guard refuses its writes anyway; the scanned page still advances the cursor past it.
- The restoration-case citations are read once per page (`cited` CTE). Same cases, kinds and text comparison.
- Everything else is byte-identical: the post-image check restores these bytes and reproduces the installed md5 `1b2f59cf...`. Job 117, its command and its 10 s cadence are unchanged.

Rehearsed on production inside a rolled-back block: two consecutive pages deleted 194 and 199 hands in 6.4 s and 9.2 s and moved the cursor past the archived hand. At ~25 hands/s against ~6/s of inflow the backlog clears in roughly half a day, after which each run handles ~60 hands (~2 s).

Not changed here: the per-hand cost of the horse compaction helpers (stats basis, fact cards, request payload clear), which belong to the Horse Brain retention work.
