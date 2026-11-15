# 2026-11-15 - union invoice views show the week and who pays whom

Owner specification 2026-11-14, item 8 (the five Midway Union weekly invoices
for the week ending 2026-11-09). Presentation only: no stored invoice is
rewritten, regenerated, renumbered or resent, and no amount changes.

## What was wrong

- Every surface printed the week as two UTC dates ("2026-11-02 To
  2026-11-09"): eight calendar days, no 2 AM boundary. The board
  (`ca_union_statement_board`) returned only dates.
- The Messenger body (`fn_deliver_accounting_invoice`) said "Direction: Club
  To Union", printed the period as raw UTC timestamps and appended the stored
  note "settled_in_chips already moved during the week".
- Union Statements rounded every figure under 1 to "Under 1" and printed the
  union's own house row (club_id = union id) inside the member club list.

## What changed

- `ca_union_statement_board` (patched under an md5 guard) also returns, per
  issued row, `invoice_number`, the stored `period_start_at` /
  `period_end_at` instants, payer and payee type and name (the document's
  from/to entity), `union_house`, `settled_in_chips`, `player_pnl_net` and the
  signed stored `outstanding`; and the week instants for the board and each
  history period.
- `smarter_private.union_weekly_invoice_body(invoice)` writes the Messenger
  text of a union square-up or credit note: "Week: Mon Nov 2, 2026 2:00 AM to
  Mon Nov 9, 2026 2:00 AM Chicago Time" (America/Chicago rules, never 24-hour
  arithmetic), issued by / issued to, "<payer> Pays <payee> <amount> Chips" or
  "Square, Nothing Due", every stored component digit for digit, the
  settled-in-chips split and "Amount Due Is What Remains: Combined ECO plus
  Recorded Presettlements". `fn_deliver_accounting_invoice` calls it for those
  two document types only. It runs at delivery time, so it reaches only
  deliveries made after installation; the five rows for the week ending
  2026-11-09 (message_sent, zero deliveries) are not sent by this change.
- `fn_union_issue_weekly_invoices` stores an accurate note on future
  square-ups; issued notes stay as issued.
- Union Statements: the selected week as its 2 AM Chicago boundaries; each
  document shows invoice number, week (start included, end excluded), issued
  by, issued to, who pays whom with the exact amount, due time in Chicago, the
  stored components, the settled-in-chips explanation and the amount-due
  reconciliation; the house row is listed in its own "Union House Club
  Statement" section; every figure is exact (`formatWalletChips`, two places,
  no K/M, no "Under 1"); the CSV export carries the kind, invoice number, both
  week boundaries (Chicago label and instant), issuer, recipient, payer/payee
  line and the settled split. The parser refuses a payer that contradicts the
  direction, a settled figure that is not rakeback plus player result, an
  amount due that is not ECO plus presettlements (or has the wrong sign), and
  a house flag that is not club_id = union id. All 32 stored square-ups
  satisfy those identities (read 2026-11-15).

## Settled in chips, as verified

`settled_in_chips = player_pnl_net + rakeback_due`. For the week ending
2026-11-09 the only union-to-club transfers in it were the three round-1
rakeback legs posted 2026-11-09 10:52:00Z (Deep Stack 406,985.78, Felt
409,959.09, Kings 23,268.80). `player_pnl_net` (players' result excluding the
fees they paid) was settled at the tables during the week: pots, Bad Beat
Jackpot drops and awards, tournament entries and prizes. No presettlement or
payment exists against any of the five, so each amount due is its recorded
ECO.

## Not changed here

- The club-side union statement card in `src/pages/club/ClubDataPage.tsx`
  (owned by the Club Data task, PR #10879) still prints its own period line.
- The World Hub Messenger card header (`AccountingInvoiceCard`) prints the
  breakdown's dates; its "View Invoice Details" text is the body above.

Law: `tests/union-invoice-views-show-the-week-and-who-pays.law.test.ts`.
