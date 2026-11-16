# Union owners can watch the weekly rakeback payout, stage by stage (2026-11-15)

The Union Statements page has a new Weekly Rakeback Status section. It shows
the current week's Monday payout (4:00 AM Chicago time) or, between runs, the
most recent one, in seven steps: Preparation, Clubs Paid, Agents Paid,
Players Paid, Statements Sent, Invoices Match Club Data and Books Closed. Each
step says Waiting, Running, Done, Late or Failed, with the time in Chicago
time and the chips paid to two decimals. Below the steps it lists that
week's statements: number, club, who owes whom, amount, whether it was
delivered, whether it matches the Club Data screen, and any credit note.

While the payout is running the section refreshes once a minute; otherwise
it never refreshes on its own.

It reads from a new function, `ca_union_weekly_rakeback_status` (migration
`20261116020505_weekly_rakeback_status_for_union_owners.sql`), which only
the union owner or a platform admin can call, the same rule as the
statements board. It only reads, with short time limits, and takes no lock
that could hold up the payout.

Checked on production (read-only) for the week ending Nov 9: clubs paid
840,213.67 to 3 clubs, agents paid 695.49 to 20 agents, players paid
642,268.52 to 1,339 payees, statements MIDWAY-2026-000037 to 000041 with all
four club statements delivered, books closed Nov 11.

Tests: `scripts/ci/test-weekly-rakeback-status-postgres.py` (native
PostgreSQL 17), `tests/components/weekly-rakeback-status.test.tsx` and
`tests/weekly-rakeback-status.law.test.ts`.
