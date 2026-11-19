# 2026-11-18 - The owner's Free Buy pause switch

Incident 075013fd, lane FB. Migration `20261118163436_owner_pauses_free_buy_starts_until_the_hand_delay_is_fixed.sql`.

## Why

Dan, 2026-11-17 21:30 America/Chicago (binding owner hold): shut down ALL Free
Buy tournaments 100% until the hand-delay problem is fixed. It was enforced by
hand that night and nothing durable carried it, so on 2026-11-18 "Morning Free
Buy (NLH)" 7004d241 started at 14:30 UTC with 544 entrants. Dan's 22:17 CT
hardening list asked for a "Free Buy pause switch"; it had not been built.

## Where a Free Buy starts (read on production)

The engine's discovery loop (`GameServer.discoverTournaments`, start gate
`scheduledPreparationAt(start_time, field) <= now`) calls
`TournamentManagerBase.start()`. Its one durable admission point is
`fn_begin_tournament_launch_atomic` -> `fn_begin_tournament_launch_before_lease_generation`
(the launch-receipt insert is the first launch write); `fn_complete_tournament_launch_atomic`
then flips RUNNING. Every RUNNING / started_at write is also checked by the trigger
`zzzzzzzz_launch_tournament_admission` through `fn_ca_launch_tournament_start_refused`.
Free Buys are created by the engine's schedule spawner (`ScheduledTournamentService`,
`tournament_schedules`) about three days ahead, with `free_buy = true`.

## What changed (database only; no engine release needed)

- `public.ca_free_buy_start_pause` (one row: paused, reason, set_by, set_at,
  operation_id), `public.ca_free_buy_start_pause_audit` (append-only) and
  `public.ca_free_buy_start_deferrals` (no foreign key). Only
  `fn_ca_owner_set_free_buy_start_pause(paused, reason, set_by)` writes the
  switch; no API role may execute it. Installed ON with Dan's reason.
- The launch door's first step is `fn_ca_free_buy_start_pause_defers`: while ON,
  a REGISTERING Free Buy (`free_buy IS TRUE`, no launch receipt, no start
  evidence) has its start_time moved to greatest(start_time, now) + 30 min and
  the call answers `{ok:false, reason:'platform_frozen', cause:'free_buy_owner_pause'}`.
  The serving engine already treats `platform_frozen` as a quiet stand-down
  (one log line, no reportError, no retry); the moved start takes the row out
  of the start gate, so the engine asks again about every 22 minutes.
- `fn_ca_launch_tournament_start_refused` also holds an unstarted Free Buy, so
  no other writer can flip it RUNNING while paused.
- Registrations, horses and humans alike, are untouched. No refund, no ledger
  row. New Free Buys may still be created. A RUNNING Free Buy, or one whose
  launch receipt exists, is never touched.
- Turning it OFF writes nothing to tournaments: each deferred event's start is
  at most 30 minutes away and it launches through the normal path.

No cron and no repair job (CLAUDE.md 10.12).

## Operating it

```sql
-- state
SELECT * FROM public.ca_free_buy_start_pause;
-- off (owner)
SELECT public.fn_ca_owner_set_free_buy_start_pause(false, '<why the hold is lifted>', '<who>');
-- what it deferred
SELECT * FROM public.ca_free_buy_start_deferrals ORDER BY last_deferred_at DESC;
```

## Proof

- `bash scripts/ci/test-free-buy-start-pause-postgres.sh` (PostgreSQL 16): the
  fixture's preimages hash to production's md5s, the migration applies byte for
  byte, and switch ON refuses + defers with registrations unchanged and no
  receipt/ledger/wallet row; a direct RUNNING flip is refused; a regular MTT and
  an in-flight Free Buy launch normally; switch OFF launches the deferred event.
- `tests/the-owner-free-buy-pause-holds-every-start.law.test.ts`.
