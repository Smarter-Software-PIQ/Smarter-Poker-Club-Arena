# Every club reads its own records, horses included (2026-11-15)

Owner rule 2026-11-15: each club shows only the hands played through that club,
and a player who plays in several clubs is never excluded or moved. Audit
findings D3 and D4.

The 2026-11-02 club-split views (`ca_stats_club_data_fact_ct`,
`ca_stats_club_member_daily_stats`, `ca_stats_club_player_daily`,
`ca_stats_club_tournament_player_daily`, `ca_stats_member_record_daily_facts`,
`ca_stats_player_stats_lifetime`, `ca_stats_player_stats_real`,
`ca_stats_player_stats_snapshots_lifetime`, `ca_stats_player_stats_snapshots_real`),
`fn_ca_club_data_fact_window`, `fn_ca_stats_home_club` and
`fn_ca_stats_counts_in_club` dropped every KINGS CLUB horse row, moved Deep
Stack / Felt / Kings horse rows to the horse's current assigned club and dropped
retired horses. They fed member statistics, roster and exports, player search,
win/loss, top players, both leaderboards and Club Data's Chicago-basis readers.

Migration `20261115145150_every_club_reads_its_own_records_horses_included`
replaces each with its base rows by the club of each record (same names, columns
and types); the helpers answer the club asked and count everyone. No row is
written. Law: `tests/every-club-reads-its-own-records.law.test.ts`; the two
2026-11-02 laws keep pinning their own migration's text and are marked
superseded for statistics in `docs/laws.d/`.
