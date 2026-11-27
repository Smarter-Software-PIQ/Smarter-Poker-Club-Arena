# stats-index-lag-unrelated-xact-pin

Read 2026-11-27 12:00-12:15 UTC from production (read-only).

## Alert rows (`operational_alert_events`)

| id | status | received_at (UTC) | indexCeil | lag_s |
|---|---|---|---|---|
| 449660 | firing | 11:25:02 | 10:55:00.47 | 1800.5 |
| 449662 | resolved | 11:30:01 | 11:24:52.25 | 299.2 |
| 449663 | firing | 11:56:01 | 11:24:52.25 | 1859.2 |
| 449667 | resolved | 12:00:01 | 11:54:58.57 | 300.5 |

Earlier off-break firings, still `investigating`: 2026-11-24 14:56,
2026-11-25 09:25, 09:55, 11:55 and 12:25. Every other firing in the last
three days was at :10 after a cutover (World Hub #2904).

## `club-stats-maintenance` heartbeats (`probe_heartbeats`)

| run | hands_indexed | ceil_at after |
|---|---|---|
| 08:45:19 | 594 | 08:40:00 |
| 09:00:13 | 0 | 08:40:00 |
| 11:00:02 | 143 | 10:55:00 |
| 11:15:05 | 0 | 10:55:00 |
| 11:30:13 | 283 | 11:24:52 |
| 11:45:02 | 0 | 11:24:52 |
| 12:00:02 | 266 | 11:54:58 |

Edge logs show every `ca_refresh_hand_player_index` call returned 200. A run
that loses the advisory lock returns `ceil_at` NULL. These runs returned the
unchanged ceiling, so they held the lock and their bound sat at or below the
ceiling. hand_history held 40 to 59 hands every five minutes over the whole
span.

`cron.job_run_details` shows no job longer than five minutes since 08:00. No
auto_explain `duration:` line reaches 20 minutes; the longest is 183 s.

## Native proof

```
PASS: uses PostgreSQL 16 or later (postgres (PostgreSQL) 16.15)
PASS: the 20261111131639 body is the live body (md5 189b93e13db1ced3dd258aebfc46cd49)
```

The full output is in the PR body and the workflow run.
