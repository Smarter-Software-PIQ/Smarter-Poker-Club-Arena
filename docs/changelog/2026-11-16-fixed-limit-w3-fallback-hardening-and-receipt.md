# Fixed-limit W3 hardening: liveness fallbacks stay passive at commit, `fixed_limit_failure_fallback_call` receipt, and narrower neutrality spy

**Date:** 2026-11-16
**Area:** Horse decision commit door (`ServerTableEngineTurns`), `HorseLogic` brain exception fallback, `HorseDataLedger` receipts, W3 law & neutrality isolation

## What changed

1. **Commit-door card rules skip liveness fallbacks (root cause of the `nlh flop_free` flake):**
   - In `ServerTableEngineTurns.scheduleHorseAction`, `commitDecision` previously ran `holdemPremiumAggression`, `tournamentShoveDiscipline`, `riverNutsRaise`, and `fullPotNearPotWager` on every action, including a `worker_fallback` (`safeWorkerFallback`) or a returned `brain_exception` (`decision.policyFallback === 'brain_exception'`).
   - In `AFixedLimitFailedDecisionCallsAGoodPrice.law.test.ts` (`"a failed decision worker > nlh flop_free: the seat takes check"`), `HandController` dealt from a shuffled deck; whenever seat 2 was randomly dealt `QQ+` overpair/set or `AK` top pair on a non-passed flop (~2.5% of deals), commit-door `holdemPremiumAggression` read private hole cards on the main thread and turned the liveness `check` into a half-pot `bet`.
   - `livenessFallback` (`safeWorkerFallback || decision.policyFallback === 'brain_exception'`) now bypasses `holdemPremiumAggression`, `tournamentShoveDiscipline`, `riverNutsRaise`, and `fullPotNearPotWager` so a liveness check or call is never promoted into a bet or raise and never emits `holdem_premium_*` telemetry. `shortAllInCallFloor` remains active at the door to protect a fallback fold against a sub-3BB tournament all-in.
   - `AFixedLimitFailedDecisionCallsAGoodPrice.law.test.ts` also resets `worker.decideFast` and `worker.decideDeep` in `beforeEach`, cleans up timers/abort controllers per case, scopes `throwingDecide`'s spy with `mockImplementationOnce` + `finally { spy.mockRestore(); }`, and pins deterministic premium NLH flop and royal-flush FLH river fallback cases.

2. **`fixed_limit_failure_fallback_call` receipt (Hand Analysis W3 review Note N4):**
   - `ServerTableEngineTurns.scheduleHorseAction` (worker fallback) and `HorseLogic.decide` (`brain_exception`, gated on `telemetryOn(opts)`) now fire `fixed_limit_failure_fallback_call` whenever `failureFallbackAction` selects `'call'` on fixed limit instead of `'fold'`.
   - Registered in `HorseDataLedger.ts` as a no-floor receipt (alongside an updated `phase15_brain_exception` note). No option flag or SQL option-switch migration is added.

3. **Narrower historical-corpus menu spy (Hand Analysis W3 review Note N2):**
   - `HorseOpponentExploitNeutrality.law.test.ts` now restores `all_in` on a fixed-limit menu only when the active seat has chips left and `clampToStructure(hero, 'all_in', ...)` yields `'call'` or `'check'` — matching the exact `fixedLimitButtonOnlyCalls` filter W3 introduced rather than unconditionally appending `all_in` to every fixed-limit menu.

## Limits

- `fixed_limit_failure_fallback_call` counts only failure-path fixed-limit calls (`worker_fallback` or `brain_exception`); normal strategy calls are unaffected, and quiet days with zero decision failures produce zero fires by design (no `minRatio` floor).
