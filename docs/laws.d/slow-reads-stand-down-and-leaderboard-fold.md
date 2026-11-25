# tests/slow-reads-stand-down-and-leaderboard-fold.law.test.ts

Until 2026-11-25 two player-facing reads ran into the 8 s statement timeout. A
scheduled spawn for a certification fixture club queued behind the
certification cleanup, which holds the club row FOR UPDATE for 60 to 75 s;
the fixture guard now tries the row FOR KEY SHARE SKIP LOCKED and stands the
claim down at once with 23505 (CERT_FIXTURE_BEING_RETIRED). The club
Tournament leaderboard aggregated a club's whole history on every load; it
now reads a 30-minute fold of finished non-private history plus the disjoint
live tail under the caller's own row security, so it returns the same rows
without the full scan. This law pins both shapes, the fold's
write-only-what-changed upsert and that the folded totals stay unreadable to
anon and authenticated.
