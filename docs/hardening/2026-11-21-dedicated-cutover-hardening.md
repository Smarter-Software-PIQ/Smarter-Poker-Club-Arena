# Dedicated 3-Hour Engine Cutover Hardening Index (H1-H12, 2026-11-21)

This index records the live verification of the dedicated three-hourly engine cutover route (`#11609`, `c4c5d2efe50a`) and the permanent, root-cause hardening completed for every item H1-H12 ordered by the owner on 2026-11-21.

## Live Production Verification (2026-11-21)

- **1906z cutover (`2026-11-21-owner-no-notice-engine-1906z`) SEALED:**
  - Backup certification: run `44934752464` (`completed / success`, `19:38:45Z`).
  - Stage dispatch (sole custodian Alert Root-Fix): run `44942163927` (`completed / success`, `19:40Z`).
  - Receiver: `auto-deploy-hetzner.yml` run `44942263145` (`completed / success`, `19:41Z -> 19:53:10Z`).
  - Host receipt (`/var/lib/club-arena/engine-release-results/44942263145-1.json`): `result: "sealed"`, `sha: "1a0a6047e1acb1a037cd43b36d9907a00103c5e4"`, `instanceId: "1-9360baaf"`.
  - Live `/health`: `releaseSha: "1a0a6047e1acb1a037cd43b36d9907a00103c5e4"`, `frequency: "three-hourly"`, `startHours: [1,4,7,10,13,16,19,22]`, `policyId: "three-hourly-01Gw7aDs"`, `phase: "idle"`, `recoveryWindowReady: true`, `stalledTables: []`.
  - Cutover log: comment posted on GitHub issue `#11599` at `19:48:30Z`.
  - Migration installers resumed at `20:05Z` (`apply-merged-migration.yml` and `dispatch-merged-migrations.yml` active; all 8 paused migrations applied cleanly).
- **First Automatic 3-Hourly Slot (`2026-11-21T16` / 16:00 America/Chicago / 22:00Z) VERIFIED LIVE (zero manual dispatch):**
  - Stage run `44948953072` (`completed / success`, `20:57:05Z -> 21:30:32Z`, `CUTOFF_EPOCH=1795296600`, `LOOKBACK_SECONDS=6000`) automatically reserved cycle `2026-11-21T16`, skipped daily-only window migrations, ran `Record the daily release evidence`, and uploaded artifact `daily-engine-selection-2026-11-21T16` (`14725802639`).
  - Selection outcome: `keep-serving` (`"No newer protected candidate has complete current evidence by the cutoff."`; `02fa516cbdce` deferred for `serving rollback rehearsal unavailable` against new `1a0a6047e1a`).
  - Live engine executed the automatic `16:00-16:05 America/Chicago` break (`phase: "counting_down"` at `22:04:38Z` -> thawed cleanly to `phase: "idle"`, `recoveryWindowReady: true`, `stalledTables: []` at `22:05:05Z`, `nextAnnouncementAt` advanced to `1795309080000` = `18:58 Chicago` for `19:00 Chicago / 01:00Z`).
  - Next automatic slot (`19:00 Chicago / 01:00Z`) automatically reserved by Stage run `44960337691`.

---

## Hardening Records (H1-H12)

### H1 (D1): Wall-clock flake in `decide()` determinism laws
- **Symptom:** Shard 4 of `engine-release-prequalification.yml` failed on every main commit from `09:32Z` to `14:54Z` (`AHoldemTournamentAllInCallIsPriced.law.test.ts` byte comparison failed when the second `decide()` call hit `utilityOwner: "phase7_unavailable"`, `utilityUnavailableReason: "operation_budget"`).
- **Root cause:** `HorseLogic.ts` shadow joint sampling enforces a 4 ms `performance.now()` budget (`JointSampleAcquisition.ts:51`). Byte-comparison tests stripped `*Ms` fields via `withoutClocks` without freezing `performance.now()`.
- **Fix:** Initial fix `#11618` (`5ef8e6cb5a55`); permanent repo-wide hardening `#11673` (`2f2026bc1ef724d58fd5f512d5e9d34d32e46f04`).
- **Why it broke:** Commit `ea4030176aa` added a byte-compare determinism law without freezing the wall clock read by the budget gate; no static law checked determinism tests for unfrozen clocks.
- **Barrier added:** Shared helper `server/src/engine/testing/frozenDecisionClock.ts` (`freezeDecisionClock`, `withFrozenDecisionClock`, 5/5 tests), hardened all 9 clock-stripping decision tests found across 2,444 server test files, plus repo-wide static law `tests/decision-determinism-tests-freeze-the-clock.law.test.ts` (registered in `docs/laws.d/decision-determinism-tests-freeze-the-clock.md`). Changelog: `docs/changelog/2026-11-21-h1-frozen-decision-clock-law.md`.
- **Verified:** `cd server && npx tsc --noEmit && npx tsc -p tsconfig.runtime.json --noEmit` (0 errors); 10/10 server test files (350/350 tests); 3/3 root law files (1874/1874 tests); negative-test proof confirmed removing the freeze fails the law; live `engine-release-prequalification.yml` run `44957494034` on `2f2026bc1ef7` passed 100% after 3 prior failures.

