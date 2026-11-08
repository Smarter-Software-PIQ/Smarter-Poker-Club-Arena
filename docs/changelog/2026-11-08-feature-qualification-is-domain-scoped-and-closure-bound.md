# Feature qualification is domain-scoped and closure-bound (2026-11-08)

## Why

`riverPositionDefense` could not be qualified at all. Two rules in the held-out
feature qualification made it unreachable without weakening anything they
protect:

1. **Every variant and every shape had to qualify.** A plan had to carry 20
   profiles (NLH/PLO4/PLO5/PLO6 x five table shapes), each with a positive
   accepted-action minimum, a positive mean on every held-out seed and a 99%
   lower bound above zero. The skill acts in NLH heads-up (50 accepted calls per
   576 dev pairs, +180.96 +/- 64.92 bb/100) and essentially nowhere else (16 of
   20 profiles had zero accepted calls). Yet a selection was already only ever
   admitted on one live profile (`liveAdmission`). The gate measured far more
   than the selection lets act, and could not pass for a skill that is
   genuinely narrow.
2. **The source binding was the whole server tree.** A plan hashed every
   non-test `.ts`/`.json` under `server/src` (1,052 files), and admission
   re-hashed all of them. In 24 hours, 68 of 239 main commits touched that set,
   so no qualification could survive to a certified release. It also missed an
   executed decision-path module that is not `.ts`/`.json`
   (`src/services/horseCorrectiveReview/kernelGenerationLedgerRules.mjs`).

## What changed

- **`admittedDomain`** (optional on a `heldout_locked` plan): one variant x
  dealt count x starting depth. The plan's profiles must be exactly the profile
  inside it (`admitted_domain_coverage`), it must declare `liveAdmission` for
  that profile (`admitted_domain_live_binding`), and the summary gates (99%
  lower bound above 0, positive mean on every seed, critical cells, positive
  coverage minimums) run unchanged on it. A plan without `admittedDomain` still
  needs all 20 profiles exactly as before.
- **Runtime** refuses a selected authority outside its admitted domain with
  `outside_admitted_domain` (`horseFeatureDomainVerdict`), fired as
  `horse_feature_authority_outside_admitted_domain`. A decision inside it fires
  `horse_feature_authority_admitted_in_domain`; `horse_feature_authority_refused_*`
  names an unusable authority or a partial package disable. Admission refuses
  (`evidence_mismatch`) a scoped plan whose admitted domain is not the live
  profile it measured.
- **`sourceBinding: 'horse-decision-closure-v1'`** (optional): the plan binds
  exactly the decision closure (`HorseDecisionClosure.ts`). That is every module
  reachable through runtime imports from HorseLogic, the worker runtime, its
  client, the feature admission module and the qualification harness, plus the
  acceptance-path files admission names one by one. The qualification provider
  (`authenticateIncrementalPlan`) and runtime admission both recompute it from
  the bytes in front of them and require the plan to equal it exactly. Plans
  without `sourceBinding` keep the whole-tree binding.
- **Laws.** `HorseDecisionClosure.test.ts` holds the walker equal to the
  TypeScript compiler's own reading of the import graph, as a set and file by
  file (completeness). `HorseFeatureAuthority.test.ts` proves admission compares
  every bound file and the lock, and that a one-byte change, a dropped module or
  an extra file refuses (sensitivity).
- **Freeze machinery** (inactive until a manifest exists):
  `HorseDecisionClosureFreeze.test.ts` and `server/scripts/write-closure-freeze.mjs`
  hold exactly the same closure (plus `server/package-lock.json`).

## Integrity

The guarantee is that the held-out result describes exactly the bytes and the
domain that the selection lets act. Both changes keep it at least as strong:

- A scoped selection can act only where it was measured.
- The closure is recomputed rather than declared, so nothing executed can fall
  outside it. It is a superset of the files the whole-tree rule bound on the
  decision path (it adds the `.mjs`).
