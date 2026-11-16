# The unfinished rakeback calculator is retired (2026-11-15)

The union-invoice audit checkpoint left one clean-up: a leftover unfinished
rakeback function.

`public.fn_calculate_rakeback(uuid, timestamptz, timestamptz)` was the first
per-player rakeback calculator (20260126300). 20260424001857 (BUG-26) replaced
its body with a stub returning `{success: false, error: 'not_implemented',
rakeback: 0}` when the columns it read disappeared, and it was never finished:
the weekly accounting coordinator is the rakeback calculator. On production
nothing names it (no function, cron job, trigger or view), nothing in the repo
calls it, and it still held EXECUTE for authenticated.

Migration `20261115164443_the_unfinished_rakeback_calculator_is_retired.sql`
drops it. Test: `tests/unit/theUnfinishedRakebackCalculatorIsRetired.test.ts`.

Not retired: `fn_player_home_club` (the largest-balance club look-up). Its two
uses in the jackpot credit path were already removed by 20261115150131; the
function itself still serves nine live wallet, seat and payout doors.
`fn_ca_stats_home_club` and `fn_ca_stats_counts_in_club` were already reduced by
20261115145150 and are still read by the statistics readers.
