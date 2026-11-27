# tests/the-player-index-is-not-held-by-an-unrelated-transaction.law.test.ts

ca_refresh_hand_player_index bounded its forward loop by the oldest open
transaction of any client backend, so one long transaction that could not
write a hand froze the player index for as long as it stayed open, and
ClubArenaStatsIndexLag fired outside every maintenance break (2026-11-27 11:25
and 11:56 UTC; the 11:15 and 11:45 refreshes held the lock and took 0 hands).
The law pins that the newest definition counts only transactions holding a
write lock on public.hand_history, keeps the five-minute floor and excludes its
own backend. The behavioural proof, predecessor first, runs against a real
Postgres in scripts/ci/test-idx-refresh-unrelated-xact.py.
