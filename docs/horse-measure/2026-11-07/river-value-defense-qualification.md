# Item 25: riverPositionDefense and smallPotNearNutRiverValue, measured (2026-11-07)

Two of the seven feature-authority candidates that production keeps
unselected (`server/src/engine/HorseFeatureAuthority.ts`), measured on top of
current main `132201536` (which carries #9803 baseline river bluffs, #9842
multiway bluffs, #9838 out-of-position leads and hi-lo, #9837 the other game
types, all default on). Arm A = the candidate flag true; arm B = production
unchanged. Every pair is one deal played twice, so card luck cancels and the
error is the standard error of the per-pair difference; CI = +/- 1.96 se.

Compute: about 90 minutes on a two-core container shared with other agents
(load 15-23 throughout; three runs were killed by the out-of-memory killer and
are reported as the prefix they completed).

## Decision

**Both stay unselected.** Neither is promoted, no default changes, no pin
moves. `HorseDormantCandidateReadiness.test.ts` is untouched.

- `riverPositionDefense`: positive where it acts and inert everywhere else
  that was measured, but the sanctioned promotion route admits only a
  held-out, locked, provider-run condition (a) assembly
  (`admitHorseFeatureAuthority`: `qualificationKind:
'locked_paired_condition_a'`, a `heldout_locked` plan, a provider inventory
  with raw artifacts retained). Development pilots are
  `promotionEligible: false` by construction and the incremental held-out
  registry is still empty, so there is no evidence the authority could admit.
  The NLH heads-up result is the case for registering that held-out plan next
  (see "Next step").
- `smallPotNearNutRiverValue`: acted once in 2,876 physical development pairs.
  There is nothing to qualify on: one changed pair is not a measurement.

## Method 1: the duplicate-deal league (RiverBluffBaselineLeague method)

`server/src/benchmark/RiverValueDefenseLeague.ts` (CLI
`server/src/scripts/riverValueDefenseLeague.ts`) is the #9841 method with the
arm made a parameter and one more pool, `aggressors` (the calibrated
population opening wide and betting 80% of the spots it is checked to on every
street: the player the defense was written for).

120 cells: both skills x nlh/plo4/plo5/plo6 x cash/tournament x
standard/stations/folders/mixed/aggressors; `riverPositionDefense` heads-up
and six-handed, `smallPotNearNutRiverValue` heads-up (the six-handed near-nut
grid was stopped to give the cores to the physical runs). NLH 300 pairs per
cell, PLO 200; 27,000 pairs, 54,000 hands, seed 20261107.

| skill                     | seats | cells | pairs | divergent pairs | candidate receipts | illegal / truncated / fallback |
| ------------------------- | ----- | ----- | ----- | --------------- | ------------------ | ------------------------------ |
| riverPositionDefense      | 2     | 40    | 9,000 | 0               | 0                  | 0 / 0 / 0                      |
| riverPositionDefense      | 6     | 40    | 9,000 | 0               | 0                  | 0 / 0 / 0                      |
| smallPotNearNutRiverValue | 2     | 40    | 9,000 | 0               | 0                  | 0 / 0 / 0                      |

Every cell is A - B = 0.00 +/- 0.00 bb/100. **This harness cannot exercise
either skill, and the zero says that, not that the skills are neutral:**

- `riverPositionDefense` needs the opponent's conditional last-to-act river
  read (`HorseMind.riverLastToActRead`, at least eight opportunities). That
  counter is learned only from an observation carrying an original hand
  identity and dealt count; `HorseLeague.playHand` observes without one, so
  the read never forms, even against the aggressors.
- `smallPotNearNutRiverValue` refuses any state without published economics
  (rake config, BBJ config, pots, legal actions, asset, chip unit, betting
  structure); `playHand` supplies none of them.

`HorseLeague.playHand` was left unchanged: it is shared by every league, and
giving it rake terms its own settlement does not charge would measure a game
nobody plays. The tournament cells are zero for a further reason that holds
everywhere: both skills refuse tournament states in their own gates.

## Method 2: the physical paired development harness

`server/src/scripts/featureAblationDevelop.ts` is the sanctioned development
path for exactly these targets: the real decision worker, published 1/2 cash
rake and BBJ, fixed own-public warm history, the same duplicate-deal pairing,
and controller-accepted actions counted separately from proposals. Its
declared field for both targets is a synthetic stress population (river
overstabbers; for near-nut, river opens of 0.33 / 0.45 / 0.75 pot). One option
was added to it for this measurement: `--field=current_horse_production_styles`
seats production horses instead, with an empty warm history, so the cost where
the stress opponent is absent can be seen in the same harness.

