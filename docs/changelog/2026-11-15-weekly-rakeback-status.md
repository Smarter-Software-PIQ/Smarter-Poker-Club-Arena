# Union owners can watch the weekly rakeback payout, stage by stage (2026-11-15)

The Union Statements page has a new Weekly Rakeback Status section. It shows
the current week's Monday payout (4:00 AM Chicago time) or, between runs, the
most recent one, in seven steps: Preparation, Clubs Paid, Agents Paid,
Players Paid, Statements Sent, Invoices Match Club Data and Books Closed. It
names the exact accounting period with its time zone (2:00 AM America/Chicago
Monday to 2:00 AM America/Chicago the next Monday).

Each step's word comes only from what the system recorded:

- Done and Failed only from records (round receipts, delivery rows, Club Data
  check rows, the book close row).
- Late only after a deadline the payout itself enforces: a booked payout
  run's money deadline (booked time plus 20 hours), or the automatic payout
  window closing 24 hours after the run time.
- Not Finished Yet, with the run time and the time elapsed, when the run
  time has passed and no such deadline has (Statements Sent has none, so it
  is never Late).
- Not Checked Yet for Invoices Match Club Data and Books Closed until a check
  row or a successful close row exists. They are never green by default.

Below the steps it lists that week's statements: number, club, who owes
whom, amount, whether it was delivered, whether it matches the Club Data
screen, and any credit note.

While the payout is running the section refreshes once a minute; otherwise
it never refreshes on its own.

It reads from a new function, `ca_union_weekly_rakeback_status` (migration
`20261116020505_weekly_rakeback_status_for_union_owners.sql`), which only
the union owner or a platform admin can call, the same rule as the
statements board. It only reads, with short time limits, and takes no lock
that could hold up the payout.

Production records (read only) for the week ending Nov 9: clubs paid
840,213.67 to 3 clubs, agents paid 695.49 to 20 agents, players paid
642,268.52 to 1,339 payees, statements MIDWAY-2026-000037 to 000041 with all
four club statements delivered, no Club Data check rows (so Not Checked
Yet), books closed Nov 11.

Tests: `scripts/ci/test-weekly-rakeback-status-postgres.py` (native
PostgreSQL 17, run in the required Accounting transactions job, shard 2), `tests/components/weekly-rakeback-status.test.tsx` and
`tests/weekly-rakeback-status.law.test.ts`.
