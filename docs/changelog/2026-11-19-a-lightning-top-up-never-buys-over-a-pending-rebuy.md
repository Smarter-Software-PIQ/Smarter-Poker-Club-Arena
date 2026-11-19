# A Lightning top-up never buys over a pending rebuy (2026-11-19)

**Defect.** Every unresolved Lightning feeder rebuy found on 2026-11-19 (PR #11340) was a double purchase. At one hand boundary `fn_lightning_auto_rebuy` debited a pending 400 rebuy, and 1-7 s later `fn_lightning_top_up_request` debited a second 400 and landed it on the seat. The auto-rebuy door already refused while an add-on was pending. The top-up door checked only its own intents.

**Fix.** Migration `20261119050653_a_lightning_top_up_never_buys_over_a_pending_rebuy` adds one refusal to `fn_lightning_top_up_request`, right beside its existing "already pending" refusal and before any intent row or debit. While the caller has an unresolved `table_pending_addons` row on the table, the door answers `{success:false, error:'A Rebuy Is Already Pending For This Seat'}`. The patch is applied to the live body, asserting its pre-image md5. Browser and horse top-ups use the same door, so it is one rule for everyone (10.5). The reverse order was already safe: once a top-up has landed, the auto-rebuy reads the funded stack and refuses NOT_TRIGGERED.

**Delivery.** This is a database function change. It goes live when Apply Merged Migration installs it after merge, not at the 04:00 engine cutover. No engine code changed: the engine already treats a status-less `success:false` as a refusal.

Law: `tests/a-lightning-top-up-never-buys-over-a-pending-rebuy.law.test.ts`.
