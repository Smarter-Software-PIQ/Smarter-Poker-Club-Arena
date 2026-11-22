# A cluster tick never blocks a waiting-list join (2026-11-22)

Found while verifying the post-commit lag fix for incident `9408cfd4`.

## What happened

A waiting-list join (`INSERT INTO cash_game_waitlist`) and the cluster pass
(`fn_cash_clusters_tick_all_uncapped` -> `fn_cash_cluster_tick`) deadlocked 2 to
10 times an hour through 2026-11-21 and 2026-11-22: 98 of the 112 deadlocks in
the 24 hours to 23:25 UTC named both. Postgres cancels one side each time, so
either the join failed or the pass lost that game's tick.

## Cause, read from the log

The join's side is always the foreign key check of
`cash_game_waitlist_game_id_fkey` (`FOR KEY SHARE` on the `cash_games` row). It
waited on the tick, which takes the same row `FOR UPDATE`, the one lock that
conflicts with a foreign key check, while the tick waited on the join.

`FOR UPDATE` is for a transaction that deletes the row or changes a key a
foreign key can use. The tick does neither: it updates only `state`,
`opening_hold_since` and `last_tick_at`, and the only such key on `cash_games`
is `id` (its two other unique indexes are partial).

## The change

`20261122232612` changes the tick's two row takes (the wake's `SKIP LOCKED` and
the pass's) to `FOR NO KEY UPDATE`, the lock Postgres takes for that kind of
update anyway. It still excludes every other tick and wake and every `FOR SHARE`
reader (`fn_cash_cluster_open_table`, the Lightning readers); it only stops
blocking a foreign key check. The file aborts if the tick ever deletes a game.

## Proof

`scripts/dev/prove-a-cluster-tick-never-blocks-a-waiting-list-join.sh`, on a
throwaway PostgreSQL:

| tick holds        | join (1 s wait) | wake (SKIP LOCKED) | FOR SHARE reader |
| ----------------- | --------------- | ------------------ | ---------------- |
| FOR UPDATE        | lock timeout    | skipped            | waits            |
| FOR NO KEY UPDATE | committed       | skipped            | waits            |

The edited body was compiled against production as a rolled-back `pg_temp` copy.

Law: `tests/a-cluster-tick-never-blocks-a-waiting-list-join.law.test.ts`.
