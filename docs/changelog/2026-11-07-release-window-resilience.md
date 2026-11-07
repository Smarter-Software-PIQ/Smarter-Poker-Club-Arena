# 2026-11-07 - The release window survives its own migrations

Follow-up to `2026-11-07-release-door-window-order.md` (#9846) and issue #9840.
It covers three risks #9846 left for the next 04:00 America/Chicago window.
Nothing here dispatches, cancels or re-runs a release or a migration. Nothing
here changes production state or adds a schedule. Every measurement below was
read-only.

## Measurements (2026-11-07, read-only)

- **PostgREST schema cache reloads.** 151 reloads in 24 h. `Schema cache
  queried in` ranged from 1364 to 5933 ms: p50 3209, p99 5587 (postgrest_logs).
  The ~28 s figure in CLAUDE.md section 2 dates from before the 2026-08-31
  statement_timeout fix.
- **Window installs.** Freeze confirmed 0.29 s (11-04), 0.60 s (11-02) and
  2.73 s (11-07) into the break. One install took 505 ms (11-02) and another
  1014 ms (11-04). The refusal on 11-07 took 1487 ms, including a 1096 ms lock
  wait. In run 42361241341 the first file was sent at 10:00:03.177Z and
  refused at 10:00:04.208Z.
- **Release budget.** The certificate admits the release only while at least
  `BREAK_ADMISSION_MIN_BREAK_MS` = 285000 - 25000 = 260000 ms of the 300000 ms
  break remain, which leaves 40 s. The locked read needs 245000 ms, which
  leaves 55 s.
- **Who holds the live tables when the window opens.** The window opens on
  minute 0 of a UTC hour, so every every-minute, every-5 and every-10 pg_cron
  job started between 10:00:00.15Z and 10:00:00.45Z, in the same second as
  the install:
  - `ca-quick-reconcile-5m` reads `clubs`: 0.89 s that morning, max 3.88 s
    over 6 h.
  - `ca-mint-velocity-5m` reads `clubs`: 0.74 s, max 3.38 s.
  - `sp_prune_hand_history_10m` (job 117) runs one transaction of 7-11 s every
    10 s. It holds ACCESS SHARE on `hand_history`, `tables` and `tournaments`
    (seen in `pg_locks`), with about 3 s between runs.
  - `ca-table-stall-watch-10s` (job 510) ran back to back through the break,
    13-18 s per transaction and 17 ms apart. It reads `tables`, `table_seats`,
    `tournaments` and `tournament_players` through `fn_ca_table_stall_facts`.
  - No pg_cron job reads `cash_player_session`. Its readers are engine RPCs
    through PostgREST, with short transactions.

## Risk 1: PostgREST cache lag (root cause and fix)

**Root cause.** `server/scripts/engine-release-window-doors.py` `status()`
returned READY as soon as `fn_schema_manifest()`, which reads pg_proc, listed
every door. The engine calls those doors through PostgREST. PostgREST answers
PGRST202 until its reload after the install, and the reload measured up to
5.9 s per DDL transaction, one transaction after another.

**Fix.** READY now means pg_proc and PostgREST's schema cache both hold every
door. The probe cannot execute a door. It POSTs the door's own parameter names
plus one name the door does not have. PostgREST matches functions by the exact
set of names, so the answer is always PGRST202 404 from a cache lookup.
Measured against production:

- When the cache holds the door, the hint names it with its cached parameters:
  `Perhaps you meant to call the function public.fn_cash_session_evaluate(p_entries, p_table_id)`.
- When the cache does not hold it, the hint names a different function.

Exposed means exactly this door with exactly the target's parameter names, so
an old signature after a CREATE OR REPLACE also counts as stale. The parameter
names come from the target tree's last definition of each door. They are
derived once, before the certificate loop (`signatures` subcommand), the same
way as the door list.

- A stale cache is PENDING. It waits inside the same admission budget, and
  `refuse_unready_window_doors` refuses by name once the certificate no longer
  holds.
- A 2xx, any other code, an unreadable body or missing signatures is UNKNOWN,
  which is a named refusal.
- A door with no named parameter is read from PostgREST's OpenAPI description
  using the secret key. No door like that exists today, and this path was not
  exercised live.
- The engine-side retry is unchanged (CLAUDE.md section 2 rule 6).

Classified live (read-only, publishable key) at about 13:00Z:

- Exposed: `fn_ca_ack_tournament_abort_boundary`,
  `fn_ca_tournament_abort_stop_state`, `fn_cash_session_evaluate`,
  `upsert_horse_mind_stats`, `upsert_horse_mind_stats_scoped`.
- Stale: `fn_cash_session_set_blind_off`, `fn_horse_exact_profiles_read`,
  `fn_lightning_blind_off_players`, which are not installed yet. Also stale:
  `fn_cash_session_evaluate` with a made-up third parameter.

## Risk 2: window timing (root cause and fix)

**Root cause 1.** In `status()`, an unreadable GitHub install signal was
REFUSED at once. The signal is an unauthenticated Actions API read, which is
limited to 60 requests an hour per address and is read again on every 3 s poll.
One dropped or rate-limited read refused a release whose install was still
running.

**Fix 1.** An unreadable signal is now PENDING. The break's own clock is the
durable deadline: the admission certificate, then `refuse_unready_window_doors`.
A missing door still never reaches the cutover. Absent and finished installs
still refuse at once. This pin moved in
`tests/a-window-migration-door-is-admitted-only-on-condition.law.test.ts`, and
the reason is written beside it.

**Root cause 2.** Nothing bounded the installer against the release's
admission budget.

**Fix 2.** The installer's new wait (Risk 3) is bounded by
`DOOR_INSTALL_DEADLINE_SECONDS` = 40 - 6 - 6 = 28 s into the break:

- 40 s is the admission budget.
- 6 s is the measured maximum reload.
- 6 s is one door poll: the 3 s sleep plus the certificate and status reads.

The deadline is read from the database clock and derived from the
transaction's own constants, which a law test pins. The break clocks did not
move. `tests/the-break-clocks-agree.law.test.ts` is untouched and passes.

## Risk 3: lock refusal on live tables (root cause and fix)

**Root cause.** `scripts/ci/install-window-migrations.mjs` sent each file at
whatever instant the previous one finished, which was the top-of-the-hour
pg_cron burst. A single 1 s `lock_timeout` attempt arriving in the middle of a
multi-second reader transaction is refused. By design the first refusal holds
every later file for a day.

**Fix.** Before the one attempt, the installer reads pg_locks and
pg_stat_activity (one read-only SELECT that requests no lock and queues nothing)
for exactly the relations the file will lock. `lockTargets` derives them from
the file's SQL with PostgreSQL's conflict table: ALTER TABLE takes ACCESS
EXCLUSIVE, CREATE TRIGGER takes SHARE ROW EXCLUSIVE, CREATE INDEX takes SHARE.
The installer then waits for no conflicting holder older than 250 ms.

- The wait is bounded at 12 s per file, by the door deadline above, and by the
  window's start reserve.
- When the bound passes, the file is sent once anyway, so the result is never
  worse than before.
- Unchanged: one spawnSync per file, the 1 s lock_timeout, the 8 s budget, the
  stop-at-first-refusal rule and no retry.
- A refusal now names its holders (pid, application, transaction age, query),
  so the next refusal can be attributed instead of guessed.

Today's queue would wait for prune's gap on `hand_history` (20261106091733)
and for the reconcile and mint-velocity runs on `clubs` (20261107040516).
`cash_player_session` (20261106203853) has no long cron reader. Native proof,
case 11 of `scripts/ci/test-maintenance-window-migrations.sh` on PostgreSQL 16:

- A 3 s ACCESS SHARE holder that refuses an immediate send (case 3) is waited
  for, 1755 ms, and the file then installs on its one attempt.
- A 60 s holder is named, and the file is sent once and refused, with nothing
  committed.

No merged migration file was edited.

### What this lane cannot fix, for the owning lanes

All of these need database changes, which this lane may not apply.

- **`ca-table-stall-watch-10s` (job 510).** During the break it holds `tables`,
  `table_seats`, `tournaments` and `tournament_players` almost continuously,
  in 13-18 s transactions 17 ms apart. No quiet moment exists, so any future
  window file that takes ACCESS EXCLUSIVE on those tables will be refused.
  Root fix: skip the per-table `fn_ca_table_stall_facts` loop while
  `poker_maintenance_break_active` is 1 (it already sets
  `v_can_resolve := false` then), or commit per table.
- **`sp_prune_hand_history_10m` (job 117).** One 7-11 s transaction every
  10 s. The gate fits inside its gaps, but it is the next refuser for any
  `hand_history` file. Root fix: shorter batches, each committed, or skip while
  the platform is frozen.
- **`ca-quick-reconcile-5m` and `ca-mint-velocity-5m`.** They start at the
  same second the window opens. Root fix: a `fn_platform_frozen()` check at
  start, like the weekly accounting jobs already have.

## Tests

- New `tests/the-engine-can-call-its-window-doors-before-the-cutover.law.test.ts`
  (17 tests). It uses PostgREST's own response bodies captured live.
- New `tests/a-window-install-asks-for-its-lock-in-a-quiet-moment.law.test.ts`
  (9 tests).
- Updated `tests/a-window-migration-door-is-admitted-only-on-condition.law.test.ts`.
  The unreadable-signal pin moved, with its reason, and the fixtures expose the
  cache by default.
- Native window proof: all 18 cases pass, including the new case 11.
- `RETAINED_REFUSAL_SOURCES` moves to the new transaction bytes, and the
  previous pair is kept.
