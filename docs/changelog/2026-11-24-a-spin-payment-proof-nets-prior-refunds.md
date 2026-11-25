# A Spin's payment proof nets prior pre-start unregistrations (2026-11-24)

## Incident

- **Reliability incident:** `3c817b04-bc3a-4bc5-aa43-b2eee257584d` (`SpinFleetProducingNothing`, critical, `spin_lifecycle`, inbox events `448694..448706`).
- **Observed production failures (`engine-01`):**
  - Board `3b4c6299-ab1a-4297-b36a-891c980c8ff2` ("5 Chip Deep Stack Spin NLH"): **131** refusals with `{"ok": false, "seats": 3, "reason": "three_paid_seats_required", "paid_users": 2, "seat_users": 3, "buyin_total": 20.00, "buyin_debits": 4}` (after a player unregistered and re-entered), followed by **45** refusals with `paid_users: 3, buyin_total: 25.00, buyin_debits: 5` (after a second unregistration). Triggered `SpinFleetProducingNothing` at `8734s` until `fn_spin_expire_unfilled` cancelled it at `9935s`.
  - Board `935e11b9-77de-490b-94eb-138196e8c7f5`: **30** refusals with `{"ok": false, "seats": 3, "reason": "three_paid_seats_required", "paid_users": 3, "seat_users": 3, "buyin_total": 12.00, "buyin_debits": 4}` plus two `spin_seat_first_fill` runbook attempts (attempts 4 & 5) that both returned `door_refused / raised` with `SQLERRM` dropped. Triggered `SpinFleetProducingNothing` again at `9808s` until unfilled expiry cancelled it at `20:23Z`.

## Root cause

Pre-start Spin unregistration (`fn_ca_unregister_tournament_player_exact`, `start_authority = 'spin_actual_start'`) deletes the player's `tournament_players` row, marks `table_seats.left_at`, consumes their `tournament_refund_entitlements` row via `tournament_refund_tranches`, and writes a matching `credit` (`refund`/`tournament_refund`) row to `wallet_transactions`. Because `wallet_transactions` is append-only, the original `debit` (`tournament_buyin`) row remains permanently.

Four Spin payment proofs assumed historical debit/entry rows equalled live active seats without netting prior refunds:

1. `public.fn_spin_book_entry(uuid)` (called on seat 3 by `fn_sync_seat_first_player_count`, and by `fn_spin_draw_and_settle_atomic`)
2. `public.fn_spin_draw_and_settle(uuid, jsonb)`
3. `public.fn_prove_played_spin_launch_recovery(uuid)` (chip arm)
4. `public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)` (Diamond arm)

Additionally: 5. `smarter_private.reliability_runbook_spin_seat_first_fill(uuid, boolean, jsonb, timestamptz)` captured `SQLERRM` into `v_res->>'error'` on raised exceptions, then omitted it when recording `door_refused`.

## Fix and hardening

- Anchored SQL migration updates all five functions in one atomic transaction with `-- @probe-for:` execution probes for every function and post-install ACL/content checks.
- All four Spin payment proofs now compute net paid entries (debits minus `refund`/`tournament_refund` credits for chip Spins; excluding `kind = 'refund'` / refunded-released custody rows for Diamond Spins) while failing closed if any non-rostered user retains a non-zero net balance/entry count or if a Diamond custody was released without a recorded refund.
- `smarter_private.reliability_runbook_spin_seat_first_fill` records `last_error` whenever the seat door raises an exception.
- Hardened by required Vitest law `tests/a-spin-payment-proof-nets-prior-refunds.law.test.ts` (registered in `docs/laws.d/`) and native PostgreSQL 17 fail-before / pass-after / fail-closed proof `scripts/ci/test-spin-entry-net-paid-postgres.py`.
