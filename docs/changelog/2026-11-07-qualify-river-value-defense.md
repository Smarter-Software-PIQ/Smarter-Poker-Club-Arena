# Item 25: river position defense and small-pot near-nut value measured; both stay unselected

Decision Readiness item 25 asks whether the unselected feature-authority
skills can be promoted. This change measures two of them,
`riverPositionDefense` and `smallPotNearNutRiverValue`, on current main with
today's river bluff layers (#9803, #9842, #9838, #9837) on in both arms.
Report: `docs/horse-measure/2026-11-07/river-value-defense-qualification.md`;
numbers: `docs/horse-measure/2026-11-07/results/river-value-defense/summary.json`.

## Outcome

Neither is selected. No default, flag, selection file or pin changes;
`HorseDormantCandidateReadiness.test.ts` still holds all seven unselected.

- `riverPositionDefense`: +180.96 +/- 64.92 bb/100 (CI +53.72 to +308.21)
  heads-up NLH against its declared overstab field in the physical paired
  harness, PLO4 +44.21 +/- 25.31 and PLO5 +21.25 +/- 22.58 (intervals include
  zero), PLO6 one accepted call in 576 pairs (later paired-board owners
  overrule the rest). Exactly zero against production horses and in every
  six-handed, tournament and league cell. Promotion still needs the locked
  held-out condition (a) assembly the authority admits; development pilots
  cannot be selected, and the held-out registry is empty. NLH 2-dealt 100bb
  is the profile to register next.
- `smallPotNearNutRiverValue`: one act in 2,876 physical pairs (+12.6bb, PLO6
  flat exception). Not measurable on this workload.

## What changed in code

- `server/src/benchmark/RiverValueDefenseLeague.ts` and CLI
  `server/src/scripts/riverValueDefenseLeague.ts`: the #9841 duplicate-deal
  method with the candidate flag as the arm and an `aggressors` pool. It
  showed that `HorseLeague.playHand` cannot reach either skill (no hand
  identity for the last-to-act read; no published economics for the near-nut
  gate), which is why the physical harness carries the measurement.
  Test: `server/src/benchmark/RiverValueDefenseLeague.test.ts`.
- `server/src/scripts/featureAblationDevelop.ts`: optional
  `--field=current_horse_production_styles` for incremental targets
  (development only, empty warm history, recorded in the manifest), so a
  candidate's cost where its stress opponent is absent is measured in the same
  harness. Without the option every run is byte-for-byte the previous path.

No engine source changed. Nothing here activates a horse skill.
