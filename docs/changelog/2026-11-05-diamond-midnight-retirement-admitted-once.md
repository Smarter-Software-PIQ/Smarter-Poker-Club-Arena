# 2026-11-05 - The Diamond Midnight retirement is admitted once and proves its hands cheaply

Owner, 2026-11-05 15:04 Chicago: "OVERRIDE THE 4 AM RULE FOR THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW".

Why #9573 did not land the closure: #9567 (20261105200238) replaced the whole
bulk_closure_admission body after #9573's text patch, so the waiver vanished
(probe 22:08:33 UTC: bulk_closure_large_outside_quiet_hours). And the door could
not finish inside any ceiling: fn_ca_owner_retire_tournament md5'd the event's
1,744 hand rows (~5 MB of jsonb) twice, and the receipt validator a third time:
4.95 s cold, 2.11 s warm each, against a 2 s live hold bound.

Fix (migration 20261105221247):

- `smarter_private.bulk_closure_owner_exceptions`: an append-only owner
  authorization per exact (kind, target set) that waives only the size rule,
  expires, and is consumed inside the closure's own transaction (a rollback
  restores it; a commit spends it forever). One row: owner_retire of
  6429087f until 2026-11-06 10:00 UTC.
- `bulk_closure_admission` re-asks every other rule (break window,
  maintenance, resume settling, unbounded caller, 2 s live hold, cooldown).
- `smarter_private.hand_history_fingerprint`: id + xmin of every hand row,
  20 ms instead of 2,100 ms. Same detection (insert, delete, any update).
  Receipts written before keep the whole-row comparison.

Probe (rolled back, 22:20 UTC): anchors found exactly once/twice/once and all
three patched bodies compile.
