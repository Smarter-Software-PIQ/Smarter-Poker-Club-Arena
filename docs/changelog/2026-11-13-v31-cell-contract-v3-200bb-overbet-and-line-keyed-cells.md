# V31 cell contract v3: 200 bb depth, overbet facing bucket, line-keyed cells (dormant)

Date: 2026-11-13. Lane: HV31 solver (FLOP-3 item B5). Status: dormant; no dataset declares v3.

## Why

The turn and river pilot (HV31 FLOP-2 W10) found three gaps that kept its cells from ever being registered:

1. Depth. The engine snaps every stack above 110 bb to the 150 bucket, while real horse cash hands have a median
   effective stack of 199 bb (13,309 heads-up flop hands, 2026-11-11 and 12).
2. Overbets. The public215 encoder (holdem-public-hist215-v2) has no category for a node facing a bet of 1.1 pot or
   more, so the pilot's 1.5-pot flop line could not be encoded at all.
3. Key collisions. The v2 cell key carries only the facing bet's size bucket, so a turn barrel after a called
   0.75-pot flop bet and after a called 1.5-pot flop bet are one cell. On the pilot tree's 86 v2-keyable decision
   nodes (one runout) 13 keys collide, covering 74 nodes. A lead into the previous street's aggressor (including the
   flop root after an in-position preflop raise) has no role at all.

## What

Contract v3 is declared per dataset (`cell_contract_version: 'v3'` on runtime rows, `"cell_contract": "v3"` in
registered cells). Only then:

- depth buckets are 10, 20, 40, 80, 150, 200; 150 serves 111 to 173 bb and 200 serves everything above
  (173 = the geometric midpoint of 150 and 200, the same rule as the 80/150 split at 110; on the real stack
  distribution it is also the boundary with the least mean log error);
- the cell key gains `line_class`, the size-bucketed public line before the node (`x` check, `c` call,
  `b-small|mid|big` bet, `r-small|mid|big` raise, `a` all-in; streets split by `/`);
- the open role `donk` names a lead into the previous street's aggressor;
- feature contract `holdem-public-hist215-v3` is v2's 246 features plus `facing_size_bucket=big` and
  `node_role=donk` (248; descriptor 26d9271d...).

Files: `server/src/engine/GtoDecisionContext.ts` (v3 depth, line class, v3 classifier; the v2 classifier is
unchanged), `server/src/engine/GtoPostflopV31.ts` (v3 rows, keys, lookup and range-provenance keys),
`GtoPublicHist215Contracts.ts`, `GtoPublicHist215FeatureSchema.ts`, `GtoPublicHist215Features.ts` (feature contract
v3), one migration (the registration guard and the range-provenance check accept valid v3 cells; the
dataset-insert check ties the feature and cell contracts), tests.

## Review fixes (B5 review, same day)

- M1: feature contract `holdem-public-hist215-v3` and cell contract v3 are tied both ways. The engine
  (`gtoV31FeatureContractVersion`) knows hist215-v3 only on a row or seal declaring `cell_contract_version: 'v3'`,
  and refuses hist215-v1 or v2 on such a row; so the loader's `v31_feature_contract_unknown` refuses a v2 row
  declaring hist215-v3 exactly as before v3 existed. The migration's dataset-insert check
  (`fn_gto_v31_dataset_matches_registration`, re-created with its original text) refuses a dataset declaring
  hist215-v3 for a v2 registration and a dataset declaring hist215-v1 or v2 for a v3 registration. World Hub
  enforces the same on manifests, provenance and registrations.
- The public215 NumPy frame width check accepts every contract's width from `GtoPublicHist215Contracts.ts`
  (215, 246, 248), not a hard-coded pair; the unused `GTO_V31_MAX_DEPTH_BB_V3` constant is removed (the wiring
  PR decides the depth ceiling).
- The native proof now exercises every v2 refusal of the re-created registration guard and dataset-insert
  check and mutates each one; the collision proof covers four generated trees (5,594 decision nodes) besides
  the pilot tree, and pins the pilot's v2 collision count (25 keys, 13 shared by 74 nodes).

## What does not change

Every v2 dataset, cell, key, feature vector and decision is identical: v3 code runs only for a dataset that
declares it, and none exists. Every registration, provenance entry and runtime row refused before is still refused.

## Not yet built (needed before a v3 dataset can serve)

- The live consult caller (`HorseV31CertifiedPolicy.ts`) does not yet pass the v3 context; a v3 store misses
  with `no_line_class` until it does.
- `gto_v31_runtime_cells` has no `line_class` column, so a v3 round can be registered but not built or sealed;
  the dataset and cell validators still accept depth 10 to 150 only; the SQL public215 encoding chain and the
  Linux preflight graph know feature contracts v1 and v2 only.
- The World Hub training metadata path (`validate_context_metadata`) is v2 only.
- The live consult gates on `GTO_MAX_DEPTH_BB` (300 bb); the wiring PR must choose the v3 depth ceiling.