| run                         | field             | pairs        | A - B bb/100          | 95% CI            | changed | better / worse (bb)    | receipts (evaluated / call / accepted) |
| --------------------------- | ----------------- | ------------ | --------------------- | ----------------- | ------- | ---------------------- | -------------------------------------- |
| defense NLH 2-dealt 100bb   | overstab          | 576          | **+180.96 +/- 64.92** | [+53.72, +308.21] | 44      | 26 (+1435) / 18 (-393) | 70 / 44 / 44                           |
| defense PLO4 2-dealt 100bb  | overstab          | 576          | +44.21 +/- 25.31      | [-5.39, +93.81]   | 25      | 12 (+409) / 13 (-155)  | 52 / 35 / 25                           |
| defense PLO5 2-dealt 100bb  | overstab          | 576          | +21.25 +/- 22.58      | [-23.01, +65.51]  | 22      | 10 (+291) / 12 (-168)  | 53 / 27 / 22                           |
| defense PLO6 2-dealt 100bb  | overstab          | 576          | -1.15 +/- 1.15        | [-3.39, +1.10]    | 1       | 0 / 1 (-6.6)           | 87 / 35 / 1                            |
| defense NLH 6-dealt 100bb   | overstab          | 256 (killed) | 0.00                  | -                 | 0       | -                      | -                                      |
| defense NLH 2-dealt 100bb   | production horses | 576          | 0.00 +/- 0.00         | -                 | 0       | -                      | 0 / 0 / 0                              |
| near-nut PLO4 2-dealt 100bb | river-open stress | 576          | 0.00                  | -                 | 0       | -                      | 0                                      |
| near-nut PLO5 2-dealt 100bb | river-open stress | 576          | 0.00                  | -                 | 0       | -                      | 0                                      |
| near-nut PLO6 2-dealt 100bb | river-open stress | 576          | +2.19 +/- 2.19        | [-2.10, +6.49]    | 1       | 1 (+12.6) / 0          | flat exception 1, applied 1            |
| near-nut PLO5 4-dealt 100bb | river-open stress | 576          | 0.00                  | -                 | 0       | -                      | 0                                      |
| near-nut PLO4 4-dealt 100bb | river-open stress | 372 (killed) | 0.00                  | -                 | 0       | -                      | -                                      |
| near-nut PLO5 2-dealt 100bb | production horses | 576          | 0.00                  | -                 | 0       | -                      | 0                                      |

Seeds: defense 27301101 (production field 27302203), near-nut 27701101
(production field 27702203), all declared development seeds; no held-out seed
was dealt. 5,784 completed physical pairs plus 628 from killed prefixes.
Legality on every completed run: 0 protocol errors, brain exceptions, illegal
actions, conservation, card, settlement or deduction errors, truncated hands
and paired-replay mismatches.

## Reading it

**riverPositionDefense** turns a reference river fold into a call only when a
heads-up opponent with a wide observed entry has bet at least 65% (one-sided
99% Wilson lower bound) of the rivers it was checked to last.

- Where it acts it wins: NLH heads-up +181 bb/100, the only interval clear of
  zero; PLO4 and PLO5 positive with intervals including zero. Defense success
  (accepted calls that beat the reference fold): NLH 26 of 44 (59%), PLO4 12
  of 25, PLO5 10 of 22. The winners are larger than the losers in every
  variant (a caught bluff wins the pot; a lost call costs only the bet).
- PLO6: 35 calls proposed, 1 accepted. Later owners (the PLO6 paired-board
  river discipline and the PLO paired-board river check/fold Dan ruled on)
  override the rest, as they must. The one accepted call lost 6.6bb.
- Where the read does not form it is exactly inert: production horses (576
  physical pairs), six-handed NLH (256 pairs, the river is rarely heads-up),
  every league cell, every tournament state.
- Interaction with today's river layers: none of #9803/#9842/#9838/#9837
  decides a hero facing a river bet, which is the only node this skill
  touches; all four were on in both arms, so the measurement already includes
  how they change the hero's own river checks (the opportunities the read is
  built from).

**smallPotNearNutRiverValue** removes the value band's random call with a
near-nut full house on a single-paired board facing a small opening river
bet, and in PLO6 keeps that raise past the flat-only rule. Its domain is rare
by design: one act in 2,876 physical pairs (PLO6, the flat exception, +12.6bb)
and none in 9,000 league pairs, which cannot reach it. No interval, success
rate or loss can be read from one hand.

## Next step (not done here)

The sanctioned route to selection is: a separately protected
`heldout_locked` plan for `river_position_defense` on one live profile (NLH
cash 6-max table, 2 dealt, 100bb is the one these pilots support), sized from
this pilot's dispersion (per-pair sd 15.6bb, kurtosis 45: 44 changed pairs
in 576), registered with its CRN family anchor; the provider workflow run;
assembly by `server/scripts/feature-ablation-assemble.mjs`; then a reviewed
`docs/evidence/feature-activation/selection.json`. Only one selection can ship
at a time. For near-nut, the first need is a workload that reaches its domain
often enough to be measured at all.
