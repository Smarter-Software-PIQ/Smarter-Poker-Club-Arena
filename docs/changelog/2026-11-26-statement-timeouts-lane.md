# Monitor and report reads are bounded by their indexes (2026-11-26)

## Before

In the 24 h to 2026-11-26 21:45Z PokerIQ-Production cancelled these reads at
the 8 s statement budget (SQLSTATE 57014, edge 500 at ~8.0 s):

| Caller | Timeouts | Measured cost |
| --- | --- | --- |
| fn_union_treasury_selftest via fn_settler_lag_check | 39 | 280k buffers warm, ~6.4 s cold |
| fn_bbj_analytics (BBJ admin analytics) | 14 | 12.99 s, 5.0M rows for the busiest pool |
| GET game_management_events (Game Management board) | 13 | over 20 s for a non-operator in the biggest union |
| ca_public_arena_record_separated (profile Arena Record) | 6 | over 40 s for a heavy player |
| fn_tournament_money_conservation | 5 | 8.3 to 24.9 s cold |

## After

- `fn_settler_lag_check`: the closed-week query starts its index range at
  `GREATEST(week_from, cursor)` and spells the cash test as the partial index
  does (`is_tournament IS NOT TRUE`). 4 buffers, 0.3 ms. Same count.
- `fn_bbj_analytics`: whole closed hours come from the trigger-invalidated
  hourly rollup `bbj_pool_contribution_hours` (filled by `fn_bbj_pool_facts`);
  only the partial first hour and the open tail read `bbj_contributions`.
  15 ms; matched the old answer to the cent and the row on production.
- `ca_public_arena_record_separated`: hands, VPIP and PFR per club come from
  `club_member_daily_facts`, the daily rollup of `ca_hand_facts`. 4 ms; matched
  exactly on sampled players.
- New `fn_game_management_feed`: authorizes the caller once and reads the
  scope (operator) or only the caller's own events (everyone else) by index,
  under 1 ms. `useGameManagementRealtime` reads it instead of the table.
- Two concurrent partial indexes for the conservation scan:
  `idx_tournaments_conservation_ended_at` and
  `idx_rake_records_tournament_rake_cover`. The money functions are unchanged.

## How

Migrations `20261126220936_monitor_and_report_reads_are_bounded_by_their_indexes`
(one transaction, probes for every changed definer function, live proofs) and
`20261126220941_conservation_scan_reads_tournaments_and_rake_by_index`
(sanctioned CONCURRENTLY preamble plus a verifying transaction). Pinned by
`tests/monitor-and-report-reads-are-bounded.law.test.ts`.

## Root cause

Each read walked rows that an index or an existing rollup already summarises:
a predicate the partial index could not prove, a view summed row by row, a
per-row RLS function rejecting every row of a scope, and a status filter no
index covered.

## Not changed

`fn_cash_clusters_tick_all_uncapped` (13) timed out only inside the engine
cutover windows (lock contention with the release, not its own plan), and the
`fn_achievement_record_login` / `fn_update_presence` 502s were gateway errors,
not database timeouts. The horse review prunes and the rake-stats calendar
are reported separately.
