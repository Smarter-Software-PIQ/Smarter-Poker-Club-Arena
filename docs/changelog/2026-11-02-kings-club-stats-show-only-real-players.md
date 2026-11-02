# Kings Club Stats Show Only Real Players

Date: 2026-11-02

## Owner Order

Dan, 2026-11-02 13:26 CT: "MAKE SURE YOU REMOVE ALL THE LIFE TIME HORSE STATS FROM THE KINGS CLUB, TO THE AGENTS NEW CLUB AS WELL, I WANT TO SEE NOTHING BUT REAL PLAYER NUMBERS FROM KINGS CLUB ONLY".

## What Changed

Migration `20261102205742_kings_club_stats_show_only_real_players.sql` adds attribution views over the per-player rollups (`club_member_daily_stats`, `ca_club_player_daily`, `member_record_daily_facts`, `ca_club_data_fact_ct`, `ca_club_tournament_player_daily`, `player_stats`, `player_stats_snapshots`).

- A Kings Club row of a horse with a club assignment is read as the horse's assigned club (Deep Stack Society or The Felt Society). Its lifetime history follows it.
- A Kings Club row of any other horse is not read as Kings.
- Every other row is read unchanged.

The club player-statistics readers now read those views:

- Club Data players (page, breakdown, export) and games.
- Roster and member record.
- Top players.
- Leaderboards. Period leaderboards attribute union play by assigned club. All Time sums lifetime totals under the new club.
- Member counts. These no longer count the horse memberships Kings still holds while pre-split union tournament entries settle.

## What Did Not Change

- No rollup, fact or ledger row is rewritten.
- Rake, invoices, rakeback bases, agent commissions and conservation checks read the original rows.
- Kings keeps the money it collected in its books.
- Every other club and the union still count horses (CLAUDE.md 10.5). This ruling is for Kings Club only.

## Verification

- Every edit anchor was confirmed present in the live function bodies before merge. The migration refuses to apply if any is missing.
- The view plans were checked against production data: the club filter reaches both branches, and the moved-horse branch reads by index per assigned horse.
