# 2026-11-25: certification spawns stand down, and the club leaderboard reads a folded total

Dan, 2026-11-25: "Fix all five" (item 3 of the 24-hour production error
review, statement timeouts). Migrations
`20261125022315_a_certification_spawn_stands_down_while_its_club_is_retired.sql`
and `20261125022320_the_club_tournament_leaderboard_reads_a_folded_total.sql`.

## What production showed

- Scheduled tournament spawns were cancelled by the 8 s statement timeout while
  waiting on a certification fixture club that the certification cleanup held
  `FOR UPDATE` for 60 to 75 s at a time. The spawn's insert trigger
  `fn_ca_certification_fixture_spawns_only_during_its_run` took `FOR KEY SHARE`
  on that club row and queued behind the retirement.
- `fn_club_tournament_stats` (the club Tournament leaderboard) was cancelled 30
  times in 14 hours. It aggregated a club's whole history on every load:
  Midway Union holds 2,610,480 finished entries, so it could not finish in 8 s.

## Change

1. The certification guard tries the club row with `FOR KEY SHARE SKIP LOCKED`
   first. When a retirement holds the row, the occurrence is refused at once
   with `CERT_FIXTURE_BEING_RETIRED` (23505, the code the spawner already treats
   as "not materialized") instead of waiting. Real clubs are untouched: the
   branch runs only for reserved certification identities.
2. Finished, non-private history is folded every 30 minutes (:07 and :37) into
   `smarter_private.club_tournament_leaderboard_totals`, one row per club and
   player, writing only rows whose figures changed. The reader adds the live
   tail (unfinished, finished after the fold boundary, and every private
   tournament) under the caller's own row security. The two parts are disjoint,
   so the result equals the full aggregate. Until the first fold runs, the
   reader reads everything live exactly as before.

## Proof

- `scripts/ci/test-slow-reads-stand-down-and-leaderboard-fold.py` (workflow
  `slow-reads-stand-down-and-leaderboard-fold.yml`, native PostgreSQL 17):
  installs both pinned live bodies, shows the spawn waiting behind a held club
  and then refused at once after the migration, and compares the new
  leaderboard with the old one row for row at every stage on seeded data.
  On a 200,000-tournament club the new reader took 62 ms against 2,016 ms
  (29/29 locally on PostgreSQL 16).
- `tests/slow-reads-stand-down-and-leaderboard-fold.law.test.ts` pins the shape.
