# Union statements are delivered, owe what they say, and settle the misplaced jackpot shares (2026-11-15)

Audit findings G3, G4, G5 and the settlement for D1, Midway Union.

## G3 - "Delivered" that was never delivered

MIDWAY-2026-000020..041 (22 square-ups, weeks of 2026-10-05 to 2026-11-02) read
`message_sent = true` and the Union Statements board counted them Delivered, but
`accounting_invoice_deliveries` held no row for any of them. Until 2026-11-14 the
deliverer recorded every non-cashout document "in transaction history only and
marked delivered"; 20261114163249 sent new statements but nothing already issued.
The flag also freezes the square-up upsert, so it is not simply cleared.

Fix (`20261115151821`): a union square-up or credit note is marked sent only when
a recipient was reached; the board reads delivery from the delivery record; the
17 club statements in 000020..041 are delivered once now (rolled-back probe: each
reached 1 or 2 recipients). The five union house rows (000021, 025, 030, 035,
040) are statements to the union itself and stay record-only.

Note for the union: the 2026-11-14 migration header said the week ending
2026-11-09 (000037..041) would be validated before delivery. The 2026-11-15
audit is that validation; its one finding in that week (212.51 of KINGS jackpot
shares on the union house row) is corrected by credit note 000039 below, so the
week is delivered with its correction.

## G4 - Paid ignored credit notes

`ca_union_set_statement_paid` owed `abs(net_amount)`. It now owes the statement
less every non-cancelled credit note that adjusts it, never below zero. Marking a
statement paid records the union admin's own confirmation of a settlement made
outside the platform (cash or chips); there is no in-platform money movement to
match it against, so that requirement is unchanged.

## G5 - Due before issued

`due_at` was week end + 3 days. The week of 2026-10-19 was issued 2026-11-08
22:45 UTC due 2026-10-29, the week of 2026-10-26 issued 2026-11-10 16:05 due
2026-11-05: ten statements overdue at birth. Now `greatest(week end, issue time)
+ 3 days`. The issuance lag came from the close's 240 s tick budget on job 272
(130-282 attempts per week); 20261114163249 runs the close every two minutes on
payout day (cron `weekly-union-books`), first effective at the Monday 2026-11-16
close. Issued due dates are not edited.

## D1 settlement - credit notes for the misplaced jackpot shares (`20261115151824`)

Root fix: `20261115150131_a_jackpot_share_follows_the_hand_club.sql`. ECO is
`round(-0.10 * club profit, 2)` per activity; a jackpot share is a player win.

| Statement | Club | Week | Correction | Credit note | Remaining |
| --- | --- | --- | --- | ---: | ---: |
| 000031 | Felt | 2026-10-19 | profit 1,278,697.63 - 5,648.85 | 564.88 | 127,304.88 |
| 000029 | KINGS | 2026-10-19 | profit 1,306,890.01 - 176.56 | 17.65 | 130,671.35 |
| 000036 | Felt | 2026-10-26 | cash profit 1,022,192.94 - 2,124.83 | 212.48 | 118,743.25 |
| 000039 | KINGS | 2026-11-02 | cash profit 33,971.59 - 212.51 | 21.25 | 6,021.71 |

Total 816.26 credited through `fn_union_issue_credit_note` (new numbered
documents, originals unchanged), delivered on insert after the statements.

Not settled, with reason:

- 000034 KINGS, week of 2026-10-26: KINGS carried 438.56 of shares that belong
  to Felt and was billed 43.86 too little. The union has no debit-note document;
  a credit note can only reduce. The union may collect it with its next
  statement or a presettlement entry; nothing here invents a charge.
- Union house rows 000030 (week 10-19, 5,825.41 of shares belonged to Felt and
  KINGS), 000035 (10-26, 1,686.27) and 000040 (11-02, 212.51): statements to the
  union itself, no counterparty.
- The chips: 27 of the 28 wrong wallets no longer hold the share; the one that
  does (106.25, a Felt wallet, earned in KINGS) would move into a suspended
  membership. Players keep what they were paid (10.9 rule 3).
