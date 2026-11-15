# 2026-11-15 - union invoice views subtract credit notes from what is unpaid

Follow-up to #10897 (owner specification 2026-11-14, item 8), from the
independent review of its merged head. Presentation only: no stored invoice,
amount, number, status or delivery flag is written and nothing is sent.

- The sign sentence (Union Statements and the Messenger body) no longer lists
  "Less Club Rakeback Credit" among the lines where positive means the club
  pays: the rakeback credit is the rakeback the union paid the club,
  subtracted in the full weekly net.
- "Remaining Unpaid Balance" is the amount after credit notes less recorded
  payments, on the board (`ca_union_statement_board` per-row and total
  `outstanding`, migration `20261115030918`), in the parser
  (`remaining_unpaid`), in the CSV (`remaining_unpaid_balance`) and in the
  Messenger body ("Paid So Far" when a payment exists, then "Remaining Unpaid
  Balance").
- The Clubs Owe / Union Owes tiles and the net subtract credit notes, and
  Still Outstanding is the sum of the rows' remaining unpaid balances when
  every row can state it. The week ending 2026-10-05, whose two square-ups
  were credited in full, now reads 0.00 owed instead of 250,168.95.
- The component test runs the real spreadsheet escaping.

Read 2026-11-15: no union square-up carries a `paid_total`; the eight
credited square-ups are fully credited; none of the five rows for the week
ending 2026-11-09 has a credit note, so their figures are unchanged.

Law: `tests/union-invoice-views-show-the-week-and-who-pays.law.test.ts`.
Native body regression: `scripts/ci/test-union-invoice-body.py` (now applies
this migration's body patch to the body 20261115011424 installs).
