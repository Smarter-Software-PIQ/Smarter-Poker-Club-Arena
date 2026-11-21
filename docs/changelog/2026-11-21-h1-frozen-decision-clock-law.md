# Hardening H1: Decision Determinism Tests Freeze `performance.now()`

**Date:** 2026-11-21
**Hardening Item:** H1 (D1 prequalification flake hardening)
**Scope:** Test helper, 9 clock-stripping decision determinism tests, repo-wide static law + registry entry (zero production engine changes, zero release-control changes, zero migrations)

## Symptom

Shard 4 of `engine-release-prequalification.yml` failed non-deterministically on `server/src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts` on every commit across the day (starting after `ea4030176aa`), blocking candidate prequalification until PR #11618 (`5ef8e6cb5a55`). The failing assertions compared two `HorseLogic.decide()` receipts via `withoutClocks(...)` (stripping `*Ms` fields) and diverged with `jointPolicy.utilityOwner = "phase7_unavailable"` / `reason = "operation_budget"` on one side of the comparison.

## Root Cause

`HorseLogic.decide()` still carries 4 ms wall-clock `performance.now()` budgets in tournament mode:

- `server/src/engine/HorseLogic.ts:17025` / `17063` (`JOINT_SAMPLE_WORK_BUDGET_MS = 4` from `server/src/engine/multiway/JointSampleAcquisition.ts:51` for multi-board Phase 7 joint-sample utility)
- `server/src/engine/HorseLogic.ts:17134` / `17145` (4 ms shadow tournament utility for Phase 10/11/12 variant policies)
- `server/src/engine/HorseLogic.ts:17535` / `17573` (4 ms tournament utility for Phase 13 joint shadow/candidate policies)

Stripping wall-clock measurement fields (`*Ms`, `elapsedMs`, `latencyMs`) from serialized decision receipts removes timing numbers, **not** control-flow divergence caused when a loaded CI runner crosses a 4 ms wall-clock budget during one of the two compared `decide()` calls.

## Why It Broke

1. PR #11618 (`5ef8e6cb5a55`) fixed the immediate flake in `AHoldemTournamentAllInCallIsPriced.law.test.ts` with inline `vi.spyOn(performance, 'now').mockReturnValue(0)` calls, but left no shared helper and no static guard preventing other tests from repeating the same mistake.
2. Scanning all 2,444 `server/src/**/*.test.ts` files revealed 8 additional clock-stripping decision comparison tests lacking a frozen `performance.now()` clock - including 4 tournament `HorseLogic.decide()` tests (`SecondLookIsNotLive.test.ts`, `HorseOmahaStrategyInTournaments.test.ts`, `HorseOmahaStrategyPrecedenceTournament.test.ts`, `HorseOmahaReadConditional.test.ts`) that carry the exact same D1 failure mode on loaded runners.

## Fix (#11618 + This PR)

1. **Shared test clock helper (`server/src/engine/testing/frozenDecisionClock.ts` + `frozenDecisionClock.test.ts`):**
   - Exports `freezeDecisionClock(nowMs = 0)` and `withFrozenDecisionClock(fn, nowMs = 0)` (handles sync returns, sync throws, async resolves, async rejects, nested LIFO scopes, and idempotent `restore()`).
   - Uses `Object.defineProperty` on `performance.now` rather than Vitest mock spies so it compiles cleanly with zero test-framework dependency (`tsconfig.json` and `tsconfig.runtime.json`) and cannot be accidentally unfrozen mid-test by `vi.restoreAllMocks()`.
   - Keeps production `HorseLogic.ts` behavior 100% unchanged.
