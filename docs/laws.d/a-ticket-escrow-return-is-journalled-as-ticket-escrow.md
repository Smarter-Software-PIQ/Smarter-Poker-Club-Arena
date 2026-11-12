# tests/a-ticket-escrow-return-is-journalled-as-ticket-escrow.law.test.ts

A door that moves a cashier ticket's value out of ticket escrow journals it under a ticket category (ticket_issue, ticket_redeem, refund), never escrow_hold or escrow_release, which fn_ca_tally_ledger_leg counts against cashout custody; otherwise the ticket_escrow store moves with no leg and the transaction is refused at commit (20261112185222, operational alert 377197).