### H2 (T1): Invisible `prequalification unavailable` deferrals in Stage
- **Symptom:** Stage runs completed green (`success`) while `daily-selection.json` silently kept serving with `deferredCandidates[].reason: "prequalification unavailable"` and discarded stderr from `read-engine-prequalification.py`.
- **Root cause:** `select-daily-engine.py` discarded helper stderr, `read-engine-prequalification.py` omitted the failing run ID from refusal text, and `stage-engine-release.yml` emitted no visible annotation on `keep-serving` deferrals.
- **Fix:** `#11628` (`27cc96e20dc1`, `detail` field in `select-daily-engine.py`), `#11669` (`c2d6e45e3bcc8447168c3aa7e76fbb1fbd16f0aa`, run IDs in `read-engine-prequalification.py` + Stage `::error::` annotation on `keep-serving` with deferred candidates), and `#11672` (`09986930d3db`, prequalification check added to playbook Step 7 preflight).
- **Why it broke:** Exit code 3 was collapsed to a generic string without stderr preservation or workflow visibility.
- **Barrier added:** `tests/operations/engine-prequalification.test.py` (17/17 OK), `tests/operations/daily-engine-selection.test.py` (13/13 OK), and shell execution tests of `stage-engine-release.yml` `freeze` in `tests/the-live-engine-only-receives-a-backup-certified-version.law.test.ts` (27/27 passed). Changelog: `docs/changelog/2026-11-21-h2-h9-release-selection-and-backup-priority.md`.
- **Verified:** All 42/42 checks green on `#11669`; `git merge-base --is-ancestor c2d6e45e3bcc refs/remotes/origin/main` OK.

### H3 (D2): Fixture image Debian PostgreSQL pins
- **Symptom:** Debian 13.8 removed `postgresql-17=17.11-0+deb13u1` and `wal2json=2.6-2+b1` from `deb.debian.org`, failing `Native fixture prerequisites` and the required `TypeScript Check` repo-wide (exit 100).
- **Root cause:** Exact APT version pins against a rolling Debian main index break at every point release.
- **Fix:** `#11613` (`8d01508d3d4f`, merged by Horse SWITCH lane; our alternative `#11617` closed unmerged). Audited in `#11671` (`9ae53b5fce5b`).
- **Why it broke:** APT resolved packages from the rolling archive rather than content-addressed SHA-pinned `.deb` files.
- **Barrier added:** `operations/release/fixture/Dockerfile` (`postgres-debs` stage pins all 7 `.deb` files by exact pool path, SHA-1, and SHA-256 with `deb.debian.org` -> `debian-security` -> `snapshot.debian.org/file/<sha1>` fallback while keeping `snapshot.debian.org` out of APT `sources.list`), enforced by `tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts`. Audit confirmed zero remaining gap.
- **Verified:** `npx vitest run tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts` passed; `git merge-base --is-ancestor 8d01508d3d4f refs/remotes/origin/main` OK.

### H4 (D3): Windows lapsed when a single custodian session went silent
- **Symptom:** Windows `0825z` and `1135z` expired or sat undispatched for hours after the prior custodian session stopped posting.
- **Root cause:** Manual owner-window dispatch required a single live agent chat to remain active across certification and dispatch, with no documented takeover protocol.
- **Fix:** `#11609` (`c4c5d2efe50a`, automatic three-hourly scheduled cutover removing manual dispatch from routine releases) + `#11672` (`09986930d3db5e08817a3d5183fc1eb707df3536`, documented `Custody Liveness` takeover protocol in `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md`).
- **Why it broke:** Manual dispatch created a single point of failure on chat session liveness.
- **Barrier added:** `tests/the-engine-cuts-over-every-three-hours.law.test.ts`, `tests/the-runbook-names-what-it-cites.law.test.ts`, plus documented 20-minute liveness / `TAKING CUSTODY` + 5-minute objection rule in `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md`. Changelog: `docs/changelog/2026-11-21-h4-h5-h8-h11-owner-window-custody-hardening.md`.
- **Verified:** First automatic 3-hourly slot (`2026-11-21T16`, Stage `44948953072`) and live engine break (`22:00-22:05Z`) verified live with zero manual dispatch.

