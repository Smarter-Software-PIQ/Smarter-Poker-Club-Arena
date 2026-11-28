# stall-after-tournament-break

Production Alerts fleet, PRIMARY lane, 2026-11-23. Read-only measurements against
production (PokerIQ-Production); nothing in production was written by this work.

## Symptom

`ca-stall-watch` / `TableStoppedDealing`: 65 rows from 2026-11-20 to 2026-11-23
(ids 446358 .. 447723). Every one:

- was raised at :00:05 to :01:11 UTC, right after the hourly synchronized
  tournament break (`facts.break_started_at` = :55:00);
- read `facts.on_break = false`, `break_ends_at = null`, "no progress for
  ~300-365 s";
- resolved 40-210 s later ("recorded dealing resumed");
- had its first post-detection hand at break_started_at + 5:00 to + 7:59.98.

Worked example, table `1bdbb114` (Sunday Night Late PKO), 2026-11-23:
hands at 01:54:52, 01:55:34, then break, then 02:01:05, 02:01:51 ... The
watch raised it at 02:00:41 with ms_since_progress 306736.

## Cause

`fn_ca_table_stall_decide` excuses a tournament table only while
`tournaments.on_break` is true. The engine's break release
(`server/src/tournament/TournamentManagerBase.ts`, break release) writes
`on_break = false, break_ends_at = null` in one row version, so the first watch
tick after the release calls every table stopped, measured from its last hand
before the break. Same defect class as 20261107032642 (maintenance thaw).

## Fix

Migration `20261123025029`: `resuming_after_tournament_break` while
`now < break_started_at + 8 min` for a table no longer on break whose last
progress lies in `[break_started_at - 60 s, break_started_at + 2 min)`.
8 min = `LAST_HAND_GRACE_MS` (2 min) + `BREAK_DURATION_MS` (5 min) + the 60 s
every table gets (Dan, 2026-10-31).

## Proof

- Live pre-image md5 of `fn_ca_table_stall_decide`, read 2026-11-23 02:49Z:
  `077f272a204d8392dc292a49d1eec168`.
- Local PostgreSQL 16: installed the live definition byte-for-byte (md5
  matched), ran the migration: `MIGRATION_OK`; its in-transaction proofs
  passed. Re-running it refuses with `STALL_TOURNAMENT_BREAK_PREIMAGE_DRIFT`.
- Pre-fix, the measured case returns NULL (stopped); post-fix
  `resuming_after_tournament_break`.
- Replayed all 65 rows (their stored facts, ms and detected_at) through the
  patched decision: `resuming_after_tournament_break|65`.
- Cases still raised: silent past break_started_at + 8 min; silent since
  before the break (last progress before break_started_at - 60 s).
- Law test `tests/stall-watch-measures-a-table-from-the-tournament-break-release.law.test.ts`
  (vitest 4.0.18): 5 of 6 fail with the migration absent, 6 of 6 pass with it.
  The maintenance-thaw law and the law registry pass.

## What is not claimed

- The rows are not closed: they close only after the migration installs from
  protected main and a full hour boundary passes with no new
  TableStoppedDealing at :00-:01 for tables that resumed inside the bound.