2. **Wired `withFrozenDecisionClock` into all 9 clock-stripping decision comparison tests:**
   - `server/src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts` (replaces inline `vi.spyOn` from #11618)
   - `server/src/benchmark/OfflineOmahaPolicyInput.test.ts` (`withoutClocks`)
   - `server/src/engine/SecondLookIsNotLive.test.ts` (`timeless` / `WALL_CLOCK_FIELDS` on tournament + cash `HorseLogic.decide`)
   - `server/src/engine/HorseOmahaStrategyInTournaments.test.ts` (`/Ms$/` `bytesOf` on tournament `HorseLogic.decide`)
   - `server/src/engine/HorseOmahaStrategyPrecedenceTournament.test.ts` (`/Ms$/` `bytesOf` on tournament `HorseLogic.decide`)
   - `server/src/engine/HorseOmahaReadConditional.test.ts` (`/Ms$/` `scopedBytes` on tournament `HorseLogic.decide`)
   - `server/src/engine/HorseRiverNoBlockerBet.test.ts` (`/Ms$/` `bytes` on `HorseLogic.decide`)
   - `server/src/engine/GtoV31CellContractV3Serving.test.ts` (`withoutClock` / `strip` on `HorseLogic.decide`)
   - `server/src/benchmark/GtoV31DensityPreflight.test.ts` (`strip` omitting `elapsedMs` / `latencyMs` on `HorseLogic.decide`)
   - Verified `server/src/engine/omahaMathCore/OmahaMathCoreDeterminism.law.test.ts` intentionally injects `{ now }` into `decideOmahaMathCore` (including `frozen`, `jumping(37)`, `jumping(1000)`, and real `performance.now()`) and is correctly excluded.

## Barrier Added

- **`tests/decision-determinism-tests-freeze-the-clock.law.test.ts`** (registered in `docs/laws.d/decision-determinism-tests-freeze-the-clock.md`):
  - Scans every `server/src/**/*.test.ts` file and fails CI + pre-push if any test using `withoutClocks`, `withoutClock`/`WALL_CLOCK_FIELDS` on `HorseLogic.decide`, `/Ms$/` `JSON.stringify` replacers on `HorseLogic.decide`, direct `JSON.stringify(decide(...)` comparisons, or `strip()` omitting `elapsedMs`/`latencyMs` on `HorseLogic.decide` does not freeze `performance.now()` (via `frozenDecisionClock`, `vi.spyOn(performance, 'now')`, or `phase13EvidenceMode: true`).
  - Includes a classifier self-test proving that removing the freeze from `AHoldemTournamentAllInCallIsPriced.law.test.ts` is caught while explicit clock-injection laws (`OmahaMathCoreDeterminism.law.test.ts`) are not falsely flagged.

## Verification

- `cd server && npx tsc --noEmit && npx tsc -p tsconfig.runtime.json --noEmit` -> PASS (`TSC_OK`, 0 errors)
- `cd server && npx vitest run src/engine/testing/frozenDecisionClock.test.ts src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts src/benchmark/OfflineOmahaPolicyInput.test.ts src/engine/SecondLookIsNotLive.test.ts src/engine/HorseOmahaStrategyInTournaments.test.ts src/engine/HorseOmahaStrategyPrecedenceTournament.test.ts src/engine/HorseOmahaReadConditional.test.ts src/engine/HorseRiverNoBlockerBet.test.ts src/engine/GtoV31CellContractV3Serving.test.ts src/benchmark/GtoV31DensityPreflight.test.ts` -> PASS (10 test files, 350/350 tests passed)
- `npx vitest run tests/decision-determinism-tests-freeze-the-clock.law.test.ts tests/law-registry.law.test.ts tests/unit/noFixedSizeSourceWindows.test.ts` -> PASS (3 test files, 1874/1874 tests passed)
- Negative-test mutation proof: temporarily removed `withFrozenDecisionClock` from `server/src/benchmark/OfflineOmahaPolicyInput.test.ts` -> `npx vitest run tests/decision-determinism-tests-freeze-the-clock.law.test.ts` exited `1` reporting `server/src/benchmark/OfflineOmahaPolicyInput.test.ts (uses withoutClocks)`; restored -> exited `0` (3/3 passed).
- `node scripts/ci/ownership-check.mjs --files <changed files> --body "Lane: horse-brain"` -> PASS (exit 0, zero locked paths touched).
