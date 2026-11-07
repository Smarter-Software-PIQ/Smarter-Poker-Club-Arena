# Leaderboard snapshot date lookups

The Kings weekly leaderboard hit an actual statement timeout in production run 42349055319. Its union-scope date aggregates scanned every eligible historical snapshot through the maintained filtered view. A read-only nested plan spent 2868.7ms of 2922.9ms selecting those dates; ordered index lookups reduced the same complete query to 89.8ms. Both directions of EXCEPT ALL returned zero differences for all ten returned rows.

The guarded migration changes only the three union-scope max/min date lookups to ordered LIMIT 1 queries. It retains the filtered view, scope attribution, measures, rank semantics, function privileges and errors. The underlying snapshot_date column is NOT NULL. No index, timeout, payout or engine change is included.

The exact migration runs in an isolated PostgreSQL fixture covering a filtered latest date, sparse baseline, ties, previous ranks, empty history, first-snapshot fallback and the All Time control. The existing database CI shard invokes that regression. Focused source contracts preserve the remainder of the function byte for byte after normalizing only these three substitutions.

Protected merge, migration installation and affected live proof remain required.
