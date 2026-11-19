# The index lag alarm waits for the refresh a freeze skipped

Production alert `stats-index-lag-skipped-refresh` (operational_alert_events
445830/445833 and 18 earlier rows, 2026-11-16 to 2026-11-19).

**Cause, read from rows.** `ca_hand_player_idx_state.idx_ceil` is advanced only
by World Hub `/api/cron/club-stats-maintenance`, fired by Open Claw every 15
minutes, which sets it to (run time - 5 minutes) and does none of its steps
while `fn_platform_frozen()` or the daily break says so. A freeze therefore
costs one advance and the lag reaches ~35 minutes, over the 30 minute
`STATS_INDEX_LAG_THRESHOLD_S`. `paused()` only covered the freeze itself, and
an engine replaced in a release freeze starts with no memory of it. Every
firing after a freeze paired with one `probe_heartbeats` row `skipped /
maintenance_break` (10:00Z daily; 11-16 23:45, 11-18 11:45, 11-19 14:15,
11-19 21:15 off-cycle) and resolved on the next run. The 21:15Z case:
freeze 21:13:01-21:16:43Z (`aec0d93b`), ceiling held at 20:54:59.

**Fix.** `StatsHealthMonitor` holds the lag RAISE for one refresh cadence plus
three minutes (`STATS_INDEX_POST_FREEZE_GRACE_S`, 18 min) after the last
freeze end it knows of: a paused -> clear transition it observed, or the
engine process start (`lastFreezeEndedAt`). The threshold is unchanged, a
resolve is never delayed, and a second missed run still raises (lag ~50 min at
the end of the grace). Failures that are not a freeze (`maintenance_state_unreadable`,
`partial`) still raise at once.

**Pinned by** `server/src/observability/StatsHealthMonitor.test.ts`
("index lag after a platform freeze"): 2 of its 5 cases fail on the pre-fix
monitor, all pass after.
