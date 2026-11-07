# comboDrawPressure and barrelContinuationOutlook: measured, left unselected (2026-11-07)

Decision Readiness, Item 25. Two of the seven unselected `HORSE_FEATURE_FLAGS`
(`server/src/engine/HorseFeatureAuthority.ts`) were measured on/off on top of
current main (`132201536`, with #9803, #9838, #9842 and every other default-on
layer). Neither is promoted. No default, flag, selection or pin changed; this
change adds the measurement only.

## How a feature is promoted (read, not used)

`admitHorseFeatureReleaseAuthority` admits a flag only from a shipped
`docs/evidence/feature-activation/selection.json` that binds, by sha256, a
`horse-feature-live-admission-v1` qualification (`locked_paired_condition_a`,
no reasons), its `horse-incremental-ablation-plan-v2` plan in state
`heldout_locked` with a declared live domain (`HorseFeatureLiveDomain.ts`), and
a `horse-feature-ablation-assembly-v1` assembly of the held-out run with raw
provider artifacts retained, all pinned to the exact runtime source and
`package-lock.json`. The plan must be frozen after a development pilot and
protected-merged before any held-out seed is dealt
(`FeatureAblationQualification.ts`); the plan registry
(`server/src/benchmark/IncrementalPressureQualificationPlans.json`) is `{}`.
A skill whose development pilot shows no effect has nothing to lock, so the
route stops at step one for both skills below.

## Method

