# A union statement can carry a charge note (2026-11-15)

Migration `20261115205250_a_union_statement_can_carry_a_charge_note.sql`.
Not to be installed before 2026-11-16 18:00Z (after Monday's payout and
statement issue).

## What was missing

A union could correct an issued weekly statement only downward, with a credit
note. The D1 settlement (`20261115151824`, see
`2026-11-15-union-statements-are-delivered-and-owe-what-they-say.md`) therefore
left one correction undone: MIDWAY-2026-000034, KINGS CLUB, week of
2026-10-26, was billed 43.86 too little.

## What this adds

A **charge note** (invoice type `union_weekly_debit_note`), the credit note's
twin: `public.fn_union_issue_debit_note(invoice, amount, reason, notify)`.
Same caller rule as the credit note (union owner, union admin, platform admin,
or the server), amount above zero in whole cents, a reason, only against a
weekly square-up the club owes the union, numbered from the same union counter
(MIDWAY-2026-0000NN), delivered to the club and the union on insert like every
statement, same grants. The original statement is never changed. An identical
second charge note is refused.

Everything that reads credit notes now also reads charge notes. What a
statement owes is the statement, less its credit notes, plus its charge notes
(cancelled notes count for neither):

- `fn_union_invoice_outstanding` (read by the board, the overdue reminders and
  the stop-loss), `ca_union_set_statement_paid`, `ca_union_statement_board`
  (now also returns `charge_notes`), the statement message body, and the credit
  note's own limit;
- the deliverer, the inbox conversation list, the club message door and the
  club statement of account (entry `debit_note`, "Charge note against ...");
- the Union Statements page: "Charge Note" line beside "Credited By", "After
  Charge" in Amount Due, and a `charged_by` CSV column.

With no charge note on a statement, every reader returns what it did before.

## The 000034 charge note

Re-derived read-only from production (Bad Beat Jackpot wallet shares paid from
Midway pools in the week, wallet club against the hand's earning club):

|                                                                             |   Chips |
| --------------------------------------------------------------------------- | ------: |
| Shares played through The Felt Society counted on KINGS                     |  806.26 |
| KINGS shares counted on Felt (106.25) and the union house (261.45)          | -367.70 |
| Net player wins wrongly on KINGS                                            |  438.56 |
| KINGS cash profit 937,483.89 -> 937,922.45; cash ECO 93,748.39 -> 93,792.25 |   43.86 |

The migration re-derives 438.56 and 43.86 from the rows when it installs and
aborts if either moved, then issues one 43.86 charge note against 000034.
Owed on 000034: 110,114.30 + 43.86 = 110,158.16.

Rolled-back production rehearsal (whole migration plus checks in one
transaction ending in an error, nothing kept): every patched body passed
`plpgsql_check` with no findings; the charge note was numbered, delivered to 2
recipients and read "KINGS CLUB Pays Midway Union 43.86 Chips More"; 000034
owed 110,158.16 on the board, in the outstanding reader and when marked paid;
no other statement or credit note changed in any reader or on the board.

## Mark Paid works on a delivered union statement again

Found while rehearsing this file: `ca_union_set_statement_paid` records a
payment in `breakdown` (`paid_total`, `paid_at`, `paid_by`, `payments`), and
the issued-document guard `fn_accounting_document_immutable` froze the whole
`breakdown` of a delivered document, so Mark Paid failed with
`issued_accounting_invoice_is_immutable` on every delivered union statement
(every Midway statement since 2026-11-15).

Fix, in the same migration: for `union_weekly_squareup`,
`union_weekly_credit_note` and `union_weekly_debit_note` only, the guard
compares `breakdown` without those four keys. Every other column, every other
breakdown key and every other document type keep the exact rule they had.

Rolled-back production rehearsal: before the migration, Mark Paid on 000034
was refused; after it, part payment (100,000.00), full payment (110,158.16,
status paid, 2 payments recorded, still marked delivered) and reopening all
succeeded. Changing another breakdown key, the amount, the notes or the due
date of 000034 was still refused, and so was a payment key on a delivered club
weekly accounting document. `plpgsql_check` found nothing in the patched guard.
The native test covers the same cases.

The captured copies of the old guard in older test fixtures
(`scripts/ci/fixtures/rakeback-cascade-real-*`,
`scripts/qualification/approved-agent-adjustment/fixtures/*`) are dated
snapshots that load their own body and md5 together; they do not check
production and are left as captured.
