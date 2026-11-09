# riverPositionDefense held-out plan: draft (2026-11-08)

State: superseded by the registration of 2026-11-09
(docs/changelog/2026-11-09-river-position-defense-registers-family-283.md). The
plan registered there was regenerated on protected main 075a81c3c, not the
#10048 head this draft describes. `riverPositionDefense` stays unselected until
the held-out run qualifies it.

## What this adds

- `server/src/scripts/featureAblationDraftPlan.ts`: computes a domain-scoped,
  closure-bound `heldout_locked` plan from the bytes in front of it, using the
  same computations the provider (`featureAblationQualify.ts`) and runtime
  admission (`featureAuthorityClosure`) verify: decision closure and per-file
  hashes, dependency lock, frozen stores, warm public history, phase admissions
  and policy digests, published 1/2 cash economics for the live domain. It
  validates the result with `validateLockedFeatureAblationPlan` and writes a
  review report. It never reads or writes a registry and deals no hand.
- `river-position-defense-heldout.design.json`: the scientific choices as data.

## Draft result at the #10048 head (4a34cf7b4c, not protected main)

`registrable: true`, refusals none, 329 closure files, 21 cells, 24,192 pairs,
seed family 283, held-out seeds 28301109 / 28302231 / 28303347, population
`incremental_public_overstab_stress_v1`, contrast `riverPositionDefense`
true vs false, admitted domain NLH, 2 dealt, 100bb, live domain 1/2 chips cash.
The plan digest at this head is not the one to register: the plan must be
regenerated on protected main after #10048 merges, because the closure hashes
and `baselineReferenceRevision` must be protected bytes.

## Sizing, from the retained development pilot

Pilot `river_position_defense-nlh-6max-2dealt-100bb-s27301101`, 576 pairs on
5c1aaaef76: 50 changed pairs, all in stratum `1|river` (offset 0 had 288 pairs
with zero difference); per-pair mean 346 cents, which is 1.73 big blinds
of 200 cents (173 bb/100); per-pair sd about 3,060 cents (15.3 bb); 2,378 hero
decisions per arm.

- Primary gate (99% lower bound above 0): at 24,192 pairs the standard error
  is about 9.8 bb/100, so the pilot effect clears zero with large margin; a
  true effect one third of the pilot's still clears it.
- Each seed above 0: 8,064 pairs per seed, standard error about 17 bb/100.
- Critical cells: the contract trusts an interval only with at least 10,000
  pairs per profile in a cell. Heads-up has two dealer-relative offsets, so
  24,192 pairs leaves about 12,096 per offset. Offset 0 never changed in the
  pilot (difference exactly 0), which satisfies the -10 bb/100 floor.
- Coverage minimums: expected about 2,100 accepted contrasts and about 100,000
  hero decisions per arm; minimums 700 and 50,000 (one third and one half).
- Cells of 1,152 pairs (two rotation blocks) keep each provider job well
  inside its 240-minute limit; 21 cells, under the 256 bound.

## Decisions that must be made before registration (irreversible)

1. **Family 283 membership is permanent.** `river_position_defense` shares
   seed family 283 with `combo_draw_pressure`, `targeted_river_bluff` and
   `river_bluff_checkraise`. A family can be registered once; protected
   history refuses replacing or reintroducing it, and every member shares one
   runtime source digest. Registering family 283 with only
   `river_position_defense` permanently ends the chance to qualify the other
   three through family 283. Their recorded state today: combo_draw_pressure
   inert, targeted_river_bluff (V54) subsumed and negative, river_bluff_checkraise
   unreachable by the harness.
2. **The held-out partition is spent by the first dispatch.** A failed or
   unknown start burns it; there is no replacement run.
3. **Source stability from registration to release.** Admission re-hashes the
   329-file decision closure. The plan, the provider run and the certified
   engine release that ships the selection must carry identical closure bytes.
   In the 24 hours to 2026-11-08 03:00Z, HorseLogic.ts alone changed 19 times.
   The closure freeze manifest from #10048 (`write-closure-freeze.mjs`) can hold
   those 329 files only; it does not hold unrelated releases.

## Procedure once the owner decides family 283

1. #10048 merged (human review gate).
2. On protected main: run the drafter, confirm `registrable: true`.
3. One protected PR: the plan into `IncrementalPressureQualificationPlans.json`
   and family 283 into `IncrementalPressureQualificationFamilies.json`, with
   `providerAnchor` = the newest existing run of
   `horse-feature-ablation-qualification.yml` (id, run number, workflow id)
   read at registration time; activate the closure freeze manifest in the same
   or the preceding protected change.
4. Dispatch `horse-feature-ablation-qualification.yml` with
   `target=river_position_defense` and the protected source SHA, once.
5. Assemble with `server/scripts/feature-ablation-assemble.mjs`; only
   `qualified: true` permits a reviewed
   `docs/evidence/feature-activation/selection.json`.
6. Lift the freeze after the certified release carrying the selection serves.
