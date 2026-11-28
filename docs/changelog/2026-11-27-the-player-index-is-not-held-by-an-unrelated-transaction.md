# The player index is not held by an unrelated transaction (2026-11-27)

`ClubArenaStatsIndexLag` fired at 11:25 and 11:56 UTC on 2026-11-27, and
earlier off-cycle on 2026-11-24 14:56 and 2026-11-25 09:25, 09:55, 11:55 and
12:25. None of these were in a maintenance break. The break-time firings are
a separate cause, tracked in World Hub #2904.

## Cause

`ca_refresh_hand_player_index` (20261111131639) caps its forward loop at
`least(now() - 5 minutes, oldest xact_start of ANY client backend)`. The
`club-stats-maintenance` heartbeats show the 11:15 and 11:45 refreshes took
the advisory lock (their ceiling is not NULL) but indexed 0 hands. hand_history
held 40 to 59 hands every five minutes. A run takes no hands only when the
bound is at or below the current ceiling, which means some backend had held a
transaction open for 20 minutes or more.

No pg_cron job ran longer than five minutes, and auto_explain logged no
statement that long, so the pin was an open transaction that never wrote a
hand. Each such pin cost one 15-minute refresh, the watermark aged past the
30-minute threshold, and the alert fired.

## Fix

The bound now counts only transactions that hold a write lock on
`public.hand_history`. Those are the only ones whose uncommitted hand could
later appear below it. The five-minute floor stays as it was. Every hand is
still indexed on insert by `trg_ca_stats_live_from_hand`, so even a writer
that waited more than five minutes before inserting loses nothing.

## Hardening

- Migration `20261127121037_the_player_index_bound_waits_only_for_hand_writers.sql`
  is md5-pinned to the live body and changes only the `v_bound` line.
- Native proof `scripts/ci/test-idx-refresh-unrelated-xact.py`:
  - On the live body, an unrelated open transaction stops the index. On the
    new body it does not.
  - An open hand writer still holds the ceiling, and its hand is indexed
    exactly once.
- Law `tests/the-player-index-is-not-held-by-an-unrelated-transaction.law.test.ts`.
- Workflow `the-player-index-is-not-held-by-an-unrelated-transaction.yml` runs
  the native proof on every PR touching these paths.
- Detection is unchanged. `ClubArenaStatsIndexLag` already routes to
  `operational_alert_events` with `target_task_id`
  01a09b86-5ba8-7290-8657-1041f13dd3ca. It is expected to be silent off-break.
