# Dedicated 3-Hour Engine Cutover Hardening Index (H1-H12, E1-E6 & O1-O16, 2026-11-21..2026-11-23)

This index records the live verification of the dedicated three-hourly engine cutover route (`#11609`, `c4c5d2efe50a`), the permanent root-cause hardening completed for every item H1-H12, the verified `19:00 CST` automatic engine replacement, enhancements E1-E6, and live-log-driven cutover optimizations O1-O16.

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
- **First Automatic 3-Hourly Engine Replacement (`2026-11-21T19` / 19:00 America/Chicago / 01:00Z 2026-11-22) SEALED LIVE (zero manual dispatch):**
  - Stage reservation & selection: run `44960337691` automatically reserved cycle `2026-11-21T19`, selected `c2d6e45e3bcc8447168c3aa7e76fbb1fbd16f0aa`, and dispatched the immutable release request automatically.
  - Receiver: `auto-deploy-hetzner.yml` run `44966984726` (`completed / success`).
  - Host receipt: `/var/lib/club-arena/engine-release-results/44966984726-1.json` (`result: "sealed"`, `sha: "c2d6e45e3bcc8447168c3aa7e76fbb1fbd16f0aa"`).
  - Cutover log: comment `7071937248` posted on GitHub issue `#11599` at `2026-11-22T01:02:03Z` listing `Previous seal: 1a0a6047e1acb1a037cd43b36d9907a00103c5e4` and all 33 included PRs since the previous seal (`#11591`, `#11628`, `#11634`, `#11635`, `#11636`, `#11638`, `#11644`, `#11645`, `#11646`, `#11647`, `#11648`, `#11649`, `#11650`, `#11651`, `#11652`, `#11653`, `#11654`, `#11657`, `#11658`, `#11661`, `#11662`, `#11663`, `#11664`, `#11665`, `#11666`, `#11667`, `#11668`, `#11669`, `#11670`, `#11671`, `#11672`, `#11674`, `#11675`).

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
- **Fix:** MERGED in PR `#11676` (`97f9847a29d825958d2556d6f23ec15d61eba7d2`) immediately after the `19:00 CST` cutover sealed; migration `20261121200024` (`supabase/migrations/20261121200024_lobby_close_and_spin_expiry_respect_maintenance_freeze.sql`) **APPLIED LIVE** via `Apply Merged Migration` run `44969988218`.
- **Why it broke:** Early `break` exited only the inner loop, leaving post-loop discovery sweeps unguarded in both TypeScript and Postgres `service_role` RPCs.
- **Barrier added:** Engine freeze gates in `GameServer.ts` and `TournamentManager.ts`, fail-closed `fn_platform_frozen() IS DISTINCT FROM false` pre-scan + in-loop guards in `supabase/migrations/20261121200024_lobby_close_and_spin_expiry_respect_maintenance_freeze.sql`, runtime replay test `server/src/maintenance/frozenDiscoverySweeps.test.ts` (replaying `2026-11-21T09:00:04Z` frozen -> thawed), `server/src/maintenance/theFreezeIsTotal.law.test.ts` pins, and `tests/lobby-close-and-spin-expiry-respect-maintenance-freeze.law.test.ts`. Changelog: `docs/changelog/2026-11-21-h10-rollback-rehearsal-seat-boundary-freeze-guards.md`.
- **Verified:** All 65/65 CI checks passed on `#11676` including `Production's DDL guards pass before merge`, `check-migration-hot-row-locks`, `a-banned-character-must-not-reach-the-database`, `frozenDiscoverySweeps` (2/2), `theFreezeIsTotal` (15/15), and `dr-posture` (120/120); merged to `main` (`97f9847a29d8`) and migration `20261121200024` verified APPLIED LIVE in run `44969988218`.

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

---

## Enhancement Records (E1-E6)

### E1: Prequalification waits once across the prestage blackout window

