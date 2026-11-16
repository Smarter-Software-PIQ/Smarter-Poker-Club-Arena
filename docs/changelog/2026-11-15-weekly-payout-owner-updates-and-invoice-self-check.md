# The union owner hears how the weekly rakeback is going, and every statement is checked against Club Data (2026-11-15)

The Monday 4:00 AM Chicago rakeback pays in stages - clubs, then agents, then
players and horses - and then each club gets a weekly statement. Until now the
union owner was told none of it, including when the payout ran late (on
2026-11-09 the clubs were paid 52 minutes after the run time and nobody heard).
Nothing compared the statements with the Club Data screen either.

Migration `20261115205037_weekly_payout_owner_updates_and_invoice_self_check.sql`
adds a new job, `weekly-payout-owner-updates`, that runs every minute but only
does anything for 24 hours from each Monday's run time. It sends the Midway
Union owner one notification per step, once per week:

- Weekly Rakeback: Clubs Paid (3 Clubs, 840,213.67 Chips)
- Weekly Rakeback: Agents Paid (20 Agents, 695.49 Chips)
- Weekly Rakeback: Players Paid (1,339 Payees, 642,268.52 Chips)
- Weekly Rakeback: Statements Sent (4 Of 4 Clubs)
- Weekly Rakeback: Invoices Match Club Data (4 Of 4 Clubs), or which club differs
- Weekly Rakeback: Payout Late (Clubs Not Paid By 4:30 AM)

The statement check reads one club per minute from the same reader the Club
Data screen uses, for the same accounting days, and stores what it found. Any
difference records one Production Alert.

It only reads the payout's tables, never changes or wraps anything in the
payout, has its own lock and short time limits, and cannot raise into the
payout.

Test: `scripts/ci/test-weekly-payout-owner-updates-postgres.py` (native
PostgreSQL 17, run locally against `/opt/homebrew/opt/postgresql@17/bin`) and
`tests/weekly-payout-owner-updates.law.test.ts`.
