# 377197: a ticket escrow return was journalled as cashout custody

Operational alert rows: 377197 (`drift-incidents-backfill`, `ledger_invariant.refused`),
377198 (`financial-alerts-backfill`), 377199 (`owner-operational-notifications`,
the owner's `financial_incident` notification), 377200 and 377201 (incident updates).
Drift incident `16ef8334-8673-475e-b375-45b0589b36f6`, refusals 69 and 70.

## What the refusals were (read 2026-11-12 ~18:50 UTC, `ca_ledger_invariant_refusals`)

| refusal | when (UTC) | caller | store | balance_delta | ledger_net |
| --- | --- | --- | --- | --- | --- |
| 69 | 18:40:12 | an agent's rolled-back `DO $probe$` that hand-wrote a promo-wallet ticket issue (mgmt-api) | ticket_escrow | 0.00 | 5.00 |
| 70 | 18:41:46 | an agent's `DO $probe$` that called the real `fn_cancel_tournament_ticket` on issued ticket `fb30d8bd` (35.00), then `SET CONSTRAINTS ALL IMMEDIATE` | ticket_escrow | -35.00 | 0.00 |

Both were refused. Nothing committed and no chip moved. Refusal 69 is the probe's
own hand-written SQL, not a platform path. Refusal 70 is a real defect in a
player-reachable door.

## Root cause

- `fn_ca_tally_ledger_leg` (since `20261006140948_cashout_escrow_balances_with_its_own_ledger_leg`)
  counts an `escrow` leg with category `escrow_hold` or `escrow_release` against
  `cashout_escrow:<entity>`.
- `fn_cancel_tournament_ticket` (body from `20260909165629`) releases the ticket's
  escrow to the issuer under `app.ledger_category = 'escrow_release'`.
- So the cancel's leg lands on `cashout_escrow:<ticket>` and `ticket_escrow`
  moves with no leg. The commit check refuses the cancel.
- `chip_transactions` holds no `tournament_ticket_cancel` row after 2026-09-20,
  so every issuer cancel since 2026-10-06 was refused.
- The issuer-return branch of `fn_ca_settle_closed_cashier_entry_tickets`
  (`20261015132042`) has the same category. Its refusal fires at COMMIT,
  outside its per-ticket EXCEPTION block, so it would roll back the whole
  transaction that closes the tournament.

## Proof, in a self-aborting DO block (CLAUDE.md 11.5 section 2), on ticket fb30d8bd

The probe replayed the cancel's two writes once under each category and read
the session tally (`ca.ledger_tally`). It did not set constraints immediate, so
no refusal was recorded and no incident was raised:

```
refund          tally={"ticket_escrow": {"b": -35.00, "l": -35.00},
                       "player_wallet:7e616640…:a41434bb…": {"b": 35.00, "l": 35.00}}
escrow_release  tally={"ticket_escrow": {"b": -35.00, "l": 0},
                       "cashout_escrow:fb30d8bd…": {"b": 0, "l": -35.00},
                       "player_wallet:7e616640…:a41434bb…": {"b": 35.00, "l": 35.00}}
```

## Fix

Migration `20261112185222_ticket_escrow_returns_are_journalled_as_ticket_escrow.sql`:
- Both doors declare `refund`, which `fn_ca_ledger_tally_key('escrow')` resolves
  to `ticket_escrow`.
- Each body is otherwise byte-identical to production. I checked that locally:
  reverting only the edit reproduces the production md5s `d3f65b77…` and
  `cf968d9b…`. The migration pins both md5s before it replaces anything.
- No chip is moved or rewritten.

## Hardening

1. **Regression test:** `tests/a-ticket-escrow-return-is-journalled-as-ticket-escrow.law.test.ts`.
   On pre-fix main it fails and names both functions with their files. With
   the fix it passes.
2. **Invariant:**
   - The ledger invariant (`fn_ca_balance_has_its_ledger_row`, mode `refuse`)
     still refuses any recurrence at commit.
   - The law refuses any later function that writes `tournament_tickets` with
     the `escrow` counterparty under a cashout category.
3. **Detection:** a recurrence is a `ledger_invariant.refused` drift incident.
   It routes into `operational_alert_events` with `target_task_id`, as row
   377197 did.
4. **CI gate:** the law runs in Client Unit Tests (`npx vitest run tests/`) on
   every PR. `law-registry` is green.
