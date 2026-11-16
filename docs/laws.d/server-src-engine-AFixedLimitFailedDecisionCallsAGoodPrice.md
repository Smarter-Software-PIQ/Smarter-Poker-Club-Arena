# server/src/engine/AFixedLimitFailedDecisionCallsAGoodPrice.law.test.ts

A fixed-limit seat whose decision failed (worker fallback or brain exception) checks when free and, owing chips, calls when toCall / (pot + toCall) is at or below 0.2 and call is on its menu (stamping fixed_limit_failure_fallback_call), else folds; no-limit and pot-limit fold when chips are owed, as before, and commit-time card rules never turn a liveness fallback into a wager (2026-11-15)
