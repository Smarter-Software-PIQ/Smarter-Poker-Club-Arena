# The payout-day union books tick runs the post-money close (2026-11-15)

Pre-flight of the Monday 2026-11-16 04:00 Chicago rakeback close found that the
new payout-day close job `weekly-union-books` (cron job 564, added by
`20261114163249`) could never do its work. Once the round runner has paid and
released the week, the job calls `fn_union_settlement_cascade_due()`, which
first calls `weekly_payout_due()` and, with the week released, then
`weekly_payout_prepare_due()`. That function refuses any statement budget other
than the original 240-second tick (`weekly_payout_original_bounded_tick_required`,
SQLSTATE 55000). Job 564 runs with a 900-second budget, so every one of its
two-minute ticks after the payout would have failed and the union's weekly
statements would again have waited for job 272's slow tick - the lateness the
job was created to end. Reproduced read-only on production: with a 900 s budget
`weekly_payout_prepare_due()` raises; with 240 s it returns NULL for a paid week.

Migration `20261115181339_the_payout_day_union_books_tick_runs_the_post_money_close.sql`
teaches `smarter_private.weekly_union_books_due()` to check that the week's
scope plan is empty (every scope paid) and then to run the cascade's post-money
steps itself, in the cascade's order and under the cascade's scheduler lock:
the weekly horse promo, the round-2 window advance, and
`fn_process_weekly_accounting(NULL)`. A week that still owes a scope is left to
job 272. No money logic, pinned function or schedule changes.

Test: `tests/the-payout-day-union-books-tick-runs-the-post-money-close.law.test.ts`.
