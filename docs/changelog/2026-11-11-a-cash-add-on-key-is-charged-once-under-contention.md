# A cash add-on key is charged once under contention

2026-11-11. Verification only. No engine, client, schema or configuration change.

## Why

The V87 Hold'em package changes when the Horse session rotator asks for a top up
at 5/10 and above. It does not change the funding door. The rotator calls
`engine.addChips`, which calls `public.atomic_table_addon` under one key per
invocation and reads `fn_cash_addon_receipt` when a reply is lost.

The isolated PostgreSQL journal run already proved the neighbours of that door:
the Horse treasury funding door under two sessions (`test_horse.py`), the rebuy
door under two sessions (`test_rebuy_receipts.py`), queued add-on settlement
(`test_post_commit_addons.py`, `test_deferred_settlement.py`) and the read-only
receipt reader (`scripts/ci/test-cash-addon-receipt-postgres.py`). The add-on
door itself was run only through a two-line stub in the shared fixture. Nothing
ran the real door and the real core together under a duplicate or conflicting
request.

## What is added

`scripts/ci/probes/chip-journal-atomicity/test_addon_receipts.py`, run by the
existing `run-isolated.sh` after the bust rebuy case. It loads the real
`atomic_table_addon` and the real
`atomic_table_addon_before_maintenance_announcement_gate` closure from migration
history, replaces the shared stub for this case only, and checks 23 cases:

- one original purchase, direct to the seat and queued: one wallet debit of the
  funding club, one wallet journal row, one ledger row, one purchase receipt, one
  funding receipt with the right club and balances, one seat credit or one
  pending row, and the other table's seat untouched;
- the identical request again returns the original balance and changes nothing;
- the replay answers from the original receipt after the seat stack changed, the
  seat was vacated or the wallet moved;
- the original key with another amount, another table or the other landing is
  refused with 22023 and changes nothing;
- a later key is a new purchase and the table maximum refuses what does not fit,
  with nothing debited;
- a failure injected at each of six tables leaves no partial add-on;
- two real sessions on one key, direct and queued: the second waits on the first
  and receives the same balance, with one debit and one landing; a conflicting
  amount on the same key is refused.

## What this does and does not show

It shows the database half: one key, one debit, one landing, one receipt, under
real concurrent transactions on PostgreSQL 17.

It does not show the engine half, which stays with the mocked-RPC cases in
`server/src/engine/AutoTopUpReplay.test.ts`. It is not a production
observation: no natural 5/10 Horse top up has been traced from its operation to
the wallet and seat. A later rotator pass mints a new key by design, so it is a
new purchase, held by the rotator's fresh seat and ledger read, the engine's
headroom including queued chips, and the table maximum checked here.

## Verified

Local, Homebrew PostgreSQL 17.11 on a private instance on the external work
volume: 23 passing cases. Before the stub was replaced the first case failed
with `Incorrect add-on transaction` (no wallet journal row, no funding receipt),
which is the assertion distinguishing the stub from the real core. Hosted: the
existing journal step in CI runs it on Linux.
