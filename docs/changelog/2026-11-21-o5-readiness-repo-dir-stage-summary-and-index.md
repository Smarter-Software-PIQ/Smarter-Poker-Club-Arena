# 2026-11-21 - O5: Readiness CLI `--repo-dir`, Stage Selection Step Summary, and Combined Hardening Index

- **Lane:** `release-custody`
- **Scope:** `scripts/release/three-hourly-readiness.py`, `tests/operations/three-hourly-readiness.test.py`, `tests/the-three-hourly-readiness-cli-only-reads.law.test.ts`, `.github/workflows/stage-engine-release.yml`, `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`, `docs/hardening/2026-11-21-dedicated-cutover-hardening.md`.

## Problem

1. Invoking `scripts/release/three-hourly-readiness.py` from outside a git checkout failed with `not a git repository` because repo resolution assumed `Path(__file__).resolve().parents[2]` was always a git root and offered no `--repo-dir` override.
2. In `.github/workflows/stage-engine-release.yml`, the `selection` job uploaded `daily-selection.json` as an artifact without writing a read-only Markdown summary to `$GITHUB_STEP_SUMMARY`, forcing operators across all four lanes to download the artifact to inspect outcome, serving/target SHAs, deferred candidate details, and readiness verdict.
3. `docs/hardening/2026-11-21-dedicated-cutover-hardening.md` (merged in `#11681`) predated the `19:00 CST` automatic replacement seal (`c2d6e45e3bcc`), the post-hold merge and live migration install of H10 (`#11676`), and enhancements E1-E6 (`#11685` through `#11691`).

## Change

1. **`scripts/release/three-hourly-readiness.py` (`--repo-dir`):**
   - Added `--repo-dir <path>` and deterministic `resolve_repo_root()` fallback: explicit `--repo-dir` (fails closed if missing or not a git repository) -> script's repository root if `.git` exists -> current working directory if inside a git repository -> fail closed (`UNKNOWN`, exit `3`).
   - Passes `-C <repo_dir>` on every read-only `git` invocation and loads `scripts/ci/read-engine-prequalification.py` relative to `<repo_dir>` (cached per resolved repo root).
   - Added unit tests in `tests/operations/three-hourly-readiness.test.py` proving `--repo-dir` succeeds from an unrelated temp directory and fails closed (`UNKNOWN`, exit `3`) on non-git or nonexistent directories.
   - Updated `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` with `--repo-dir` and Stage summary documentation.
2. **`.github/workflows/stage-engine-release.yml` (Step Summary readiness line):**
   - Added `scripts/release` to the `selection` job `sparse-checkout`.
   - Added strictly read-only, non-blocking step `Append read-only cutover readiness summary` (`id: readiness_summary`, `if: always() && steps.freeze.outcome != 'skipped'`, `continue-on-error: true`) after `Preserve the daily selection before offering the release` that appends a crisp Markdown summary of `daily-selection.json` (cycle/window, outcome, serving SHA, target SHA, deferred candidates with reason and detail) and the `three-hourly-readiness.py --json` one-line verdict to `$GITHUB_STEP_SUMMARY` without altering `selection` outputs, artifacts, or exit codes.
   - Added static + bash execution assertions in `tests/the-three-hourly-readiness-cli-only-reads.law.test.ts`.
3. **`docs/hardening/2026-11-21-dedicated-cutover-hardening.md`:**
   - Updated H10 from HELD to MERGED (`#11676`, `97f9847a29d8`) with migration `20261121200024` APPLIED LIVE (`44969988218`).
   - Added the verified `19:00 CST (01:00Z)` automatic engine replacement seal (`c2d6e45e3bcc`, Stage `44960337691`, Receiver `44966984726`, receipt `44966984726-1.json`, `#11599` comment `7071937248` listing `Previous seal: 1a0a6047e1acb1a037cd43b36d9907a00103c5e4` and all 33 included PRs).
   - Added complete records for E1-E6 (`#11686`, `#11689`, `#11687`, `#11685`, `#11688`, `#11691`), including live migration `20261122002835` (`44976007994`) and the `-- @probe-for` `shifted` boolean metadata bug catch.

## Verification

- `python3 -B tests/operations/three-hourly-readiness.test.py` (10/10 OK, 0 skipped).
- `npx vitest run tests/the-three-hourly-readiness-cli-only-reads.law.test.ts tests/a-sparse-checkout-holds-what-its-scripts-load.law.test.ts tests/the-live-engine-only-receives-a-backup-certified-version.law.test.ts tests/the-engine-cuts-over-every-three-hours.law.test.ts tests/the-runbook-names-what-it-cites.law.test.ts tests/no-workflow-gains-a-new-timer.law.test.ts tests/law-registry.law.test.ts`.
- Live smoke test from `/private/tmp`: `python3 -B /Volumes/SmarterWork/agent-work/extreme-capacity/cutover-3h-o5/scripts/release/three-hourly-readiness.py --repo-dir /Users/smarter.poker/Documents/club-arena`.
- Zero Unicode em-dashes (`U+2014`) or en-dashes (`U+2013`) verified across all modified and added files.