- **Symptom:** Under the 8 three-hourly cycles/day schedule, `scripts/ci/prestage-engine-image.sh` closes the host pull door for 35 minutes per cycle (`[start - 1800, start + 300)`, ~19.4% of the day). Commit `c2d6e45e3bcc` passed 4/4 server test shards in `engine-release-prequalification.yml` run `44954419290`, then failed solely because image staging reached the host during the `16:00 Chicago` preparation blackout (`production preparation window is closed`).
- **Root cause:** `.github/workflows/engine-release-prequalification.yml` (`prestage` job) streamed the candidate image over SSH immediately after building without checking whether the target policy's host prestage door was currently closed (or within the final 60 seconds before cutoff).
- **Fix:** MERGED in PR `#11686` (`66dc0ed1263b631e72de01625534ec81bfea3dfd`). Added a bounded, single-pass, DST-aware wait in `.github/workflows/engine-release-prequalification.yml` before SSH whenever `now` falls inside `[start - 1860, start + 300)`, sleeping once until `start + 305` (`<= 2165` s; zero loops, retries, watchers, or crons) and raising `prestage` `timeout-minutes` from `45` to `85`. Host `scripts/ci/prestage-engine-image.sh` remains 100% unchanged and fail-closed.
- **Barrier added:** `tests/the-engine-cuts-over-every-three-hours.law.test.ts` (validates `bash -n`, single `sleep` with zero loops, CST/CDT/fall-back/spring-forward/daily boundaries, and cross-checks wake instants against the unchanged host guard) and `tests/unit/qualificationJobCapacity.test.ts` (`prestage: 85`). Changelog: `docs/changelog/2026-11-21-e1-prequalification-waits-out-prestage-blackout.md`.
- **Verified:** Merged cleanly to `main` (`66dc0ed1263b`) with all required checks green.

### E2: Exclude verified non-runtime tests and sparring helpers from Docker build and source identity

- **Symptom:** Test-only and testing-helper PRs under `server/src/` invalidated the `engine-source-identity.sh` digest and forced redundant 55-minute Backup certifications despite producing identical production runtime binaries.
- **Root cause:** `server/.dockerignore` did not exist, `server/tsconfig.runtime.json` still included 82 non-runtime `*.test-support.ts`, `src/testing/**`, `src/engine/testing/**`, and `src/benchmark/Sparring*.ts` / `sparringRun.ts` files, and `scripts/ci/engine-source-identity.sh` hashed the unfiltered `server/src` git tree OID. (Import-graph audit proved 36 files in `server/src/benchmark/`, including `HorseLeague.ts`, ARE transitively imported by runtime modules and therefore remain hashed and compiled.)
- **Fix:** MERGED in PR `#11689` (`936dae67c7eb5e39735260dc3ec362bf4b28ac13`). Added positive-glob `server/.dockerignore`, aligned `server/tsconfig.runtime.json` `"exclude"` (1,235 runtime files down from 1,317), updated `scripts/ci/engine-source-identity.sh` to include `.dockerignore`'s blob OID, fail closed on unsupported glob syntax, and filter context `COPY` trees via `git ls-tree`, and added `server/.dockerignore` to `.github/workflows/engine-build-resource-proof.yml`.
- **Barrier added:** `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`, `server/src/engine/aHashedPolicySourceShipsInTheEngineImage.law.test.ts`, `server/src/engine/aRuntimeSourceImportsOnlyEmittedJson.law.test.ts`, and `tests/operations/engine-build-resource-proof.test.py`. Changelog: `docs/changelog/2026-11-21-e2-exclude-tests-and-benchmarks-from-engine-source-identity.md`.
- **Verified:** Merged cleanly to `main` (`936dae67c7eb`) with `tsc -p tsconfig.runtime.json --noEmit` (0 errors, 1,235 files) and all required checks green.

### E3: Eliminate Backup 75-minute lease-wait starvation and redundant certifications