1. Duplicate-deal league (#9841 harness, `RiverBluffBaselineLeague.ts`):
   arm A = production with the skill on, arm B = production. The only change
   to the harness was an optional arm pair and per-arm hero receipt and
   pressure counters; it is recorded as
   `docs/horse-measure/2026-11-07/results/draw-barrel-skills/league-arms-harness.patch`
   and not committed to source, because a parallel lane (branch
   `horse/qualify-river-bluff-skills`) is adding the same `options.arms`
   generalisation to that file. Seed 20261107. Pools: production horses
   (`standard`), stations, over-folders (`folders`), mixed.
2. The sanctioned development pilot for each target
   (`src/scripts/featureAblationDevelop.ts`, its own stress population, PLO4
   2-dealt 100bb, first development seed, 576 pairs).

The container was shared with four other measurement lanes (load 18 on two
cores), so the planned matrix (all four variants, both formats) did not fit
the ~90 minute budget. What finished is everything below; PLO5, PLO6 and the
tournament cells did not run. The skills' reach (next section) is why that
does not change the decision.

## comboDrawPressure

What it is: on a heads-up cash flop/turn facing a bet, with a strong combo
draw, it adds re-pot/jam choices to the V38 EV menu. It is gated on
`pressure53 !== null`, i.e. the bettor reads as a measured aggressor or
maniac (`aggressiveBettorPressure`), on a non-presumed read, and outside
tournaments.

| cell | pairs | bb/100 (A-B) | 95% CI | divergent pairs |
| --- | ---: | ---: | --- | ---: |
| 6-max NLH cash standard / stations / folders | 5,000 each | 0.00 | [0.00, 0.00] | 0 |
| 6-max PLO4 cash standard / stations / folders | 800 each | 0.00 | [0.00, 0.00] | 0 |
| HU NLH cash standard / stations / folders / mixed | 2,000 each | 0.00 | [0.00, 0.00] | 0 |
| HU PLO4 cash standard | 1,000 | 0.00 | [0.00, 0.00] | 0 |
| dev pilot PLO4 HU (`incremental_public_overstab_stress_v1`) | 576 | 0.00 | [0.00, 0.00] | 0 (0 action contrasts) |

`combo_draw_pressure_evaluated` fired zero times in every cell, the pilot
included. Flop/turn hero raises facing a bet and their fold-out rate are
identical across arms (for example 27/47 won without a call in 6-max NLH
standard). None of the four required pools seats a measured aggressor, and the
pilot's stress population produced one `v53_pressure_semibluff_raise` in 576
pairs and no strong-draw spot behind it. Legality: 0 illegal actions, 0
truncated streets, 0 brain fallbacks; pilot 0 protocol, conservation, card,
settlement and replay errors.

Decision: unselected. It never acts, so it cannot be "positive where it
acts". Its reach is the defect to work on, not its pricing: it needs an
aggressor read that the measured fields never produce.

## barrelContinuationOutlook

What it is: the turn continuation records its own-card outlook, and on the
river the V7 continuation multiplies its continue chance by it (good 1.4,
blocked scare 1.2, unblocked scare 0.5). While its river barrel is pending it
also keeps the #9803 baseline river range out of that spot.

| cell | pairs | bb/100 (A-B) | 95% CI | divergent pairs |
| --- | ---: | ---: | --- | ---: |
| 6-max NLH cash standard | 5,000 | -0.05 | [-0.15, +0.05] | 1 |
| 6-max NLH cash stations / folders | 5,000 each | 0.00 | [0.00, 0.00] | 0 |
| 6-max PLO4 cash standard / stations / folders / mixed | 800 each | 0.00 | [0.00, 0.00] | 0 |
| HU NLH cash standard | 2,000 | +0.60 | [-0.58, +1.78] | 1 |
| HU NLH cash mixed | 2,000 | -0.70 | [-2.07, +0.67] | 1 |
| HU NLH cash stations / folders | 2,000 each | 0.00 | [0.00, 0.00] | 0 |
| HU PLO4 cash standard | 1,000 | 0.00 | [0.00, 0.00] | 0 |
| dev pilot PLO4 HU (`barrel_continuation_overstab_stress_v1`) | 576 | 0.00 | [0.00, 0.00] | 0 net (1 action contrast) |

Across 39,800 league pairs it changed three results: one river barrel added in
HU NLH standard (+0.60), one removed in HU NLH mixed (-0.70), one in 6-max NLH
standard (-0.05). River barrels after turn aggression (fold-outs / bets):
32/46 vs 31/45 and 19/61 vs 20/62 in those cells. Receipts show why reach is
this small: of the river spots that read a carried outlook, most are
`barrel_continuation_outlook_superseded` (a later owner decided the river)
and the rest `_considered` (the same roll without the multiplier made the same
choice); in the pilot 3 `_accepted`, 6 superseded, 2 considered. Legality: 0
illegal, 0 truncated, 0 fallbacks; pilot clean.

Decision: unselected. Net effect is three hands in ~40k pairs with a sum below
one big blind and signs both ways; it is not positive where it acts.

## Interactions

- #9803 / #9842 / #9838 river layers now own most river spots, which is what
  supersedes the carried outlook. Turning `barrelContinuationOutlook` on also
  withdraws the baseline range from a pending planned barrel, so a larger
  multiplier window would mainly trade baseline bluffs for V7 ones.
- PR #9845 (`horse/turn-flop-bluff-gates`, baseline flop/turn bluff range, not
  yet merged) takes turn gutshot and wrap spots before the V7 continuation;
  its diff already isolates `HorseContinuationOutlookAudit.test.ts` with
  `flopTurnBluffBaseline: false`. When it lands, fewer turn continuations will
  record an outlook, so this skill's reach falls further. Nothing here
  duplicates its fixes.

## Evidence

`docs/horse-measure/2026-11-07/results/draw-barrel-skills/results.json`: every
league cell per skill (paired bb/100, se, CI, divergent pairs, per-arm
pressure and barrel counts, skill receipts, legality counters) and both pilot
summaries (changed pairs, net cents per arm, skill receipts, every error
counter). `league-arms-harness.patch` is the measurement-only harness change.
The pilot manifests record revision `132201536` with `dirty: true`; the only
uncommitted change was that benchmark-file patch, which no decision path reads.

## Remaining gaps

- PLO5, PLO6 and all tournament cells unmeasured (compute). comboDrawPressure
  is a no-op in tournaments by its own gate.
- No pool with a measured aggressor; a future qualification of
  comboDrawPressure must add one (the qrvd lane's `aggressors` pool) or it
  will measure zero again.
