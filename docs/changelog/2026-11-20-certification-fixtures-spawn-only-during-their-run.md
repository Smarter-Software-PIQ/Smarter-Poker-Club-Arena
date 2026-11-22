# Certification fixtures spawn only during their run (2026-11-20)

## What was wrong, read from rows

- Club Create Certification run 44177065584 (2026-11-17 21:10 UTC) created
  `Crest Cert 1794950026440-vqxq6` (`aa090f23-7d6e-4b2d-9b86-267ad2dc34d5`) and
  `Preset Crest Cert 179495002644` (`67f8f585-3841-45c0-bce7-914f4404f15f`),
  owned by a reserved `ca-customization-cert-postdeploy-direct-*` identity.
- The run passed, and its cleanup did run: both clubs were set
  `status='inactive'`. The retirement door then failed
  (`club_notice_access_events_club_id_fkey`), so both stayed
  `lifecycle_status='active'`.
- The welcome package's `Daily 25 Chip Freezeout` schedule
  (`20fe9e9b-...`, 19:00 UTC) kept spawning: three boards inside the run, then
  one per day (11-21, 11-22 and 11-23 were REGISTERING with zero entries on
  2026-11-20). The empty boards helped page `TournamentNeverStarted`.
- On 2026-11-20 it was the only active schedule among the 544 that a gate keyed
  on reserved owner and the 162-minute floor would stop.

## The root, and the fix

Nothing tied a certification fixture's schedule to the run that made it.

1. **The database gate**
   (`20261121000812_certification_fixture_schedule_spawns_only_during_its_run.sql`).
   Every occurrence a schedule produces starts with one write: the spawn-claim
   INSERT into `tournament_schedule_spawns`, on both the standard and the
   Diamond path. The trigger
   `trg_ca_certification_fixture_spawns_only_during_its_run` refuses that claim
   when the schedule's club is owned by a reserved certification identity
   (`fn_ca_reserved_certification_identity`) and is more than 162 minutes old.
   That is the same floor the residue sweep uses (`STALE_ACCOUNT_AGE_MS`). The
   refusal uses SQLSTATE 23505, which the running engine's `claimSpawn` already
   handles by standing down quietly: no board, no table, no horse registration,
   no error report and no missed-event page. The engine needs no release for
   this. A certificate that tests the welcome package keeps working, because it
   checks the schedule row and its first spawns land within a minute of
   creation.
2. **The run's own cleanup runs on every exit**
   (`scripts/ci/certification-run-cleanup.mjs`). `certify-club-create`,
   `certify-rabbit-hunt` and `certify-heads-up-rematch` already retired their
   fixtures in a `finally`. A `finally` does not run when the runner cancels or
   times out a job, because SIGINT and SIGTERM end Node straight away. Each
   script now wraps its cleanup in `cleanupOnce` and installs `retireOnSignal`
   before it creates anything. A signal now runs the same guarded retirement
   (`retireCertificationClubWithRetry`, `settleRabbitHuntClub` ->
   `fn_retire_settled_club`) once, and only then exits with the signal's status.
   The normal `finally` reuses that same cleanup run, so the fixture is never
   retired twice. No row is deleted by hand.

Pinned by `tests/a-certification-fixture-spawns-only-during-its-run.law.test.ts`.

## Not changed here

- The fixture's already-spawned boards. An empty board is cancelled at its
  start by the engine (#11530). The two residue clubs above are retired by the
  guarded residue sweep (`cert-residue-sweep.yml`) once #11530's cleanup-door
  migration is installed.
- The Spin and Sit & Go board and the welcome cash tables of a leaked fixture.
  The gate covers scheduled tournaments only.
- The engine. The gate uses the answer the current engine already obeys.
