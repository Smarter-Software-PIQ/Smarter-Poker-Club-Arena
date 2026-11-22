# 2026-11-21 - E4: Three-Hourly Engine Cutover Readiness CLI

- **Lane:** `release-custody`
- **Scope:** Enhancement E4 (`scripts/release/three-hourly-readiness.py`, `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`, `tests/operations/three-hourly-readiness.test.py`, `tests/the-three-hourly-readiness-cli-only-reads.law.test.ts`, `docs/laws.d/the-three-hourly-readiness-cli-only-reads.md`).

## Problem

Before every three-hourly engine cutover, all four lanes (PLO Strategy, Horse On/Off Switches, Antigravity Coordinator, Horse Decisions) and the Dedicated Engine Cutover owner had to run four separate `curl`, `gh`, and `python3` commands to discover whether the next cycle had a selectable candidate, why an older candidate (such as `11f23384b046`) was disqualified by `CONTROL_INPUTS` mismatch (RC=3), or whether a commit (such as `c2d6e45e3bcc`) still needed prequalification before the cutoff.

## Change

1. Added `scripts/release/three-hourly-readiness.py` (stdlib Python 3, executable, strictly read-only):
   - Reads live `https://engine.smarter.poker/health` (`releaseSha`, `frequency`, `startHours`, `phase`, `stalledTables`).
   - Computes the next DST-aware `America/Chicago` cycle matching `server/src/maintenance/maintenanceSchedule.ts` (`1, 4, 7, 10, 13, 16, 19, 22` for `three-hourly`, `4` for `daily`, first fall-back `01:00` only), exact preparation cutoff (`start - 30m` in UTC and Chicago), and recommended combined migration + release-control hold start (`cutoff - 75m`).
   - Reads active `stage-engine-release.yml` reservation runs and active `backup-engine.yml` runs on `main` via explicit `gh api --method GET`.
   - Walks recent first-parent commits on `refs/remotes/origin/main` since the serving SHA (up to `--limit`, default `10`) and reports `backup-engine/certified` state, latest `engine-release-prequalification.yml` status and run ID, `CONTROL_INPUTS` projection equality vs `origin/main` via `scripts/ci/read-engine-prequalification.py` `projection()`, and `SELECTABLE` / `PENDING` / `DISQUALIFIED` classification with a single-line reason.
   - Emits a compact ASCII readiness table or `--json` payload with top-level verdict `READY`, `IN_FLIGHT`, `NO_CANDIDATE` (exit `0`), or `UNKNOWN` (exit `3`) whenever any live read is unavailable (CLAUDE.md 10.86).
2. Documented the one-liner in `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md`.
3. Added pure mocked unit tests in `tests/operations/three-hourly-readiness.test.py`, static read-only + execution law `tests/the-three-hourly-readiness-cli-only-reads.law.test.ts`, and registry entry `docs/laws.d/the-three-hourly-readiness-cli-only-reads.md`.

## Verification

- `python3 -B tests/operations/three-hourly-readiness.test.py` (8/8 tests passing, 0 skipped)
- `npx vitest run tests/the-three-hourly-readiness-cli-only-reads.law.test.ts tests/law-registry.law.test.ts tests/the-runbook-names-what-it-cites.law.test.ts tests/the-engine-cuts-over-every-three-hours.law.test.ts`
- Live read-only smoke test: `python3 -B scripts/release/three-hourly-readiness.py` and `--json` against live `/health` and `Smarter-Software-PIQ/Smarter-Poker-Club-Arena`