### H5 (D4): Bookings went stale from release-control merges during open windows
- **Symptom:** Bookings `0700z` -> `0745z` -> `0825z` went stale when PRs merged into release-control files while an owner window was open.
- **Root cause:** `scripts/ci/release-freeze-scope.mjs` checked only repository variable `MAIN_RELEASE_FREEZE` and missed active unsealed windows recorded in `server/release/owner-maintenance-windows.json` + `server/release/activation-floor.json`.
- **Fix:** `#11672` (`09986930d3db5e08817a3d5183fc1eb707df3536`).
- **Why it broke:** Manual repo-var toggling drifted from the authoritative booking JSON on `main`.
- **Barrier added:** `scripts/ci/release-freeze-scope.mjs` (`activeHold()`) and `.github/workflows/release-inputs-hold.yml` now automatically flag PRs touching GUARDED release-control paths whenever an active unsealed owner window exists on `main`, while preserving the 2026-09-11 and 2026-11-19 owner ruling that this check remains informational (NOT a required branch-protection merge gate, recorded explicitly in the changelog and runbook). Pinned by 3 new tests in `tests/operations/main-freeze-status.test.mjs` (16/16 pass) and `tests/unit/mainFreezeStatus.test.ts`.
- **Verified:** `tests/operations/main-freeze-status.test.mjs` 16/16 pass; `#11672` merged cleanly.

### H6: Remaining deliberate boundaries of the 3-hourly route (a-e)
- **Symptom:** Surface audit identified 5 surfaces with daily/04:00 assumptions: (a) 03:00 readiness / 04:30 missed-cutover watches, (b) `fn_ca_record_break_scorecard`, (c) `fn_maintenance_week_report`, (d) Backup freeze baseline, and (e) pre-deploy web clients showing `unknown` until refreshed.
- **Root cause:** Deliberate scoping of nightly schema-freeze and daily-anchor watches vs undocumented residual framing in legacy SQL helpers and client refresh transitions.
- **Fix:** `#11671` (`9ae53b5fce5baad435dfe6ebd66ce20435b5996c`) audited all 5 surfaces and documented their exact contracts and boundaries in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` without adding any new cron or watcher: (a) and (d) stay 04:00 anchor by design; (b) grades every cycle that runs via `engine_maintenance_break_log` while missed daytime cycles log to `#11599`; (c) legacy ad-hoc `service_role` report documented; (e) pre-deploy client fallback documented.
- **Barrier added:** Documented in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` and `docs/changelog/2026-11-21-h12-workspace-ssd2-and-tmpdir-hygiene.md`.
- **Verified:** 8/8 scoped vitest files (226/226 tests) passed; `#11671` merged cleanly.

### H7 (D5): Independent review findings on `#11609` (`199438df`)
- **Symptom:** Independent review of `#11609` found 4 defects before merge (CDT cron gap, punctual-cron law pinned to v1 policy, unconditional prestage closure of all 8 windows on daily engines, wall-clock admission of repeated fall-back `01:00`).
- **Root cause:** Hand-written v1 fixture in test and DST edge omissions.
- **Fix:** Fixed in `199438df` / `#11609` (`c4c5d2efe50a`), independently re-verified on `origin/main` in `#11672`.
- **Barrier added (verified by file:line on `origin/main`):**
  1. CST (`2026-12-15`) & CDT (`2027-06-15`) coverage: `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts:622-655`.
  2. Host `prestage` policy-driven closure & repeated fall-back `01:00`: `tests/the-engine-cuts-over-every-three-hours.law.test.ts:240-268`.
  3. All 3 `daily=` first-occurrence admissions (`server/scripts/engine-release-transaction.sh:686,1554,1843`): `tests/the-engine-cuts-over-every-three-hours.law.test.ts:215-239`.
  4. `daily_cutover_clock` first fall-back `01:00` (`server/scripts/engine-release-transaction.sh:1419`): `tests/the-engine-cuts-over-every-three-hours.law.test.ts:201-214` and `tests/the-break-clocks-agree.law.test.ts:164`.
