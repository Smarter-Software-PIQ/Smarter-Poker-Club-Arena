# 2026-11-07 - The release door check no longer deadlocks on a window migration

## What happened at the 04:00 America/Chicago window (10:00Z)

- The Backup Engine certified e6e26ab8 at 09:28Z.
- Engine Release run 42360536751 (auto-deploy-hetzner.yml) passed every test
  shard and then failed job `engine-doors` at 09:52Z:
  `fn_cash_session_set_blind_off()` and `fn_lightning_blind_off_players()`
  did not exist in production. Nothing was deployed; production stayed on
  92e26a9f.
- Both functions are created by
  `20261106203853_hit_and_run_ten_hands_in_profit.sql` (#9748), which declares
  `-- @install-window: daily-maintenance` and so can only install inside the
  04:00 freeze (CLAUDE.md section 2 rule 10).
- The window job (run 42361241341) confirmed the freeze at 10:00:02Z and its
  first queued file, `20261106004812_a_built_midway_free_buy_refuses_a_shape_its_schedule_does_no.sql`,
  was refused with 55P03 lock timeout after 1096 ms. By design that stopped the
  run and all queued window files stay queued.

## Root cause 1: the release order was a deadlock

`engine-doors` (`.github/workflows/auto-deploy-hetzner.yml`, job at the top of
the receiver, `needs: preflight`) runs `scripts/ci/check-engine-doors-exist.mjs`
right after the test matrix, about eight minutes BEFORE the break gate, and
refused every missing door (`const missing = names.filter(...)`, then
`return 1`). A window migration installs only INSIDE the break. So any build
that calls a function a queued window migration creates was refused every day
before its migration could ever install. Even a perfect window install would
not have shipped e6e26ab8: the release had already failed eight minutes
earlier. Earlier agents had worked around the same trap one function at a time
in `scripts/ci/engine-doors.allowlist.json`.

## The fix

1. **Before the break: a conditional verdict, never "OK".**
   `scripts/ci/window-migration-doors.mjs` classifies each missing door. It is
   CONDITIONAL only when a migration in the exact target checkout creates it,
   declares the daily window, is not superseded, is byte-identical to protected
   main (the job now fetches `origin/main` for that proof) and is not in
   `schema_migrations` (the installer's own definition of queued). The check
   prints `CONDITIONAL - ...`, writes `verdict=conditional`,
   `conditional=<names>` and `conditional_migrations=<files>`, and the release
   continues. Every other missing door is refused exactly as before, and so is
   a window door whose file is recorded, unreadable in history, differs from
   main, or is superseded. A rollback is never admitted on a window condition.
   The job now always names its verdict: `proved`, `conditional`, `refused`,
   `unchecked` or `rollback` (CLAUDE.md 10.86).

2. **Inside the break: the condition is checked before any cutover.**
   `server/scripts/engine-release-transaction.sh` derives, from the exact target
   tree, every public function that a window-declared, non-superseded,
   non-allowlisted migration creates and the target engine calls
   (`server/scripts/engine-release-window-doors.py list`, the same extractor as
   the pre-break check; a law test pins their agreement on this repository).
   After the break's admission certificate and before the engine lock, the
   release seal's `prepare`, the Backup certificate re-read and any replacement,
   it re-reads pg_proc through the read-only `fn_schema_manifest()` RPC:
   - every door present: the release proceeds as before;
   - a door missing while this break's window install job is still running:
     wait 3 s and re-read, inside the same certificate budget;
   - a door missing after the install finished, or with no readable install
     signal: `FATAL: WINDOW MIGRATION DOORS REFUSED: ...`, nothing prepared,
     the current engine keeps running;
   - pg_proc unreadable: the same refusal, named UNKNOWN;
   - the certificate budget passes while still waiting: the same refusal.
     A target with no window door pays nothing: the list is empty and no read
     happens.

3. **The signal that this break's install finished.** The window install and
   the receiver are separate jobs that meet only in the database. A successful
   install leaves its function in pg_proc, which is what the host reads first.
   A refused install commits nothing, so the durable signal for "finished" is
   the GitHub job record of the daily run: the `Install Queued Daily-Maintenance
Migrations` job of the first push or schedule run of
   `stage-engine-release.yml` on main created in today's 03:30-03:50
   America/Chicago preparation window (the same rule the detector uses to pick
   the one daily preparation). The host reads it from the public Actions API,
   the same way it already reads the Backup certificate. Absent, skipped or
   unreadable is the plain refusal. No workflow, schedule, break clock or
   installer behaviour changed: the window installer still stops on its first
   refusal.

4. The helper ships in every control generation (`REQUIRED_FILES` and the
   python syntax loop in `install-engine-supervisor.sh`). A host refusal names
   itself in the receipt through the release step's `failed_stage`, and the
   release summary states the pre-break door verdict.

## Defect 2: why the Free Buy migration timed out during a confirmed freeze

Read-only diagnosis (postgres logs, `cron.job_run_details`, `pg_locks`):

- The file's statement `DROP TRIGGER IF EXISTS zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule ON public.tournaments`
  requests ACCESS EXCLUSIVE on `public.tournaments` even though the trigger
  does not exist (the relation is locked before the trigger is looked up). Its
  header says only "CREATE TRIGGER takes SHARE ROW EXCLUSIVE", which is true of
  the CREATE but not of the DROP that precedes it.
- ACCESS EXCLUSIVE conflicts with plain readers (AccessShareLock). The platform
  freeze refuses writes to the money and seat tables; it does not stop reads,
  and the engine keeps reading `tournaments` through the freeze.
- Timeline: `CREATE FUNCTION` admitted 10:00:03.195Z, `canceling statement due
to lock timeout` 10:00:04.208Z.
- Every pg_cron run is accounted for: none held the relation across
  10:00:03.2-10:00:04.2Z (`ca-table-stall-watch-10s` ended 10:00:03.195Z;
  `sp_prune_hand_history_10m` ran 10:00:04.119-04.139Z, behind the queued
  request). The holder was therefore a non-cron session (PostgREST or another
  engine read path). Its pid cannot be recovered: no lock-wait log line was
  written and `fn_ca_writer_lock_sentinel` only records sessions older than
  15 s.
- Outside the break, sampled holders of AccessShare on `tournaments` include
  `sp_prune_hand_history` (job 117, every 10 s, 3+ s per run) and
  `sp_prune_hand_state_snapshots` (job 119, 20 s per run). Neither moves money
  or seats, so section 13 invariant 5 does not require a freeze gate, and
  neither overlapped this refusal.
- Not fixed here (another lane's migration): removing the `DROP TRIGGER IF
EXISTS` line (the trigger has never been installed) leaves only `CREATE
TRIGGER`, whose SHARE ROW EXCLUSIVE does not wait on readers. The queued
  `20261106203853` and `20261107040516` files carry `ALTER TABLE` (ACCESS
  EXCLUSIVE on `cash_player_session` and `clubs`) and share the same exposure
  to any reader older than one second.

## Gaps left

- The new engine reaches the functions through PostgREST, whose schema cache
  reloads about 28 s after DDL; a cutover a few seconds after the install can
  see PGRST202 for those calls until the reload. pg_proc is the stated witness;
  the cache is not checked.
- The receipt reason for a conditional release that sealed does not mention
  the condition; the release summary does.
- The window install must finish inside the cutover's admission budget (about
  the first 55 s of the break). A slow or long queue refuses the release by
  name rather than shipping late.

Pinned by `tests/a-window-migration-door-is-admitted-only-on-condition.law.test.ts`.
