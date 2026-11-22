# 2026-11-22: Hand-gap engine/grader parity (`all_in_showdown`, `bets_sweep_owed`, `DISTINCT award_groups`) and regression hardening (incident `1e532243`)

## Root causes established from live production (`06:55Z` refire #17) and Backup Engine (`44997134858`, `08:38Z`)

1. **All-in `call`/`bet`/`raise`/blind/ante showdowns graded `+500 ms` unintended:** `HandController` sets `player.is_all_in = true` when `stack === 0` while keeping the original action verb (`call`, `bet`, `raise`, `small_blind`, `big_blind`, `ante`). `ServerTableEngineHandEvents` computes `currentHandAllInShowdown` from `p.is_all_in === true`, so `handCompletionHoldMs` holds `ALL_IN_SHOWDOWN_EXTRA_MS` (`2000 ms`, `+500 ms` above `WINNING_CARDS_EXTRA_MS = 1500 ms`). `fn_ca_hand_gap_unintended_delay` only checked `action = 'all_in'`, causing Backup `44997134858` to fail certification on `cash showdown_checked_river` (`unintended_p50_ms = 1`, `unintended_p95_ms = 499`, `unintended_p99_ms = 501`, `over_budget = 3/29`) and production incident `1e532243` to refire at `06:55Z` on `tournament showdown_checked_river` (`+622..633 ms`).
2. **Conservative `betsSweepOwed` mismatch (`+500 ms`):** `showdownSweepOwed()` conservatively retains `BETS_SWEEP_MS` on non-5-card boards or non-flop-street actions while SQL only checked river chip actions.
3. **Chopped pots over-counted in `award_groups` (`+900 ms` per split winner):** `ServerTableEngineDealing.countAwardGroups()` deduplicates by `(board, potIndex, low)`, whereas SQL used `count(*)` over `pots[].awards[]`, inflating `owed_ms` by `+900 ms` on every 2-way chopped pot and hiding real delay.

## Source fixes & permanent hardening

- **`server/src/engine/handCadenceSpec.ts` & `server/src/engine/ServerTableEngineDealing.ts`:** Record exact bounded boolean shape facts `all_in_showdown` and `bets_sweep_owed` on `pendingPriorHandCadence` (next hand's `hand_history.cadence`).
- **`supabase/migrations/20261122095254_all_in_showdown_sweep_and_award_groups_parity.sql` & `scripts/sql/hand-gap-unintended-delay.sql`:**
  - `all_in_shown`: `action = 'all_in'` OR shown player finished with `stack = 0` (immediate fix even for legacy engine rows) OR `cadence->>'all_in_showdown' = 'true'` (bounded strictly to `+500 ms`).
  - `river_chips`: river chip commitment OR `cadence->>'bets_sweep_owed' = 'true'` (bounded strictly to `+500 ms`).
  - `award_groups`: `count(DISTINCT (board, potIndex, low))` matching `countAwardGroups()`.
  - Lockstep update to `smarter_private.reliability_runbook_hand_gap_classification`.
- **Permanent regression hardening:**
  - `server/src/tournament/aBoundaryMoveIsPlannedUnderTheHold.law.test.ts`: behavioral concurrency + fail-closed test for `loadBalancerTables()` under `Promise.all`, and behavioral test for `checkTableBalance()` budget-expired yield preferring an already-parked source.
  - `tests/mystery-bounty-and-addon-break-are-owed-waits.law.test.ts`: exhaustive `holdDealingUntil(` inventory coupling law across all non-test files in `server/src/` + grader/runbook parity assertions.
  - `scripts/ci/test-hand-gap-watch.py`: Phase 5 native PostgreSQL 16 proofs covering cash all-in call winners, legacy tournament all-in call busts, `bets_sweep_owed`, chopped-pot `DISTINCT award_groups`, and tamper-resistance against bogus `hold_ms`.
