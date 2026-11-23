# tests/a-cluster-tick-never-blocks-a-waiting-list-join.law.test.ts

A cluster tick never blocks a waiting-list join. fn_cash_cluster_tick took its cash_games row FOR UPDATE, the one row lock that conflicts with the foreign key check every cash_game_waitlist insert makes (FOR KEY SHARE), and a join and the cluster pass deadlocked 2 to 10 times an hour. The tick never deletes a game or changes a key a foreign key can use, so migration 20261122232612 takes FOR NO KEY UPDATE: it still excludes every other tick and wake and every FOR SHARE reader, and only stops blocking a foreign key check.