- **Symptom:** Backup run `44957494061` (`2f2026bc1ef7`) and 6 earlier push runs timed out after 75 minutes (`4500` s) waiting behind a schema refresh + 55-minute certification (`44954419323`), while superseded push runs and identical-source descendants still waited for and executed redundant 55-minute soaks.
- **Root cause:** `backup-engine.yml`'s `refresh` job capped lease acquisition at `4500` s (`timeout-minutes: 120`, host lease TTL `7200` s), checked supersession only once in `plan`, and checked certificate inheritance only in `plan` before the active ancestor finished.
- **Fix:** MERGED in PR `#11687` (`644f8e1ee790a1d67f9c023818ecb48991fee9c2`). Raised `turn` lease-wait deadline to `7200` s (120 min), `refresh` `timeout-minutes` to `180`, and host lease TTL to `9000` s (150 min); added late supersession in `turn` and `late_priority` (never superseding `booking`, `freeze_baseline`, or non-push runs); and added `late_inherit` immediately after lease acquisition to inherit newly certified identical-source ancestors and release the lease immediately.
- **Barrier added:** Expanded `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts` and updated `docs/ENGINE-RELEASE-RUNBOOK.md` section 3.6. Changelog: `docs/changelog/2026-11-21-e3-eliminate-backup-lease-starvation.md`.
- **Verified:** Merged cleanly to `main` (`644f8e1ee790`) with all required checks green.

### E4: Read-only three-hourly engine cutover readiness CLI

- **Symptom:** Before every three-hourly cutover, all four lanes and the Dedicated Engine Cutover owner had to run four separate `curl`, `gh`, and `python3` commands to verify candidate readiness, `CONTROL_INPUTS` drift (`RC=3`), and cycle/hold timings.
- **Root cause:** No single read-only CLI combined live `/health`, DST-aware `America/Chicago` cycle/cutoff/hold schedules, active Stage/Backup runs, and first-parent candidate qualification status.
- **Fix:** MERGED in PR `#11685` (`edc2bd96c4a7a63ea971e7b18b628ffeda3101d6`). Added stdlib Python CLI `scripts/release/three-hourly-readiness.py` (strictly read-only, explicit `gh api --method GET`, `CONTROL_INPUTS` comparison via `scripts/ci/read-engine-prequalification.py`, verdicts `READY` / `IN_FLIGHT` / `NO_CANDIDATE` exit `0` and fail-closed `UNKNOWN` exit `3` per CLAUDE.md 10.86) and documented it in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`. (Extended in O5 with `--repo-dir` and `stage-engine-release.yml` `$GITHUB_STEP_SUMMARY` visibility.)
- **Barrier added:** `tests/operations/three-hourly-readiness.test.py`, `tests/the-three-hourly-readiness-cli-only-reads.law.test.ts`, and `docs/laws.d/the-three-hourly-readiness-cli-only-reads.md`. Changelog: `docs/changelog/2026-11-21-e4-three-hourly-readiness-cli.md`.
- **Verified:** Merged cleanly to `main` (`edc2bd96c4a7`) with all unit, law, and live smoke checks passing.

### E5: Container-safe engine image retention

- **Symptom:** Obsolete exact-SHA or candidate tags still referenced by an existing (e.g. exited) container caused `docker rmi` errors during `server/scripts/retain-engine-images.sh` cleanup.
- **Root cause:** `retain-engine-images.sh` did not inspect all existing Docker containers (`docker ps -a`) and their resolved image IDs before attempting removal of obsolete tags and dangling engine images.
- **Fix:** MERGED in PR `#11688` (`c30fa52a105e4346326bb1d44d28f115646a4d6d`). `server/scripts/retain-engine-images.sh` inspects all containers (`docker ps -a --no-trunc` + `docker container inspect -f '{{.Image}}'`) and skips any container-referenced ref or image ID with a clear stdout notice naming the ref, container ID, and status, while continuing to retire all other unreferenced obsolete images (never using `-f`/`--force` and never deleting containers).
- **Barrier added:** `tests/operations/retain-engine-images.test.py` and `tests/engine-release-seal.law.test.ts`. Changelog: `docs/changelog/2026-11-21-e5-e6-retain-images-and-3h-break-reporting.md`.
- **Verified:** Merged cleanly to `main` (`c30fa52a105e`) with all retention unit and seal law tests passing.

