# E2: Exclude verified non-runtime test and benchmark-only files from the engine Docker build and source identity

**Date:** 2026-11-21
**Scope:** `server/.dockerignore`, `server/tsconfig.runtime.json`, `scripts/ci/engine-source-identity.sh`, `.github/workflows/engine-build-resource-proof.yml`, `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`, `server/src/engine/aHashedPolicySourceShipsInTheEngineImage.law.test.ts`, `server/src/engine/aRuntimeSourceImportsOnlyEmittedJson.law.test.ts`, `tests/operations/engine-build-resource-proof.test.py`, `PUBLISHING.md`, `docs/ENGINE-RELEASE-RUNBOOK.md`, `docs/laws.d/tests-the-backup-day-ends-with-only-a-four-am-release.md`.

## Symptom

Test-only and testing-helper PRs under `server/src/` (such as `2f2026bc1ef7` / `#11673`, which touched `server/src/**/*.test.ts` and `server/src/engine/testing/frozenDecisionClock.ts`) could not inherit an existing Backup certificate from `c2d6e45e3bcc` and instead queued a ~55-minute certification on the single `ca-backup` host. Run `44957494061` waited 75 minutes behind `44954419323` and timed out with `error` at `2026-11-21T23:51:10Z`.

## Root cause

1. `server/` had no `.dockerignore`, so `COPY src/ ./src/` in `server/Dockerfile` copied 2,579 non-runtime test, test-support, testing-helper, and benchmark-fixture files into the engine build context and image.
2. `server/tsconfig.runtime.json` only excluded `src/**/*.test.ts`, `src/**/*.spec.ts`, and `src/**/__tests__/**`, leaving 82 non-runtime `*.test-support.ts`, `src/testing/**`, `src/engine/testing/**`, and `src/benchmark/Sparring*.ts` / `sparringRun.ts` files in the runtime emit graph.
3. `scripts/ci/engine-source-identity.sh` hashed the unfiltered git tree OID of `server/src`, so any edit to a test or testing helper under `server/src/` changed the digest and prevented Backup certificate inheritance.
4. Note on `server/src/benchmark/`: inspecting the real import graph and `tsc -p tsconfig.runtime.json --noEmit --listFiles` proved that 36 files in `server/src/benchmark/` ARE transitively imported by production runtime modules (`server/src/index.ts` imports `HorseLeague.ts`; `HorsePhase10-13Authority.ts` import the four strength contracts; `horseCorrectiveReview` imports `JointBoardReference.ts`; `GtoPostflopV31Loader.ts` imports `GtoV31EvaluationContractV3.ts`). Commit `0191691c15` (`#11677`) modified `server/src/benchmark/HorseLeague.ts`, which IS compiled into `dist/` and executed at server startup. Therefore `server/src/benchmark/` is NOT excluded wholesale; only verified non-runtime test, fixture, and sparring-harness paths (`src/benchmark/fixtures/**`, `src/benchmark/Sparring*.ts`, `src/benchmark/sparringRun.ts`) are excluded.
5. Note on `kernelRollbackQualification.ts` and `horsePolicySourceManifest()`: zero files in `horsePolicySourceManifest()` match any excluded pattern (`kernelRollbackQualification.ts` executes offline in a git checkout using `git` and `vitest`, never inside the pruned production image).

## Fix

1. Added `server/.dockerignore` at the root of the Docker build context (honored automatically by both `server/standby/standby-engine.sh`'s `git archive <sha> server | tar && docker build` and `server/scripts/build-engine-image.sh`'s `git archive <server-tree> | tar && docker buildx build`) using strictly positive glob patterns excluding:
   - `src/**/*.test.{ts,tsx,mts,cts,js,mjs,cjs}` and `src/**/*.spec.{ts,tsx,mts,cts,js,mjs,cjs}`
   - `src/**/*.test-support.*`
   - `src/**/__tests__` and `src/**/__tests__/**`
   - `src/testing` and `src/testing/**`
   - `src/engine/testing` and `src/engine/testing/**`
   - `src/benchmark/fixtures` and `src/benchmark/fixtures/**`
   - `src/benchmark/Sparring*.ts` and `src/benchmark/sparringRun.ts`
2. Updated `server/tsconfig.runtime.json` `"exclude"` symmetrically so the full TypeScript runtime check (`tsc -p tsconfig.runtime.json`) and Docker's `tsc -p tsconfig.emit.json` compile the exact same 1,235 runtime source files (down from 1,317).
3. Updated `scripts/ci/engine-source-identity.sh` to read `server/.dockerignore` at the target commit, include its blob OID in the manifest (`dockerignore <oid|absent>`), fail closed on unsupported `.dockerignore` syntax (`!` negation, bracket character classes, escapes, path traversal, or partial `**`), and filter every context `COPY` source via `git ls-tree` (zero lazy blob fetches in blobless checkouts) so the identity hashes the exact same non-ignored files that enter the Docker build context.
4. Added `server/.dockerignore` to `.github/workflows/engine-build-resource-proof.yml` trigger paths so future `.dockerignore` changes run the real Linux bounded Docker build proof.

## Barriers added

- `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`:
  - Proves mutating any `.dockerignore`-excluded test, law test, test-support, `__tests__`, `src/testing`, `src/engine/testing`, `src/benchmark/fixtures`, or sparring file produces the exact same `engine-source-identity.sh` digest.
  - Proves mutating any runtime source (`GameServer.ts`, `benchmark/HorseLeague.ts`), `package-lock.json`, `release-evidence`, `Dockerfile`, `.dockerignore`, or `engine-source-identity.sh` changes the digest.
  - Proves unsupported `.dockerignore` syntax fails closed and historical commits without `.dockerignore` retain deterministic digests.
  - Proves `server/tsconfig.runtime.json` symmetrically excludes every TypeScript path ignored by `server/.dockerignore` and that ZERO non-ignored runtime TypeScript files under `server/src/` import any ignored path.
- `server/src/engine/aHashedPolicySourceShipsInTheEngineImage.law.test.ts`:
  - Proves zero paths in `horsePolicySourceManifest()` are excluded by `server/.dockerignore`.
- `server/src/engine/aRuntimeSourceImportsOnlyEmittedJson.law.test.ts` and `tests/operations/engine-build-resource-proof.test.py`:
  - Aligned runtime source filters with `server/tsconfig.runtime.json`.

## Verified commands

- `cd server && npx tsc -p tsconfig.runtime.json --noEmit --listFiles` (0 errors, 1,235 files, 0 excluded files in program)
- `npx vitest run tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts tests/the-runbook-names-what-it-cites.law.test.ts`
- `cd server && npx vitest run src/engine/aHashedPolicySourceShipsInTheEngineImage.law.test.ts src/engine/aRuntimeSourceImportsOnlyEmittedJson.law.test.ts src/benchmark/SparringLeagueIsBenchmarkOnly.law.test.ts`
- `python3 tests/operations/engine-build-resource-proof.test.py`
