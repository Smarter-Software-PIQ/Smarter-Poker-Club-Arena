# A Cancelled Ticket's Refund Books To Ticket Escrow (2026-11-12)

## Incidents

- `9aaed91e-03a9-4538-b759-3652509ec531`: -5.00 chip drift: ledger_imbalance (money integrity)
- `496bda61-047a-4372-92bd-aa408cadbbf2`: ledger_invariant.refused (money integrity)
- Drift incident `16ef8334-8673-475e-b375-45b0589b36f6`, refusals 69 and 70

## What happened

At 18:40 and 18:41 UTC another agent ran two `DO $probe$` blocks through the
management API (application `mgmt-api`), acting as two club users through
`set_config('request.jwt.claims', ...)`. The second called the real
`fn_cancel_tournament_ticket` on a live 35.00 Cashier Ticket. The ledger
invariant refused both at commit and rolled them back. No balance moved.

The second refusal exposed a real defect. Both issuer-refund paths for a
ticket (`fn_cancel_tournament_ticket`, and the issuer branch of
`fn_ca_settle_closed_cashier_entry_tickets`) declared
`app.ledger_category = 'escrow_release'`. `fn_ca_tally_ledger_leg` and
`fn_ca_trial_balance` read an `escrow` leg under `escrow_hold` /
`escrow_release` as cashout custody (`cashout_escrow:<id>`), so the refund leg
landed there while the ticket float (`ticket_escrow`) dropped with no leg.
The invariant refused every such transaction: no ticket on the platform has
ever been cancelled (zero `tournament_ticket_cancel` rows), and an issuer
refund for a closed cashier entry ticket would have aborted the closing
transaction too.

## Damage

None. All four `ticket_escrow` refusals on record came from agent probes and
were rolled back; no player or agent request was ever refused. Nothing to
settle.

## Fix

`20261112184950` changes the issuer refund category to `refund` in both
functions (anchored replace, asserted once each). The leg then resolves to
`ticket_escrow`, exactly like `ticket_issue` and `ticket_redeem`.
`tests/a-cancelled-ticket-refund-books-to-ticket-escrow.law.test.ts` pins it.
The cashier release canary takes the new body hash as its `replacement_hash`.

## Also recorded: EngineCutoverMissed (incident 0cadf63e)

Not a code defect, and already closed by its own watch at 17:10 UTC when
08c27924 (containing the owed 949851f7) sealed. Two independent events:

1. The 01:00 Chicago owner window `2026-11-12-horse-corrections-engine-0700z`
   (run 43176988306) entered its table break with 257 s left, under the
   260 s candidate-and-recovery budget, refused before mutation 16 times and
   recovered f7735cca. Designed behaviour.
2. The 03:30 daily preparation belonged to run 43155291080 (the first push
   in the five-hour reservation, 04:30 UTC). The owner-window control commit
   cc07c1ae changed release controls at 06:22 UTC, so at the cutoff that run
   stopped with "Release controls changed during reservation; keep serving"
   and the 04:00 window sent nothing. The workflow states this outcome is
   final ("changed release authority or failed owner never gains a retry")
   and CLAUDE.md forbids any timer or agent from retrying a release, so the
   engine kept serving as designed.