### E6: Three-hourly break scorecard & weekly report (plus `-- @probe-for` `shifted` boolean bug catch)

- **Symptom:** `fn_ca_record_break_scorecard` fallback (`break_never_started`) checked only the daily `04:05` Chicago anchor, and `fn_maintenance_week_report` carried stale hourly `24*window_days` wording and daily-only expectations. During live deployment of `#11688`, production's `-- @probe-for` live probe caught a real bug in `fn_maintenance_week_report`'s `total_shifted` aggregation when `engine_maintenance_thaws.shifted` JSONB rows held boolean metadata (`"applied": true` from v3 thaw rows), causing `(t.shifted ->> k)::bigint` to fail with invalid input syntax for type bigint.
- **Root cause:** Legacy scorecard/report SQL predated the three-hourly schedule, and `fn_maintenance_week_report` unconditionally cast every key of `engine_maintenance_thaws.shifted` to `bigint` via `jsonb_object_keys(t.shifted)` without filtering non-integer values or `NULL` rows.
- **Fix:** MERGED in PR `#11688` (`c30fa52a105e4346326bb1d44d28f115646a4d6d`) + immediate root-cause fix PR `#11691` (`f90aa478ae358011100a7787a93c69d39c982668`). Migration `supabase/migrations/20261122002835_three_hourly_break_scorecard_and_weekly_report.sql` (`20261122002835`) updated `fn_ca_record_break_scorecard` to detect three-hourly cadence from recent 24h break logs (all 8 Chicago hours `{1, 4, 7, 10, 13, 16, 19, 22}`, skipping repeated `01:00 CST` on fall-back day), updated `fn_maintenance_week_report` with cadence-aware `observed_cadence` / `expected_breaks_per_day` / `:00-:04` dealing buckets and safe `jsonb_each(...)` integer-only filtering (`jsonb_typeof(e.value) = 'number' AND (e.value #>> '{}') ~ '^-?[0-9]+$'`, handling `NULL` `shifted` rows), and **APPLIED LIVE** via `Apply Merged Migration` run `44976007994`.
- **Barrier added:** `scripts/ci/test-daily-maintenance-observation.py` (PostgreSQL 17 harness exercising boolean/decimal/nested/`NULL` `shifted` metadata, preimage check, replay refusal, `@live-proof` flip, daily/three-hourly/DST/emergency fallbacks, and `service_role`-only ACLs), `scripts/ci/accounting-harness-reads.json`, `scripts/dev/maintenance-week-report.sh`, and `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`. Changelog: `docs/changelog/2026-11-21-e5-e6-retain-images-and-3h-break-reporting.md`.
- **Verified:** Merged cleanly to `main` (`c30fa52a105e`, `f90aa478ae35`) and migration `20261122002835` verified APPLIED LIVE in run `44976007994`.

---

## Live Observations & Optimizations (O1-O16, 2026-11-22)

### Overnight Cycle Observations (`01:00 CST` & `04:00 CST`, 2026-11-22)

- **`01:00 CST` (`2026-11-22T01` / `07:00Z`) late-window migration race:** An ordinary migration landed after Backup DB export and before the `:30` preparation cutoff, breaking `Backup copy migrations == production installed migrations` and stranding candidates until a fresh export. Motivated **O3** (automatic per-cycle migration deferral) alongside **O1/O2/O4/O5**.
- **`04:00 CST` (`2026-11-22` / `10:00Z`) missed cutover (`keep-serving` at `09:31:08Z`, Stage `45000042559`; serving `c2d6e45e3bcc` stayed healthy):** Exact live-log analysis proved three distinct gaps:
  1. Backup `45000042601` (`07:50Z -> 09:41Z`, 62 min) certified stale freeze baseline `0a3a6a5211db` (`until = 23:15 CST`) even though O1-O5 (`06:43Z-06:45Z`) changed `CONTROL_INPUTS` with zero migrations, making `0a3a6a5211db` permanently unselectable (`RC=3`). Motivated **O6**.
  2. Backup `44997134858` (`07:12Z -> 08:39Z`, 87 min) and `45003864191` (`09:42Z -> 10:42Z`, 60 min) soaked commits (`3b54b071664e`, `e22a92341779`) carrying frozen/uninstalled migrations (`20261122025656`, `20261122025900`, `20261122054826`) held by `RELEASE_SCHEMA_FREEZE_CHICAGO` until `10:15Z` even though `refresh-due --wait 240` already knew they were still pending. Motivated **O7**.
  3. Running `scripts/release/three-hourly-readiness.py` at `09:43Z` (13m post-cutoff) displayed only the closed `2026-11-22` cycle without advancing to `NEXT OPEN CYCLE` (`2026-11-22T07`, `07:00 CST / 13:00Z`), showing whether Stage `45000042559` had already completed, or displaying the `MIGRATION GATE` (`NIGHTLY_FREEZE` / `O3_DEFERRAL` / `OPEN`). Motivated **O8**.

