# 2026-11-21 Owner Window Custody, Booking, Resume, and Hold Hardening (H4, H5, H7, H8, H11)

## Summary

Hardens owner-window booking, release-control hold detection, migration resume timing guidance, and cutover playbook custody/preflight procedures after lessons observed during the November 21, 2026 three-hourly cutover programme.

## Changes

### H8 (D6): Booking PR `Lane: release-custody` at creation

- **Symptom**: Booking PR #11640 was opened without `Lane: release-custody` in its description and stalled 40 minutes on the Ownership map locked-area check (`.github/workflows/ownership-map.yml`, `ops/ownership.json`).
- **Fix**: Updated `scripts/release/book-owner-engine-window.py` to define `OWNERSHIP_LANE = 'release-custody'`, emit ready-to-run `gh pr create` next-step instructions containing `Lane: release-custody` on its own line in `describe()`, and accept optional `--pr-body-out <path>` to write the complete PR description starting with `Lane: release-custody`. Updated `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md` step 4 to match.
- **Barrier**: Added `test_emits_release_custody_lane_for_pr_creation_and_optional_body_file` in `tests/operations/book-owner-engine-window.test.py` and updated the pinned test count (`Ran 12 tests`) in `tests/an-owner-engine-window-is-booked-by-one-command.law.test.ts`.

### H11 (T5): `resume-migration-installs.sh` `:05-:49 UTC` timing guidance

- **Symptom**: Custodians running `scripts/release/resume-migration-installs.sh` near the top of the hour hit exit 4 inside the `:48-:04 UTC` margin for the database `:50-:03 UTC` DDL refusal window because neither usage text nor playbook step 10 stated the permitted run band up front.
- **Fix**: Updated `scripts/release/resume-migration-installs.sh` header usage comment and invalid-usage stderr output, plus `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md` step 10, to state: `Run at :05-:49 UTC (refuses at :48-:04 UTC for the database :50-:03 DDL refusal window)`.
- **Barrier**: Added assertions in `tests/a-paused-migration-install-resumes-what-merged-during-it.law.test.ts` pinning the usage comment, invalid-usage stderr text, and playbook step 10 timing rule.

### H4 + H2: Custody liveness and prequalification preflight in the cutover playbook

- **Custody liveness (H4)**: Added `### Custody Liveness` to `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md`: if a booked window's custodian posts nothing within 20 minutes of both `backup-engine/certified` and `engine-release-prequalification.yml` going green while the window is open, another named lane may confirm read-only that no dispatch/receiver/host transaction started, post `TAKING CUSTODY` in `/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md`, wait 5 minutes for objection, and then complete preflight and dispatch ONCE.
- **Prequalification and 40-char SHA preflight (H2)**: Updated Step 7 of `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md` to require checking `gh run list --workflow engine-release-prequalification.yml --commit <40-char-target-sha> -L 5` before dispatch and to state explicitly that `engine-release-installed-migrations.py candidate-ready` requires full 40-char commit SHAs for both `--serving` and `--sha`.

### H5 (D4): Automatic active-window detection in `release-freeze-scope.mjs` and `release-inputs-hold.yml`

- **Symptom**: `scripts/ci/release-freeze-scope.mjs` only read `vars.MAIN_RELEASE_FREEZE`, and `.github/workflows/release-inputs-hold.yml` only checked out `scripts/ci`. When `MAIN_RELEASE_FREEZE` was unset (for example when a custodian's fine-grained PAT lacked Actions variable write permission), PRs touching guarded release-control paths reported green during an active unsealed owner engine window.
- **Explicit non-gate ruling preserved**: Per the standing owner rulings documented in `.github/workflows/release-inputs-hold.yml` and `scripts/ci/release-freeze-scope.mjs` (2026-09-11 no merge freeze ever; 2026-11-19 upgrades and fixes must not wait on an engine cutover), `Release inputs are steady for the engine window` is **NOT** added as a required branch-protection merge gate. It remains an informational PR check only.
- **Fix**:
  - Updated `.github/workflows/release-inputs-hold.yml` sparse-checkout to include `server/release` alongside `scripts/ci` and passed `GH_TOKEN: ${{ github.token }}`.
  - Hardened `scripts/ci/release-freeze-scope.mjs` with `activeHold()` so when `MAIN_RELEASE_FREEZE` is unset or stale, it automatically detects an active unsealed owner engine window from `server/release/owner-maintenance-windows.json` (bound by `server/release/activation-floor.json` when present), clears it once the window is lifted, expired, or proven serving on `https://engine.smarter.poker/health`, and still admits all non-guarded paths (client, docs, tests, engine source, migrations).
  - Updated `docs/ENGINE-RELEASE-RUNBOOK.md` scope documentation to match.
- **Barrier**: Added three tests in `tests/operations/main-freeze-status.test.mjs` covering unset `MAIN_RELEASE_FREEZE` active-window holds, sealed/lifted/expired/replaced-floor admission, and end-to-end CLI exit codes; updated the pinned test count (`# pass 16`) in `tests/unit/mainFreezeStatus.test.ts`.

### H7 Verification (`#11609` / commit `199438df` on `origin/main`)

Verified all four review assertions exist and pass on `origin/main`:

1. Winter CST (`2026-12-15`) and summer CDT (`2027-06-15`) reservation coverage for three-hourly and daily schedules: `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts:622-655`.
2. Host `prestage` door closes only cycles named by the target policy and keeps the repeated fall-back 01:00 open: `tests/the-engine-cuts-over-every-three-hours.law.test.ts:240-268`.
3. Every `daily=` admission in `server/scripts/engine-release-transaction.sh` (lines 686, 1554, 1843) applies the first-occurrence fall-back rule: `tests/the-engine-cuts-over-every-three-hours.law.test.ts:215-239`.
4. `daily_cutover_clock` in `server/scripts/engine-release-transaction.sh:1419` admits only the first fall-back 01:00: `tests/the-engine-cuts-over-every-three-hours.law.test.ts:201-214` and `tests/the-break-clocks-agree.law.test.ts:164`.
