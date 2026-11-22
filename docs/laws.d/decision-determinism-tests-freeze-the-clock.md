# tests/decision-determinism-tests-freeze-the-clock.law.test.ts

Every test in server/src/ that strips wall-clock fields to compare decision receipts (`withoutClocks`, `withoutClock`, `WALL_CLOCK_FIELDS`, `/Ms$/` JSON replacers on `HorseLogic.decide`, or direct `JSON.stringify(decide(` / `strip(` comparisons) must freeze `performance.now()` via `server/src/engine/testing/frozenDecisionClock.ts` (or `vi.spyOn(performance, 'now')` / `phase13EvidenceMode: true`), preventing D1 4 ms wall-clock budget flakes on loaded runners.