### Optimizations O1-O16 Summary

| ID      | Scope                                                                                                                                                                                                                                                                                                | PR / Commit               | Status & Key Files                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O1 + O2 | Backup mid-soak obsolete yield (`YIELDED_OBSOLETE`) and in-place `late_retarget` to newest server commit on `main`                                                                                                                                                                                   | `#11702` (`6d95b8a1b118`) | Merged `2026-11-22T06:44Z`; `.github/workflows/backup-engine.yml`                                                                                                                    |
| O3      | Automatic per-cycle three-hourly migration deferral `[cycleStart - 90m, cycleStart + 10m)` on three-hourly cadence                                                                                                                                                                                   | `#11697` (`0cbf3bd359c6`) | Merged `2026-11-22T06:44:52Z`; `scripts/ci/merged-migration-dispatch.mjs`, `.github/scripts/dispatch-merged-migrations.sh`                                                           |
| O4      | Exclude pure test files under `server/src/maintenance/` and `server/scripts/` from `CONTROL_INPUTS` `projection()` while keeping `recorded-migrations.manifest.json` and production/release files hashed                                                                                             | `#11703` (`a4f10be9f828`) | Merged `2026-11-22T06:43:18Z`; `scripts/ci/read-engine-prequalification.py`                                                                                                          |
| O5      | Add `--repo-dir` to `scripts/release/three-hourly-readiness.py`, read-only `$GITHUB_STEP_SUMMARY` in `stage-engine-release.yml`, and hardening index updates                                                                                                                                         | `#11701` (`34c79379f0f4`) | Merged `2026-11-22T06:45:21Z`; `scripts/release/three-hourly-readiness.py`, `.github/workflows/stage-engine-release.yml`                                                             |
| O6      | Freeze-baseline zero-migration advance and `CONTROL_INPUTS` selectability guard (`state=unselectable` skips wasted Backup soak)                                                                                                                                                                      | `#11732` (`b06d2db915bb`) | Merged `2026-11-22T16:16:59Z`; `scripts/ci/backup-freeze-baseline.py`, `.github/workflows/backup-engine.yml`                                                                         |
| O7      | Pre-soak uninstalled-migration deferral (`refresh-due` emits `pending=`; push Backup releases host lease cleanly with zero status write when ordinary migrations remain uninstalled)                                                                                                                 | `#11732` (`b06d2db915bb`) | Merged `2026-11-22T16:16:59Z`; `server/scripts/engine-release-installed-migrations.py`, `.github/workflows/backup-engine.yml`                                                        |
| O8      | Post-cutoff `NEXT OPEN CYCLE`, per-cycle O3 deferral / nightly freeze timestamps, deterministic `MIGRATION GATE` (`NIGHTLY_FREEZE` / `O3_DEFERRAL` / `OPEN`), and zero-extra-API-call `closedCycleStageRun` visibility                                                                               | `#11730` (`1eeeafcb4d77`) | Merged `2026-11-22T10:22:09Z`; `scripts/release/three-hourly-readiness.py`, `tests/operations/three-hourly-readiness.test.py`, `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`            |
| O9      | Exclude 34 verified unreferenced offline HUD/horse/benchmark/generator scripts under `server/scripts/` from `CONTROL_INPUTS` `projection()` (fail-closed default plus static release-surface law)                                                                                                    | `#11745` (`ea92b56f0177`) | Merged `2026-11-22T16:17:36Z`; `scripts/ci/read-engine-prequalification.py`, `tests/non-release-server-scripts-are-unreferenced-by-release-surfaces.law.test.ts`                     |
| O10     | Backup never re-soaks an already-current success (`due` + `comparable=` digest) and never overwrites a standing `success` with `pending` (`wrote=0/1`, `WROTE_PENDING`)                                                                                                                              | `#11732` (`b06d2db915bb`) | Merged `2026-11-22T16:16:59Z`; `.github/workflows/backup-engine.yml`, `server/scripts/engine-release-installed-migrations.py`                                                        |
| O11     | `turn` late supersession compares `backup_projection` alongside `engine-source-identity` and `backup-engine.yml`                                                                                                                                                                                     | `#11753` (`4af4a9f8c440`) | Merged `2026-11-22T19:08:21Z`; `.github/workflows/backup-engine.yml`                                                                                                                 |
| O12     | Readiness loads `read-engine-prequalification.py` from the control SHA git blob, never a stale working tree                                                                                                                                                                                          | `#11761` (`10737e51fe1a`) | Merged `2026-11-22T19:08:06Z`; `scripts/release/three-hourly-readiness.py`                                                                                                           |
| O13     | Backup `late_retarget` follows main's newest commit touching `server/` or any `CONTROL_INPUTS` path (read locally from the checkout, no extra API call), so the lease holder never certifies a commit whose release-control projection main has already replaced                                     | `#11786` (`c47823d9e6f4`) | Merged `2026-11-23T01:07:18Z`; `.github/workflows/backup-engine.yml`, `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`                                            |
| O14     | Readiness names each active run's triggering event and marks a `pending` certificate whose owning Backup run already completed (O1 yield, stand-down, cancel) as not in flight, from the same single recent-runs read                                                                                | `#11783` (`806ab6b465c3`) | Merged `2026-11-22T22:31:18Z`; `scripts/release/three-hourly-readiness.py`, `tests/operations/three-hourly-readiness.test.py` (19 tests), `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` |
| O15     | Post-seal Backup custody counts its own run id, so GitHub's lagging run list can no longer make the first and only delivery refuse a seal; every refusal in that step names its reason                                                                                                               | `#11786` (`c47823d9e6f4`) | Merged `2026-11-23T01:07:18Z`; `.github/workflows/backup-engine.yml`, `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`                                            |
| O16     | O1 stops a soak for a migration-only divergence only once production actually holds a version or required definition the soaking copy lacks (read-only `refresh-due` comparison), so a merged-but-deferred migration (O3 or the nightly freeze) no longer stops the cycle's one selectable candidate | This PR                   | `.github/workflows/backup-engine.yml`, `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`                                                                           |

