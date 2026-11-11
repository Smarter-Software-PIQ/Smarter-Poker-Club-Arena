# tests/the-player-index-refresh-leaves-young-hands-to-the-live-projection.law.test.ts

ca_refresh_hand_player_index rebuilt ca_hand_player_idx up to the newest
committed hand inside one transaction of up to 90 s. The live post-commit
projection inserts the same (user_id, hand_id) keys, so at :00/:15/:30/:45 it
waited on the refresh, hit the 8 s statement timeout while holding the table's
hand-post-commit lock, and the engine dealt the next cash hand late
(2026-11-11, 82 waits in 24 h, up to 7.8 s). The law pins that the newest
definition bounds its forward loop by the earlier of now() - 5 minutes and the
start of the oldest other open client transaction (so a hand whose writer is
still open is never closed out of the window, and young hands are left to the
projection), and that it skips a player-hand that has a fact revision (a void
deletes the index row and must not be resurrected). The behavioural proof,
including the predecessor's wait, skip and resurrection, runs against a real
Postgres in scripts/ci/test-idx-refresh-lag.py.
