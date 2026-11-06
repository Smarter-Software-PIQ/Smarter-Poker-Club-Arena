# Free Buy Vouchers And Ticket Books Are Watched

Owner rules (2026-11-05): a guarantee's house/promo funding is H = max(0, G - C) and zero once C >= G; a Free Buy without a guarantee is funded H = V, one promo chip per valid first entry; five Free Buy tickets per player per gaming day, one per event. Phase 2 requires monitoring that detects both underfunding and overfunding.

Migration 20261106194903 adds `fn_ca_free_buy_funding_watch`, run every 15 minutes by `ca-free-buy-funding-watch-15m`, and `ca_free_buy_watch_findings`. It finds:

- `guarantee_overfunded` / `guarantee_underfunded`: a finalized guaranteed event (from the gross rule, 2026-11-05 22:25:02 UTC) whose posted house/promo funding differs from H, read from `fn_ca_guarantee_funding` like the 20261105233808 scan. That scan only recorded rows; this one alerts and closes them.
- `voucher_overfunded` / `voucher_underfunded`: a finalized Midway Free Buy without a guarantee whose net promo differs from its first entries. Nothing watched this before.
- `ticket_day_mismatch`, `ticket_without_entry`, `ticket_on_cancelled_event`, `entry_without_ticket`, `free_buy_without_format`: the ticket books. Nothing watched these before.

Each new finding raises one financial alert (Production Alerts), critical for money and warning for ticket books, and the alert resolves when the finding is no longer true. Detection only; nothing moves chips. A variance after finalization needs an authorized, auditable correction.

Read from production before shipping (2026-11-06 19:30 UTC): every non-guaranteed Free Buy since tickets went live held exactly one promo chip per first entry (236/236, 213/213, 170/170, 164/164); 741 ticket redemptions, 0 day-counter mismatches, 0 orphans, highest use 3 of 5; the 38 Free Buy registrations without a ticket all predate the first redemption (23:18:46 UTC), so they are the kept rollout entries. The full pass ran in 268 ms with zero findings.

Proof: `scripts/ci/test-guarantee-funding-watch.py` (native PostgreSQL 17, accounting shard 1) on production's definitions of `fn_ca_guarantee_funding`, `fn_ca_midway_free_buy_format` and `fn_raise_server_financial_alert`, including the owner's acceptance rows (non-guaranteed 250 tickets + 160 chips = promo 250, total 410; guaranteed G 500, 250 tickets, 160 chips = H 340 with no extra ticket funding, and the same event funded 340 on top of the tickets found +250). Law: `tests/free-buy-vouchers-and-ticket-books-are-watched.law.test.ts`.