### Live Verification Of O1, O6, O7, O10 And O11 (2026-11-22, successor audit)

Read-only audit by the successor lane owner (Claude `session_01BbZPDhXdXDpg2o2kKZWmd1`) of every change between `1a0a6047e1ac` and `4af4a9f8c440`:

- **O6:** `refs/remotes/origin/main:scripts/ci/backup-freeze-baseline.py --now 2026-11-23T06:00:00Z` printed `state=due`, `baseline=a0a85b117bed`, `freezeStart=2026-11-23T05:45:00Z`, exit `0`, no warnings. `parse_control_spec()` reads all five literal constants (14 inputs, 11 non-release prefixes, 2 exact paths); `scripts/ci/recorded-migrations.manifest.json` and `server/src/maintenance/maintenanceSchedulePolicy.json` stay hashed, `server/scripts/opponent-hud-*` and maintenance unit tests stay excluded.
- **O10:** Backup `45064246851` (`88b8dac0ebdc`) printed `contentsDue=true due=true`, took the `wrote=1` branch, and `Publish the verdict` ran with `WROTE_PENDING: 1` and no unbound-variable or syntax errors before writing `success` at `21:15:44Z`.
- **O11:** Backup `45072560972` (`80c9b738ee1d`) stood down at its host-turn step for the newer `7a54cc2c1746` push run and wrote no status.
- **O1:** Backup `45062381383` (`59d700196f6f`) yielded at `20:15:43Z` with no failure or error status, leaving `pending`. `scripts/ci/select-daily-engine.py` admits only `success`, so the leftover `pending` cannot select or block anything (the `16:00 CST` cycle selected `88b8dac0ebdc` past it); O14 now labels it in readiness instead of showing it as in flight.