- **Verified:** `grep` + vitest law runs on `origin/main` passed.

### H8 (D6): Booking PR stuck 40 min on `Ownership map` check
- **Symptom:** Booking PR `#11640` lacked `Lane: release-custody` in its initial PR body; re-running `Ownership map` replayed the original webhook payload and kept failing for 40 minutes.
- **Root cause:** `scripts/release/book-owner-engine-window.py` did not emit a PR body or `gh pr create` command containing `Lane: release-custody`.
- **Fix:** `#11672` (`09986930d3db5e08817a3d5183fc1eb707df3536`).
- **Why it broke:** Required PR ownership metadata was left to manual author memory at PR creation time.
- **Barrier added:** `OWNERSHIP_LANE = 'release-custody'`, `pr_body()`, `pr_create_instructions()`, and `--pr-body-out <path>` in `scripts/release/book-owner-engine-window.py`; unit test `test_emits_release_custody_lane_for_pr_creation_and_optional_body_file` in `tests/operations/book-owner-engine-window.test.py` (12/12 OK) pinned by `tests/an-owner-engine-window-is-booked-by-one-command.law.test.ts`.
- **Verified:** `TMPDIR=/private/tmp python3 -B tests/operations/book-owner-engine-window.test.py` 12/12 OK; `#11672` merged.

### H9 (T7): Post-booking push runs starved booked window's Backup certification
- **Symptom:** Post-booking push run `44934907493` raced onto the single first-come Backup host ahead of `1906z` booking run `44934752464`, threatening its 75-minute turn timeout and requiring manual cancellation.
- **Root cause:** `scripts/ci/backup-candidate-priority.py` classified post-booking commits as `candidate` even while the booking commit itself was still uncertified, so `backup-engine.yml` did not yield.
- **Fix:** `#11669` (`c2d6e45e3bcc8447168c3aa7e76fbb1fbd16f0aa`).
- **Why it broke:** Only `predates` commits yielded to a live booking; post-booking commits competed equally for the host lease.
- **Barrier added:** `scripts/ci/backup-candidate-priority.py` walks first-parent history (bounded 50 commits) to check the booking commit's `backup-engine/certified` status and returns `booking_pending` while uncertified (failing closed to `unknown` per CLAUDE.md 10.86); `.github/workflows/backup-engine.yml` defers `booking_pending` runs in `plan` and releases the lease with `deferred=1` in `refresh` `late_priority`. Pinned by `tests/operations/backup-candidate-priority.test.py` (14/14 OK) and `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts` (127/127 passed).
- **Verified:** 14/14 Python tests + 127/127 TS law tests + 42/42 CI checks on `#11669`.

### H10 (D7): Backup rollback rehearsal `rollback_rehearsal_failed_to_bb21dc826731`
- **Symptom:** Backup run `44887083680` (`2026-11-21T09:04Z`) refused `f94c25f0` with `rollback_rehearsal_failed_to_bb21dc826731` (`ca-backup` `trials.jsonl:591`: `frozen_seat_boundary:boundary_changed:count`, `138 -> 132` at `09:00:04.384Z`, 4 seconds after `03:00:00 America/Chicago`; identical prior failure at `trials.jsonl:373` on `2026-11-16T09:00:06Z`, `125 -> 115`).
- **Root cause:**
  1. In `server/src/GameServer.ts` (`discoverTournaments`), the loop broke on `isMaintenanceFrozen()` and fell through to three post-loop sweeps lacking `isMaintenanceFrozen()` guards: `fn_daily_window_close_seat_first_lobbies` (`lastLobbyCloseAt = 0` on boot -> fired immediately after `03:00:00 Chicago` = `09:00:00Z`, cancelling open Spin/SNG lobbies via `atomic_cancel_tournament` and vacating 6 seats while frozen), `fn_spin_expire_unfilled`, and `repairOrphanedTournamentSeats()` / `TournamentManager.absorbOrphanedSeats()`.
  2. In Postgres, `fn_daily_window_close_seat_first_lobbies` and `fn_spin_expire_unfilled` ran under `service_role` (exempt from `zz_freeze_guard` for in-flight hand settlement) without checking `public.fn_platform_frozen()`, so unpatched predecessors during rollback rehearsals also vacated `table_seats` while frozen.
