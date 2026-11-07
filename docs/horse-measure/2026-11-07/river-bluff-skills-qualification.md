# Item 25: the three dormant river bluff skills, measured on top of the default-on river layers (2026-11-07)

Skills: `v54RiverBluff` (target `targeted_river_bluff`), `riverBluffCheckRaise`
(`river_bluff_checkraise`) and `multiwayRiverBluffCheckRaise`
(`multiway_river_bluff_checkraise`, measured as its maintained composition with
`riverBluffCheckRaise` held on in both arms). Engine: main `132201536`
(#9803 baseline, #9842 multiway, #9838 OOP leads and hi-lo, #9837 other games,
#9841 harness). Decision: **none of the three is promoted**; all stay
unselected. The reasons are measured, below.

## How promotion works, and why this is not a promotion run

A feature flag goes live only through `HorseFeatureAuthority.admitHorseFeatureAuthority`:
a shipped `docs/evidence/feature-activation/selection.json` naming a
`horse-feature-live-admission-v1` record whose bound plan is a registered
`horse-incremental-ablation-plan-v2` in state `heldout_locked`, whose assembly
(`server/scripts/feature-ablation-assemble.mjs`) was built from provider
(GitHub Actions) heldout runs with raw pair artifacts retained, qualified for
that exact flag composition and one exact live-domain profile
(`HorseFeatureLiveDomain.ts`: cash, chips, 1/2, published rake, one starting
shape). Development runs are `promotionEligible: false` by construction. No
selection exists on main. `HorseDormantCandidateReadiness.test.ts` proves the
admission mechanics with synthetic evidence; it does not select anything, so
it is unchanged. A heldout plan is only worth registering for a skill whose
development evidence says it would qualify; none of these does.

## Method

1. `v54RiverBluff`: the #9841 duplicate-deal harness
   (`RiverBluffBaselineLeague.ts`, generalised with optional arms and skill
   counters; omitted options reproduce #9841 exactly), CLI
   `server/src/scripts/riverBluffSkillLeague.ts`. Arm A `{v54RiverBluff: true}`,
   arm B current main (every default-on river layer on). Pools standard /
   stations / folders / mixed, cash 100bb and tournament 40bb, six-handed and
   heads-up. Seeds 20261108 (all formats) and 20261109 (heads-up cash only,
   where the skill can act). 92,500 pairs, 185,000 hands: heads-up 70,000 pairs
   (NLH 48,000, PLO4 12,000, PLO5 6,000, PLO6 4,000), six-handed 22,500 (NLH
   16,000, PLO4 4,000, PLO5 2,500; PLO5 tournament pools after `standard` and
   all of PLO6 six-handed were not reached). Tables:
   `scripts/horse-measure/river-bluff-skill-report.py` over the cells in
   `results/river-bluff-skills/v54-cells.json`; the stress pilots are summarised
   in `results/river-bluff-skills/checkraise-development-pilots.json`.
2. `riverBluffCheckRaise` and `multiwayRiverBluffCheckRaise` CANNOT be
   measured in the #9841 harness. Both require a schema-1 decision state
   (`stateSchemaVersion: 1`, `dealtSeatIds`, `publicNode` per action) that
   `HorseLeague.playHand` does not build; probes there recorded zero
   `river_bluff_checkraise_evaluated` fires. They were measured instead with
   the production-fidelity worker league they were built for
   (`server/src/scripts/featureAblationDevelop.ts`, declared development seeds
   27301101 and 27801101), whose populations are the declared STRESS
   populations: opponents that bet the checked river every time and fold to a
   same-size check-raise every time. That is the most favourable field the
   skill can meet, not a production pool.
3. Compute: about 90 minutes on a shared two-core container whose load reached
   31 and which OOM-killed one pilot; that is why the sample is what it is.

## v54RiverBluff

Pooled (paired A - B, bb/100, 95% CI):

| slice               | pairs | A-B            | 95% CI         | v54 bets | field folded |
| ------------------- | ----- | -------------- | -------------- | -------- | ------------ |
| heads-up all        | 70000 | +0.41 +/- 0.30 | [-0.17, +0.99] | 27       | 17 (63%)     |
| heads-up NLH        | 48000 | +0.27 +/- 0.16 | [-0.04, +0.58] | 24       | 16 (67%)     |
| heads-up PLO4       | 12000 | +1.16 +/- 1.19 | [-1.18, +3.49] | 1        | 0            |
| heads-up PLO5       | 6000  | +0.26 +/- 2.14 | [-3.94, +4.46] | 2        | 1            |
| heads-up PLO6       | 4000  | +0.04 +/- 0.04 | [-0.04, +0.11] | 0        | -            |
| heads-up stations   | 17000 | +0.79 +/- 0.40 | [+0.01, +1.57] | 1        | 0            |
| heads-up standard   | 19000 | +0.11 +/- 0.74 | [-1.35, +1.57] | 16       | 12 (75%)     |
| heads-up folders    | 17000 | -0.02 +/- 0.05 | [-0.12, +0.08] | 4        | 3 (75%)      |
| heads-up mixed      | 17000 | +0.79 +/- 0.79 | [-0.76, +2.34] | 6        | 2 (33%)      |
| heads-up tournament | 14000 | +0.00          | identical      | 0        | -            |
| six-handed all      | 22500 | +0.10 +/- 0.06 | [-0.01, +0.22] | 0        | -            |

Legality: 0 illegal actions, 0 truncated streets, 0 brain exception fallbacks
in all 62 cells.

What the numbers say:

- **It almost never acts.** 27 bets in 70,000 heads-up hands (0.04%), none in
  22,500 six-handed hands. Heads-up it skipped 4,874
  spots for showdown value and 1,019 for no story; six-handed, every multiway river is
  outside it (`v54_river_bluff_skip_multiway`).
- **Tournament is identical by construction.** It requires a trusted complete
  tournament context (2,702 `skip_tournament_context`), and the feature live
  domain is cash only anyway.
- **Its own bets are not shown to win.** The field folded 63% against a
  roughly 43-50% break-even share, but the 27 hands it bet netted -35.5 bb for
  arm A; 27 events cannot separate it from zero either way.
- **The only material effect is not its bluff, it is its check.** V54 runs
  before the baseline range and, against an opponent memory calls a station,
  returns a check (`v54_river_bluff_skip_station`, 877 heads-up), and on a
  frequency miss returns a check (33). Those checks pre-empt the baseline
  range in the same spot: heads-up baseline bluffs fell 2 vs 19 against
  stations (NLH, 10,000 pairs) and 1 vs 4 in PLO4 stations. That is where the
  +0.79 [+0.01, +1.57] against stations comes from. It is a statement about the
  baseline's station factor (x0.2), not evidence for the V54 bluff.

Overlap: V54's spot (heads-up, checked to or first, air, a value story, capped
opponent, blocker, deep enough) is a strict subset of the baseline range's spot
(#9803), which bets the same rivers at the balanced rate with the same blocker
and read weighting. **V54's bluff is subsumed by the baseline range.** What it
adds is a harder station check, which belongs in the baseline's own read
factor if it is wanted, measured there. Decision: **unselected**.

## riverBluffCheckRaise (heads-up, cash)

Development pilots, stress population `incremental_public_triple_checkraise_stress_v1`,
seed 27301101, 2-dealt 100bb, 576 pairs each:

| variant | A-B bb/100       | 95% CI          | evaluated | selected | changed pairs |
| ------- | ---------------- | --------------- | --------- | -------- | ------------- |
| NLH     | +9.20 +/- 9.20   | [-8.83, +27.24] | 5         | 1        | 1             |
| PLO4    | +0.00            | identical       | 6         | 0        | 0             |
| PLO5    | +20.95 +/- 14.81 | [-8.07, +49.98] | 11        | 2        | 2             |
| PLO6    | +37.68 +/- 18.22 | [+1.96, +73.39] | 17        | 5        | 5             |

0 illegal actions, protocol errors, brain exceptions, conservation errors,
truncated hands or replay mismatches. Even against a field that stabs every
checked river and folds every check-raise, the reads that gate it (river
pressure lower bound 0.65 at 99%, same-size response read, high VPIP) let it
act 8 times in 2,304 pairs; each act wins the pot, so the estimates are driven
by one to five hands with kurtosis near 600. It owns a different spot from
every default-on layer (facing a river bet after checking; the baseline, the
multiway layer and the OOP lead all act only with nothing to call), so it is
not subsumed - but there is no measurement of it against any production pool,
because the #9841 pools cannot reach it, and production horses do not stab
like the stress field, so its read gate would rarely open. Decision:
**unselected**; the next step is a schema-1 duplicate-deal league with the
#9841 pools.

## multiwayRiverBluffCheckRaise (original 4-6 dealt, cash)

Development pilots, stress population `multiway_original_fold_to_hu_public_stress_v1`,
seed 27801101, candidate `{riverBluffCheckRaise, multiwayRiverBluffCheckRaise}`
vs reference `{riverBluffCheckRaise}`:

| profile      | pairs                    | A-B bb/100        | selected |
| ------------ | ------------------------ | ----------------- | -------- |
| NLH 6-dealt  | 288                      | +0.00 (identical) | 0        |
| NLH 4-dealt  | 415 (interrupted of 576) | +0.00 (identical) | 0        |
| PLO4 6-dealt | 288                      | +0.00 (identical) | 0        |
| PLO6 6-dealt | 167 (interrupted of 288) | +36.23 +/- 36.23  | 1        |

PLO5 6-dealt was killed by the container's memory limit; 4-dealt PLO4/5/6 were
not reached. One act in 1,158 pairs. Overlap: #9842's default-on multiway
river bluff bets checked-to multiway rivers; this skill check-raises a
heads-up river that started multiway, so the spots differ and it is not
subsumed, but it is unmeasurable in production pools for the same schema-1
reason and acts essentially never in its own stress field. Decision:
**unselected**.

## Full v54RiverBluff tables (both seeds combined)

### v54RiverBluff, 6-handed

| variant | format     | pool     | pairs | A-B bb/100     | 95% CI         | div | skill acted (A) | field folded | net bb of those hands | baseline bluffs A/B | river bets A/B | illegal+trunc+fallback |
| ------- | ---------- | -------- | ----- | -------------- | -------------- | --- | --------------- | ------------ | --------------------- | ------------------- | -------------- | ---------------------- |
| nlh     | cash       | folders  | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 6/6                 | 31/31          | 0                      |
| nlh     | cash       | mixed    | 2000  | +0.40 +/- 0.40 | [-0.38, +1.18] | 1   | 0               | -            | +0.0                  | 2/3                 | 58/59          | 0                      |
| nlh     | cash       | standard | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 7/7                 | 33/33          | 0                      |
| nlh     | cash       | stations | 2000  | +0.33 +/- 0.33 | [-0.31, +0.96] | 1   | 0               | -            | +0.0                  | 0/1                 | 94/95          | 0                      |
| nlh     | tournament | folders  | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 6/6                 | 36/36          | 0                      |
| nlh     | tournament | mixed    | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 3/3                 | 61/61          | 0                      |
| nlh     | tournament | standard | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 11/11               | 53/53          | 0                      |
| nlh     | tournament | stations | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 1/1                 | 88/88          | 0                      |
| plo4    | cash       | folders  | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 0/0                 | 6/6            | 0                      |
| plo4    | cash       | mixed    | 500   | +1.82 +/- 1.82 | [-1.74, +5.38] | 1   | 0               | -            | +0.0                  | 0/1                 | 13/14          | 0                      |
| plo4    | cash       | standard | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 2/2                 | 18/18          | 0                      |
| plo4    | cash       | stations | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 0/0                 | 20/20          | 0                      |
| plo4    | tournament | folders  | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 1/1                 | 5/5            | 0                      |
| plo4    | tournament | mixed    | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 2/2                 | 13/13          | 0                      |
| plo4    | tournament | standard | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 0/0                 | 6/6            | 0                      |
| plo4    | tournament | stations | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 1/1                 | 16/16          | 0                      |
| plo5    | cash       | folders  | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 1/1                 | 3/3            | 0                      |
| plo5    | cash       | mixed    | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 0/0                 | 8/8            | 0                      |
| plo5    | cash       | standard | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 2/2                 | 12/12          | 0                      |
| plo5    | cash       | stations | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 0/0                 | 11/11          | 0                      |
| plo5    | tournament | standard | 500   | +0.00 +/- 0.00 | [+0.00, +0.00] | 0   | 0               | -            | +0.0                  | 1/1                 | 5/5            | 0                      |

Pooled (v54RiverBluff, 6-handed, hand-weighted):

| slice      | pairs | A-B bb/100     | 95% CI         | skill acted | field folded |
| ---------- | ----- | -------------- | -------------- | ----------- | ------------ |
| all        | 22500 | +0.10 +/- 0.06 | [-0.01, +0.22] | 0           | -            |
| nlh        | 16000 | +0.09 +/- 0.06 | [-0.04, +0.22] | 0           | -            |
| plo4       | 4000  | +0.23 +/- 0.23 | [-0.22, +0.67] | 0           | -            |
| plo5       | 2500  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0           | -            |
| cash       | 12000 | +0.20 +/- 0.11 | [-0.03, +0.42] | 0           | -            |
| tournament | 10500 | +0.00 +/- 0.00 | [+0.00, +0.00] | 0           | -            |
| standard   | 6000  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0           | -            |
| stations   | 5500  | +0.12 +/- 0.12 | [-0.11, +0.35] | 0           | -            |
| folders    | 5500  | +0.00 +/- 0.00 | [+0.00, +0.00] | 0           | -            |
| mixed      | 5500  | +0.31 +/- 0.22 | [-0.12, +0.74] | 0           | -            |

Arm A fire counts: river_bluff_baseline_blocker 8, river_bluff_baseline_blockerAndDraw 8, river_bluff_baseline_check 185, river_bluff_baseline_junk 5, river_bluff_baseline_missedDraw 25, river_bluff_baseline_skip_multiway 399, river_bluff_baseline_skip_no_story 8, v54_river_bluff_skip_frequency 5, v54_river_bluff_skip_multiway 228, v54_river_bluff_skip_no_blocker 2, v54_river_bluff_skip_no_story 87, v54_river_bluff_skip_showdown_value 466, v54_river_bluff_skip_station 39, v54_river_bluff_skip_tournament_context 690, v54_river_bluff_skip_uncapped 3

### v54RiverBluff, 2-handed

| variant | format     | pool     | pairs | A-B bb/100     | 95% CI          | div | skill acted (A) | field folded | net bb of those hands | baseline bluffs A/B | river bets A/B | illegal+trunc+fallback |
| ------- | ---------- | -------- | ----- | -------------- | --------------- | --- | --------------- | ------------ | --------------------- | ------------------- | -------------- | ---------------------- |
| nlh     | cash       | folders  | 10000 | -0.04 +/- 0.09 | [-0.20, +0.13]  | 4   | 4               | 3 (75%)      | +3.0                  | 117/123             | 306/308        | 0                      |
| nlh     | cash       | mixed    | 10000 | +0.06 +/- 0.29 | [-0.52, +0.63]  | 34  | 5               | 2 (40%)      | -21.5                 | 27/37               | 502/508        | 0                      |
| nlh     | cash       | standard | 10000 | +0.32 +/- 0.23 | [-0.14, +0.78]  | 8   | 14              | 11 (79%)     | +2.0                  | 106/113             | 507/500        | 0                      |
| nlh     | cash       | stations | 10000 | +0.97 +/- 0.66 | [-0.32, +2.25]  | 42  | 1               | 0 (0%)       | -5.5                  | 2/19                | 871/887        | 0                      |
| nlh     | tournament | folders  | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 14/14               | 51/51          | 0                      |
| nlh     | tournament | mixed    | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 6/6                 | 144/144        | 0                      |
| nlh     | tournament | standard | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 56/56               | 204/204        | 0                      |
| nlh     | tournament | stations | 2000  | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 4/4                 | 174/174        | 0                      |
| plo4    | cash       | folders  | 2500  | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 4/4                 | 12/12          | 0                      |
| plo4    | cash       | mixed    | 2500  | +5.24 +/- 5.26 | [-5.07, +15.54] | 58  | 0               | -            | +0.0                  | 7/10                | 72/71          | 0                      |
| plo4    | cash       | standard | 2500  | -1.06 +/- 2.16 | [-5.28, +3.16]  | 20  | 1               | 0 (0%)       | -9.0                  | 21/22               | 88/88          | 0                      |
| plo4    | cash       | stations | 2500  | +1.38 +/- 0.67 | [+0.06, +2.71]  | 5   | 0               | -            | +0.0                  | 1/4                 | 103/107        | 0                      |
| plo4    | tournament | folders  | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 3/3                 | 6/6            | 0                      |
| plo4    | tournament | mixed    | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 5/5                 | 12/12          | 0                      |
| plo4    | tournament | standard | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 4/4                 | 21/21          | 0                      |
| plo4    | tournament | stations | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 1/1                 | 14/14          | 0                      |
| plo5    | cash       | folders  | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 1/1                 | 1/1            | 0                      |
| plo5    | cash       | mixed    | 500   | -0.40 +/- 0.40 | [-1.18, +0.38]  | 1   | 1               | 0 (0%)       | -9.0                  | 4/5                 | 12/12          | 0                      |
| plo5    | cash       | standard | 2500  | +0.62 +/- 5.14 | [-9.45, +10.69] | 57  | 1               | 1 (100%)     | +4.5                  | 19/21               | 79/82          | 0                      |
| plo5    | cash       | stations | 500   | +0.39 +/- 0.90 | [-1.37, +2.15]  | 2   | 0               | -            | +0.0                  | 2/3                 | 13/14          | 0                      |
| plo5    | tournament | folders  | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 3/3                 | 5/5            | 0                      |
| plo5    | tournament | mixed    | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 5/5                 | 12/12          | 0                      |
| plo5    | tournament | standard | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 5/5                 | 21/21          | 0                      |
| plo5    | tournament | stations | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 4/4                 | 14/14          | 0                      |
| plo6    | cash       | folders  | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 1/1                 | 5/5            | 0                      |
| plo6    | cash       | mixed    | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 2/2                 | 15/15          | 0                      |
| plo6    | cash       | standard | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 5/5                 | 19/19          | 0                      |
| plo6    | cash       | stations | 500   | +0.30 +/- 0.30 | [-0.29, +0.89]  | 1   | 0               | -            | +0.0                  | 1/2                 | 20/21          | 0                      |
| plo6    | tournament | folders  | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 1/1                 | 3/3            | 0                      |
| plo6    | tournament | mixed    | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 2/2                 | 13/13          | 0                      |
| plo6    | tournament | standard | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 2/2                 | 18/18          | 0                      |
| plo6    | tournament | stations | 500   | +0.00 +/- 0.00 | [+0.00, +0.00]  | 0   | 0               | -            | +0.0                  | 1/1                 | 15/15          | 0                      |

Pooled (v54RiverBluff, 2-handed, hand-weighted):

| slice      | pairs | A-B bb/100     | 95% CI         | skill acted | field folded |
| ---------- | ----- | -------------- | -------------- | ----------- | ------------ |
| all        | 70000 | +0.41 +/- 0.30 | [-0.17, +0.99] | 27          | 17 (63%)     |
| nlh        | 48000 | +0.27 +/- 0.16 | [-0.04, +0.58] | 24          | 16 (67%)     |
| plo4       | 12000 | +1.16 +/- 1.19 | [-1.18, +3.49] | 1           | 0 (0%)       |
| plo5       | 6000  | +0.26 +/- 2.14 | [-3.94, +4.46] | 2           | 1 (50%)      |
| plo6       | 4000  | +0.04 +/- 0.04 | [-0.04, +0.11] | 0           | -            |
| cash       | 56000 | +0.51 +/- 0.37 | [-0.21, +1.24] | 27          | 17 (63%)     |
| tournament | 14000 | +0.00 +/- 0.00 | [+0.00, +0.00] | 0           | -            |
| standard   | 19000 | +0.11 +/- 0.74 | [-1.35, +1.57] | 16          | 12 (75%)     |
| stations   | 17000 | +0.79 +/- 0.40 | [+0.01, +1.57] | 1           | 0 (0%)       |
| folders    | 17000 | -0.02 +/- 0.05 | [-0.12, +0.08] | 4           | 3 (75%)      |
| mixed      | 17000 | +0.79 +/- 0.79 | [-0.76, +2.34] | 6           | 2 (33%)      |

Arm A fire counts: river_bluff_baseline_blocker 29, river_bluff_baseline_blockerAndDraw 98, river_bluff_baseline_check 1547, river_bluff_baseline_junk 146, river_bluff_baseline_missedDraw 164, river_bluff_baseline_skip_no_story 59, v54_river_bluff 27, v54_river_bluff_skip_frequency 33, v54_river_bluff_skip_no_blocker 17, v54_river_bluff_skip_no_story 1019, v54_river_bluff_skip_showdown_value 4874, v54_river_bluff_skip_station 877, v54_river_bluff_skip_tournament_context 2012, v54_river_bluff_skip_uncapped 27
