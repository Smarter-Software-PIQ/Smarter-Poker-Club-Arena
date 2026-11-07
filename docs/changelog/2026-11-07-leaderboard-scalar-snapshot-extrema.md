# 2026-11-07 - Leaderboard scalar date lookups stop at the first eligible row

## What failed

Post-deploy E2E run 42349055319 failed on Leaderboards at 375px:
`[LeaderboardService.getClubLeaderboard_v2] canceling statement due to statement timeout`.
Signed-in players hit the same 8 s `authenticated` limit when the database is busy.

## Root cause

`fn_club_leaderboard_period_v2` and `fn_club_leaderboard_by_dates` find their
baseline, previous-window and end snapshot dates with
`max()`/`min()(snapshot_date)` over `ca_stats_player_stats_snapshots_real`.
That view carries anti-joins (Kings Club horse rows, assigned-horse rows,
retired fleet), which stop PostgreSQL from turning an aggregate into an index
probe. The planner instead walked the club through `player_stats_snapshots_pkey`
(user_id first) and filtered every row.

Measured on production, KINGS CLUB, read-only:

| lookup | time |
| --- | --- |
| `max(snapshot_date)` through the view | 3,999 ms |
| same lookup, `ORDER BY snapshot_date DESC LIMIT 1` | 36 ms |

`20261107084902` had already bounded the three union-scope lookups. This
change bounds the remaining six scalar ones: three in the period function
(baseline, first-snapshot fallback, previous end) and three in the by-dates
function (baseline, end snapshot, previous start).

## Why the answer is identical

The view and its filter are unchanged. `snapshot_date` is part of the primary
key, so it is never NULL, and the first row in date order is exactly the
aggregate. A club with no eligible row still leaves the variable NULL, because
a plpgsql `SELECT INTO` that finds no row assigns NULL.

## Proof

- **Production, read-only.** The rewritten bodies were installed as `pg_temp`
  copies and compared with the live functions using `EXCEPT ALL` both ways:
  - Period function: 35 cases across the 5 busiest clubs (KINGS CLUB included), every metric, daily/weekly/monthly/all-time. 14,889 rows, 0 differences.
  - By-dates function: 10 cases, 2,658 rows, 0 differences.
- **Warm-cache timing**, average of 3 runs:
  - Period function: 152 ms before, 78 ms after.
  - By-dates function: 109 ms before, 30 ms after.
  - Cold, the old aggregate plan is the 4-second walk shown in the table above.
- **Native Postgres.** The migration was applied to the measured fixture (`scripts/ci/fixtures/leaderboard-extrema-preimage.sql`) after `20261107084902`, and the result was compared against the recorded expected output. It also re-ran the sibling's edge cases: empty snapshot history, the future first-snapshot fallback and the All Time path. It passed and landed on the declared postimage md5. Applying it a second time is refused (`PREIMAGE moved`).
- **Unit test.** `tests/leaderboard-scalar-snapshot-extrema.test.ts` replays the md5 chain and checks every edit.

The by-dates function is guarded by its measured live md5 (`c8d939f6...`) and
its three anchors. It has no fixture in the repo, so its equivalence evidence
is the production comparison above.
