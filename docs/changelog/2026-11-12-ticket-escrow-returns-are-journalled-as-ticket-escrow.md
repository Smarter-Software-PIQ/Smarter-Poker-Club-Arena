# Ticket escrow returns are journalled as ticket escrow

2026-11-12. Operational alert 377197 (drift incident 16ef8334).

**What was broken:** an issuer could not cancel a cashier ticket for chips.
- `fn_cancel_tournament_ticket` returned the ticket's escrow under ledger
  category `escrow_release`.
- Since 2026-10-06, `fn_ca_tally_ledger_leg` counts that category against
  cashout custody.
- So the `ticket_escrow` store moved with no ledger leg, and the commit check
  refused every cancel.
- The issuer-return branch of `fn_ca_settle_closed_cashier_entry_tickets` had
  the same defect. Its refusal at commit would have rolled back the
  transaction that closes the tournament.

**The fix:** migration `20261112185222` changes the category on both doors to
`refund`. No chip moved while the defect stood, because every refused cancel
left the ticket issued and its value in escrow.

**Pinned by:** `tests/a-ticket-escrow-return-is-journalled-as-ticket-escrow.law.test.ts`.

**Evidence:** `docs/production-alerts/evidence/377197-ticket-escrow-return-category/README.md`.
