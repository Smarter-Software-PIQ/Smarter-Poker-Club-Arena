# Qualify the dormant river bluff skills (Item 25, 2026-11-07)

Measured `v54RiverBluff`, `riverBluffCheckRaise` and
`multiwayRiverBluffCheckRaise` against current main with the default-on river
layers (#9803, #9842, #9838, #9837). Full report:
`docs/horse-measure/2026-11-07/river-bluff-skills-qualification.md`; cells in
`docs/horse-measure/2026-11-07/results/river-bluff-skills/`.

## Decision: nothing promoted

All three stay unselected in `HorseFeatureAuthority`. No selection, plan,
assembly or admission record was written, no default was flipped, and
`HorseDormantCandidateReadiness.test.ts` is unchanged (it proves the admission
mechanics with synthetic evidence and selects nothing).

- `v54RiverBluff`: **subsumed by the baseline river bluff range.** 92,500
  duplicate-dealt pairs (#9841 method): heads-up +0.41 +/- 0.30 bb/100
  [-0.17, +0.99], six-handed +0.10 +/- 0.06 [-0.01, +0.22], tournament
  identical by construction. It bet 27 times in 70,000 heads-up hands (63%
  folded, those hands -35.5 bb) and never six-handed. Its spot is a strict
  subset of the baseline's; the one measurable effect (+0.79 [+0.01, +1.57]
  against stations heads-up) comes from its station check pre-empting the
  baseline's rare station bluffs (2 vs 19 in NLH), not from its own bluff.
- `riverBluffCheckRaise`: not subsumed (it acts facing a river bet; every new
  layer acts with nothing to call), but **not measurable in the #9841 pools**:
  `HorseLeague.playHand` builds no schema-1 state, so the skill never
  evaluates there. In the stress development pilots (2,304 pairs, a field that
  stabs every checked river and folds every check-raise) it acted 8 times:
  NLH +9.2 +/- 9.2, PLO4 0, PLO5 +21.0 +/- 14.8, PLO6 +37.7 +/- 18.2. No
  production-pool evidence exists, so no qualification.
- `multiwayRiverBluffCheckRaise`: not subsumed by #9842 (different spot), same
  schema-1 limitation; 1 act in 1,158 stress pairs. Unselected.

Legality: 0 illegal actions, truncated streets, brain fallbacks, protocol,
conservation or replay errors anywhere.

## What changed

- `server/src/benchmark/RiverBluffBaselineLeague.ts`: optional
  `RblmCellOptions` (any two arms, skill fire names and prefixes) and per-arm
  skill counters. Omitted options run #9841's measurement unchanged; a new
  test in `RiverBluffBaselineLeague.test.ts` pins both.
- `server/src/scripts/riverBluffSkillLeague.ts`: offline CLI per skill.
- `scripts/horse-measure/river-bluff-skill-report.py`: tables and pooling.

## Gaps

- The check-raise skills need a schema-1 duplicate-deal league with the
  #9841 pools before they can be judged against production play.
- Six-handed PLO5 tournament and PLO6, and 4-dealt multiway PLO, were not
  reached in the compute window; heads-up cash is where v54 can act and is
  covered.
- The baseline range's station factor (x0.2) loses a little to "never bluff a
  read station" heads-up (+0.79 [+0.01, +1.57]); worth its own ablation of
  the baseline, not a V54 promotion.
