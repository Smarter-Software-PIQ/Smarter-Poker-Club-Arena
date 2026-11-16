# server/src/engine/AFixedLimitFailedDecisionCallsAGoodPrice.law.test.ts

A fixed-limit seat whose decision failed (worker fallback or brain exception) checks when free and, owing chips, calls when toCall / (pot + toCall) is at or below 0.2 and call is on its menu, else folds; no-limit and pot-limit fold when chips are owed, as before (2026-11-15)
