# An ended seat settles its pending add-ons (2026-11-19)

**Defect.** `table_pending_addons` held 49 unresolved 400.00 rebuys (19,600.00 debited), every one a horse on a 1/2 Lightning Games feeder (anchor) table, oldest 2026-11-05 06:26 UTC. Each had its wallet debit leg and funding receipt; none had an application receipt or an `addon_refund:<id>` key. `resolve_pending_addon` is the only writer that lands a pending row on a stack and stamps it resolved in the same transaction, so none was applied.

**Cause.** A pending add-on's only consumers are driven by the table's engine. A Lightning anchor never deals, and its halted pass (`passWhileDealingHalted`) asks the resolver only for a seated player whose stack reads 0. At the same boundary the Lightning horse top-up door charged and landed a second 400 directly, the seat was no longer at 0, and the row lost its last consumer; tonight's example also lost its window to 63 resolver failures on the promo-grant NOWAIT lock. When the seat ended, no exit path looked at `table_pending_addons`: the cash-out moved the stack only.

**Fix.** Migration `20261119013426_an_ended_seat_settles_its_pending_addons`: the function behind the existing ended-occupancy triggers (`smarter_private.fn_record_ended_seat_occupancy`) now, when the player's last open chair at that table ends, locks and resolves every unresolved add-on of theirs there through `resolve_pending_addon` (vacated-seat refund keyed `addon_refund:<id>`), skipping only rows frozen in an open hand envelope (the post-commit processor owns those). No SKIP LOCKED, no swallowed error: a failed refund rolls the exit back. A function body replacement takes no lock on `table_seats`.

**Settlement.** Probed in one self-aborting DO block: 44 rows with no open seat, applied 0.00 / refunded 17,600.00, deferred constraints passed. The migration asserts that board (aborts if any probed id moved) and settles it through the same path, plus any row whose seat ended after the probe with the same evidence. The 5 rows whose player is seated at that table now are settled by the new body when that seat ends, or delivered by the engine first.

**Not changed (reported).** The Lightning top-up door charging while an auto-rebuy is still pending is a separate defect.

Law: `tests/an-ended-seat-settles-its-pending-addons.law.test.ts`.