- **Fix:** PR `#11676` (`fix/h10-rollback-rehearsal-seat-boundary`, HEAD `c1ea5e3026d6a00dffbde40fe972552a3b0b6ca3`, **65/65 CI checks GREEN, `CLEAN`** - held from merge during the `23:15Z -> 01:10Z` combined hold for the `19:00 Chicago` cutover per `COORDINATION-INBOX.md` `23:11:38Z`, merging immediately after `19:00 Chicago` seals).
- **Why it broke:** Early `break` exited only the inner loop, leaving post-loop discovery sweeps unguarded in both TypeScript and Postgres `service_role` RPCs.
- **Barrier added:** Engine freeze gates in `GameServer.ts` and `TournamentManager.ts`, fail-closed `fn_platform_frozen() IS DISTINCT FROM false` pre-scan + in-loop guards in `supabase/migrations/20261121200024_lobby_close_and_spin_expiry_respect_maintenance_freeze.sql`, runtime replay test `server/src/maintenance/frozenDiscoverySweeps.test.ts` (replaying `2026-11-21T09:00:04Z` frozen -> thawed), `server/src/maintenance/theFreezeIsTotal.law.test.ts` pins, and `tests/lobby-close-and-spin-expiry-respect-maintenance-freeze.law.test.ts`. Changelog: `docs/changelog/2026-11-21-h10-rollback-rehearsal-seat-boundary-freeze-guards.md`.
- **Verified:** All 65/65 CI checks passed on `#11676` including `Production's DDL guards pass before merge`, `check-migration-hot-row-locks`, `a-banned-character-must-not-reach-the-database`, `frozenDiscoverySweeps` (2/2), `theFreezeIsTotal` (15/15), and `dr-posture` (120/120). Pending post-hold merge & `Apply Merged Migration` live install proof after `19:00 Chicago` seals.

### H11 (T5): `resume-migration-installs.sh` refused inside `:50-:03 UTC` DDL window
- **Symptom:** Running `resume-migration-installs.sh` at `:48 UTC` returned exit 4 (`REFUSED: minute-of-hour :48 UTC is inside the database's :50-:03 DDL refusal`) and cost a retry cycle.
- **Root cause:** Usage comments and playbook Step 10 did not state the `:05-:49 UTC` operational window.
- **Fix:** `#11672` (`09986930d3db5e08817a3d5183fc1eb707df3536`).
- **Barrier added:** Updated header usage, stderr usage text in `scripts/release/resume-migration-installs.sh`, and Step 10 of `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md` to state `Run at :05-:49 UTC (refuses at :48-:04 UTC for the database :50-:03 DDL refusal window)`, pinned in `tests/a-paused-migration-install-resumes-what-merged-during-it.law.test.ts`.
- **Verified:** `#11672` merged cleanly with all checks green.

### H12: Environment hygiene (`scripts/agent-workspace.sh` SSD2 + macOS `TMPDIR` test)
- **Symptom:** `scripts/agent-workspace.sh` did not probe SSD2 (`extreme-capacity`) and `tests/operations/release-recovery-read.test.py` failed 13 tests under default macOS `TMPDIR=/var/folders/...`.
- **Root cause:** `choose_agent_worktree_root` probed only `$ssd/$repo` and `$ssd/shared-capacity/$repo` (omitting SSD2 `$ssd/extreme-capacity/$repo`), and `ControlInventoryTests.fixture` compared symlinked `/var/folders/...` against `_control_inventory_at`'s strict `link.resolve(strict=True)` (`/private/var/folders/...`).
- **Fix:** `#11671` (`9ae53b5fce5baad435dfe6ebd66ce20435b5996c`).
- **Barrier added:** `scripts/agent-workspace.sh` now probes `$ssd/extreme-capacity/$repo` -> `$ssd/$repo` -> `$ssd/shared-capacity/$repo` with `[ -d "${cand%/*}" ]` and refuses internal fallback when `$ssd` exists (pinned in `tests/unit/agentTreesLiveOnTheSsd.test.ts` and `tests/unit/agentWorktreeRootIsProvedWritable.test.ts`); `tests/operations/release-recovery-read.test.py` resolves `Path(folder).resolve()` in `ControlInventoryTests.fixture` without weakening any production security assertion, and `tests/a-release-recovery-observation-reads-only-its-run.law.test.ts` uses `loadAwareTestTimeout(25_000)`. Changelog: `docs/changelog/2026-11-21-h12-workspace-ssd2-and-tmpdir-hygiene.md`.
- **Verified:** `python3 -B tests/operations/release-recovery-read.test.py` under default macOS `TMPDIR=/var/folders/...`: 196/196 OK (4 skipped); `#11671` merged cleanly (30/30 green).
