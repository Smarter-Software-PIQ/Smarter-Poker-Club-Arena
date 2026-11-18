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

## Damage and reconciliation (read-only, production, 2026-11-12 ~19:15 UTC)

- Refusal 69 (txid 3040598568, 18:40:12, the -5.00 alert: a hand-written promo
  ticket issue acting as user 69f2cefa) and refusal 70 (txid 3040652945,
  18:41:46, the -35.00 refusal: the real Cancel on ticket fb30d8bd acting as
  its issuer 7e616640): `txid_status` reports both `aborted`.
- Ticket fb30d8bd is still `issued` at 35.00. Its issuer's wallet reconstructs
  exactly from the journal: 680.39 after the 18:31:05 issue (equal to the issue
  receipt's `issuer_balance_after`), 680.39 at probe 69, 715.39 at probe 70 (the
  one leg between them is an ordinary 18:40:53 agent send of 35.00), 320.39 now
  after ordinary prizes and a 400.00 buy-in at 18:54. Probe 69's agent promo
  wallet (500.00) was last written at 17:57, before the probe. No
  `probe:` idempotency key, no ticket issued by 69f2cefa today, and no escrow
  leg between 18:38 and 18:43 exist. Nothing persisted; nothing to settle.
- Bounds of "never cancelled": `chip_transactions` (oldest row 2026-03-04) holds
  no `tournament_ticket_cancel` receipt. One ticket carries status `cancelled`:
  364362d9, 50.00, note "audit test", created and cancelled 0.66 s apart on
  2026-08-21, with no ledger leg, before the ledger invariant existed.
- The closed-target issuer return has never fired: no `financial_alerts` row
  from `fn_ca_settle_closed_cashier_entry_tickets`, and no issued ticket bound
  to a closed target.
- Every `ticket_escrow` refusal on record (counters 5, 6 on 2026-10-12; 69, 70
  today) came from `application_name = mgmt-api` (management API probes). The
  two October ones are a different shape (ledger with no balance) and outside
  this incident.

## Production-testing incident

Probes 69 and 70 were `DO $probe$` blocks sent through the management API
(`POST /v1/projects/:ref/database/query`, token `pat:6348438`) that set
`request.jwt.claims` to impersonate two club users and called money paths on
production, including the real Cancel on a funded 35.00 ticket. CLAUDE.md 11.5
requires such a probe to abort inside one self-raising DO block, which these
did (the trailing `RAISE EXCEPTION 'PROBE ...'`), but the ledger refusal
recorder commits outside the rollback by design, so each probe still filed a
critical drift incident and paged the owner. The probe shape matches the work
in PR #10620 (promo chips fund cashier tickets, opened 18:54 UTC). Recorded
there and on #10622; no probe was repeated for this fix.

## Fix

`20261112184950` changes the issuer refund category to `refund` in both
functions (anchored replace, asserted once each). The leg then resolves to
`ticket_escrow`, exactly like `ticket_issue` and `ticket_redeem`. A function
another lane already rid of `escrow_release` (#10620, #10622 fix the same
doors) is left unchanged, so landing order cannot strand the settler.

Executed proof (`scripts/dev/test-ledger-invariant.sh`, CI "Accounting
transactions (PostgreSQL 17)" shard 1): the two production bodies are installed
verbatim (prosrc md5 122b8276..., 1ad8c108...); the Cancel is refused with the
incident's exact message `account=ticket_escrow balance_delta=-35.00
ledger_net=0.00`; the closed-target issuer return is refused at commit,
outside its own handler; both leave nothing behind. The migration file then
runs, and the Cancel (issuer +35, one refund leg from the ticket's escrow, one
receipt), replay, non-issuer, redeemed, departed-issuer, mismatched-receipt,
closed-target issuer return, holder payment and second-settle cases all
behave and commit under the real invariant.
`tests/a-cancelled-ticket-refund-books-to-ticket-escrow.law.test.ts` pins the
fix and the harness stage. The cashier release canary takes the new Cancel
body hash as its `replacement_hash`.

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
