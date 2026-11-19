# tests/an-ended-seat-settles-its-pending-addons.law.test.ts

A cash pending add-on never outlives its seat: when a player's last open chair at a table ends, the ended-occupancy trigger hands every unresolved add-on of theirs there (not frozen in an open hand envelope) to resolve_pending_addon, which refunds the whole debit under addon_refund:<id> in the leaving transaction, waiting on locked rows and never swallowing a failed refund (2026-11-19, 49 stranded Lightning feeder rebuys).