### 16:00 CST And 19:00 CST Cycles (2026-11-22, successor lane owner)

- **16:00 CST SEALED** `88b8dac0ebdca1cb5a41d8c566be7dd9a33171c5`: Stage `45063394683`, Receiver `45072521889` (all jobs success), `#11599` comment `22:01:33Z` (19 PRs). Live `/health` `22:08:26Z`: instance `1-4623dc3d`, phase `idle`, 0 stalled, 72 dealable tables, settlement ok.
- **O15 root cause (found on this seal):** post-seal Backup `45075415442` refused at `22:02:28Z` with a bare exit 1. Every proof passed on replay; the receiver's own poll first listed that run at `22:02:34Z`, so the created-filtered run list had not yet listed the run itself and custody read `null`. Same 8-second failure on 2026-11-20 (`44827012024`). Fixed by O15.
- **Migration queue stall before 19:00 CST:** `20261122192807` (`#11771`) refused at `22:10:56Z` after the parallel `20261122185915` (`#11765`) installed first, and the applier then held `20261122201323`, `20261122203048` and `20261122205903` in order, so no newer commit could certify. One writer was chosen (`#11785`, verify-only, merged `22:45:19Z`; the competing re-anchor `#11787` was closed); all five were installed by `22:49:27Z` with no hand dispatch.
- **Late migration inside the hold:** `#11788` installed `20261122222254` at `23:22:41Z`, making the completed `49176f684f61` certificate stale. Backup `45082767288` read production one second later and certified `735299cd5fda` at `00:21:47Z`, 8 minutes before the prep cutoff.
- **19:00 CST SEALED** `735299cd5fda6b59c43d1379371d1a3dfb1a050f`: Stage `45080738084`, Receiver `45089231248` (all jobs success), `#11599` comment `2026-11-23T01:01:31Z` (17 PRs). Live `/health` `01:07Z`: instance `1-dc0a3946`, phase `idle`, 0 stalled, 84 dealable tables, settlement ok.
- **Client finding handed to its lane:** Post-Deploy E2E `45075415440` (16:00 CST seal) failed only its live mobile layout check, `Six-Max Crown Does Not Meet The Top Bar` at 320, 390 and 430 px, a rule added by `#11774`; every engine-side job passed.

### 22:00 CST Cycle (2026-11-23 04:00Z): Kept Serving

- `#11790` installed `20261122232612` at 01:47Z, after the leading candidate's copy (`1e5c5ce026bc`, 01:29Z). O1 stopped that soak at 02:15:24Z; the waiting post-seal clone refresh of `735299cd5fda` (Backup `45092236459`) was cancelled so the host went to the next candidate (it never held the host and wrote no status).
- `#11797` installed `20261123000232` at 02:17:16Z; Backup `45099104481` waited for it (due step ended 02:17:20Z) and soaked `a9fde5791f0a` on a complete copy.
- At 02:44:02Z O1 stopped that soak because main gained `20261123002808` (`f2fa22672808`, merged 02:43:46Z inside the O3 deferral, not installed). This is the O16 defect. At 02:49Z the author recorded that version in production by hand as held and not executed (to avoid a double promo payment), which any earlier copy lacks, so the cycle would have been lost either way. With about 46 minutes left no full soak could finish by 03:30Z; production kept serving `735299cd5fda`.
