# 2026-11-07 - A Lightning Window Send Is Staggered

Dan, 14:27 Chicago: root-cause the Lightning RPC 500s seen today.

## fn_lightning_integrity_report: fixed

Nine 500s in the 24 hours to 21:45 UTC (02:05 ×2, 02:06, 08:05 ×2, 08:06, 14:05, 14:12 and 19:21:40 UTC), each answered by a `canceling statement due to statement timeout` 8 s later. Each is one of the first window closes after a maintenance release. Postgres shows the release burst at those instants: dozens of sessions queued on one shared settlement-lane advisory lock, `fn_ca_table_stall_watch_tick` taking 11 s. `pg_stat_statements` puts the report at a mean of 569 ms (it re-reads 24 hours of evidence per call), against 32 ms for `fn_lightning_instance_begin_dealing`.

The 19:21:40 one is not the freeze refusing a write. The release boundary passed at 19:21:37; Postgres logged no `PLATFORM_FROZEN` at 19:21:40-48 and the function never reads the freeze. It is the same timeout.

The shadow runner aligns windows to the wall clock and every Cluster closed and sent its window on the same pass second. After a release that pass is the first one, for every Cluster, into a database draining its own release, so every report timed out and its window was dropped (`[LightningShadow] ... failed; window dropped`).

`LightningShadowRunner` now sends each closed window at the Cluster's own offset after the close: an FNV hash of the Cluster id over `LIGHTNING_SHADOW_FLUSH_SPREAD_MS` (60 s), never past half a window. The offset runs from the moment the window closes, not its nominal end, which after a freeze is already past and would line every Cluster up again. The send rides the Cluster's next pass, or `stop()`; there is no timer. Accumulation and window boundaries are unchanged; only the send moves. Units default to no spread; the production worker passes it.

Tests: `server/src/lightning/LightningShadowFlushSpread.test.ts`, `tests/a-lightning-window-send-is-staggered.law.test.ts`. Engine change: activates in the 04:00 Chicago window.

## fn_lightning_instance_begin_dealing: no change

Four 500s in 24 hours (21:56 on 11-06; 01:31, 12:53 and 19:08 on 11-07), each a `57014` timeout. Mean 32 ms over 2.3 million calls. Postgres logged no lock wait for any of them (lock waits over 1 s are logged); three of the four coincide with the 10-second `sp_prune_hand_history` batches running 14-22 s, so they are moments of database-wide saturation rather than a defect in the function. The engine's existing path is correct: the formation is abandoned and its players return to the pool; where the abandon also timed out (01:31, 12:53) the instance was still resolved: no Lightning instance older than an hour is left reserved or dealing. The prune batch cost is a separate retention question.
