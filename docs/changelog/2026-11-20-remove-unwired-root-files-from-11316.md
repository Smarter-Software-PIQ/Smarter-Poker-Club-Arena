# Remove ten unwired files that #11316 added at the repository root

2026-11-20. Coordinator validation of the Antigravity Horse lanes.

#11316 ("Horse Programme: Guardrails and Bet-EV", merged 2026-11-18 19:26Z) added ten
files at the repository root, outside `src/`, `server/` and `tests/`:

CalibrationService.ts, DiversityRegressionSuite.test.ts, Guardrails.ts,
HorseAutoTuner.test.ts, HorseAutoTuner.ts, HorsePlo6Engine.ts,
HorseReferenceDecisionSources.js, check-config-guardrails.mjs, ev_engine.types.ts,
robustness.sim.ts.

What was read on main at 95dae3848e5:

- Nothing in `src/`, `server/`, `tests/`, `scripts/`, `.github/` or `package.json`
  imports or runs any of them. They import only each other.
- Their relative imports (`../types.js`, `./HorseLogic.js`, `../lib/supabase`,
  `../engine/WeightingService.js`) do not resolve from the repository root, and no
  build, type check or test run includes the root.
- `HorseAutoTuner.ts` is a placeholder class with empty methods.
  `HorseReferenceDecisionSources.js` is a stray copy beside the real
  `server/src/engine/HorseReferenceDecisionSources.ts`.

No Horse decision, engine path or check changes: the files were never loaded. A real
guardrail, tuner or PLO6 facade belongs under `server/src/engine/` with its caller and
its test in the same pull request.
