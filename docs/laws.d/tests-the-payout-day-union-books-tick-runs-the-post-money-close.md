# tests/the-payout-day-union-books-tick-runs-the-post-money-close.law.test.ts

The payout-day union books tick (job 564) never enters the 240-second-pinned weekly_payout_due path: it checks the week scope plan is empty and runs the cascade post-money steps (horse promo, round-2 window advance, fn_process_weekly_accounting) itself under the scheduler lock, so the union statements close on Monday instead of failing every two minutes.
