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
  client, the decision worker thread the client spawns and the journal-writer
  thread that worker prespawns,
  the feature admission module and the qualification harness, plus the
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
- The closure is recomputed rather than declared, so a new or moved import
  cannot fall outside it. That holds only for loads a scanner can see. A load
  whose target is computed (a non-literal `new URL(x, import.meta.url)`,
  `new Worker(x)`, `createRequire`, a non-literal `import(x)`) is invisible to
  the walker and to the compiler alike, and the first version of this change
  missed exactly one: `horseDecision/client.ts` builds the production worker
  from a variable, so `horseDecision/worker.ts`, the thread every production
  decision runs on, was outside the closure (found in independent review).
  Every such site is now declared in `HORSE_DECISION_CLOSURE_INDIRECT_LOADS`
  (`HorseDecisionClosure.ts`) with the files it loads or why the bytes it reads
  are bound elsewhere; the decision worker and the journal writer worker it
  prespawns are closure entries, so their own imports are walked; and
  `HorseDecisionClosure.test.ts` fails on any undeclared site in any closure
  file and on any declared load that is not in the closure. The one input read
  from a path the environment names (`SOLVER_POLICY_ARTIFACT_PATH` in
  `SolverPolicyArtifactLoader.ts`) is data outside the repository; it is
  listed in `HORSE_DECISION_CLOSURE_EXTERNAL_INPUTS` so the boundary is written
  down, and no source binding holds it.
- Admission names its failures: a closure that cannot be computed (a bound
  file missing or unreadable) refuses as `policy_digest_unavailable`, the
  existing Phase 10-13 name for a running digest that cannot be computed;
  different bytes refuse as `policy_digest_mismatch`. A `.mjs` path is accepted
  only on a closure-bound plan; the whole-tree binding stays `.ts`/`.json`. A
  legacy-target plan (`plo6_v24`, `v53_pressure`) may not declare
  `sourceBinding` (`runtime_source_closure`), because only the incremental
  provider recomputes the closure before a held-out cell runs.

## Decision-closure freeze

Between registering a closure-bound held-out plan and the certified engine
release that carries its selection, any change to a bound byte turns the
qualification into a refusal and spends a one-shot held-out partition for
nothing. The freeze holds those bytes still for that interval.

- **Who activates it.** The agent that registers the closure-bound plan, in the
  same pull request or the one right after it, from a clean tree at the commit
  being frozen:
  `(cd server && npx tsx scripts/write-closure-freeze.mjs --plan=<id> --reason="...")`.
  That writes `docs/evidence/feature-activation/closure-freeze.json`: the plan
  id, the frozen commit and the SHA-256 of every bound file (exactly
  `featureAuthorityClosure()` plus `server/package-lock.json`). With no
  manifest, or `active: false`, nothing is frozen.
- **What it blocks.** Only a change to the frozen set.
  `HorseDecisionClosureFreeze.test.ts` fails a tree whose bound files differ
  from the frozen hashes, or whose bound set gained or lost a file (a new
  import counts). A pull request that touches nothing in the closure passes
  unchanged; one that does is held until the freeze is lifted.
- **How it is lifted.** After the certified release carrying the selection is
  serving (its 04:00 America/Chicago activation verified live), a pull request
  runs `write-closure-freeze.mjs --lift --reason="..."` (which sets
  `active: false` and keeps the record) or deletes the manifest. A qualification
  that is abandoned or refused lifts it the same way.

## Second review (2026-11-09)

- **Retargeted load closed.** Counting site kinds per file missed a retarget:
  `client.ts` spawning a new `workerV2.ts` kept the kinds `url, worker`, so the
  new worker fell outside the closure while every test passed. Now, in each
  site file that executes repository code, every declared executed module must
  be named by a relative literal, and every relative literal that names an
  existing code file must be in the closure. The reviewer's exact mutation
  makes `HorseDecisionClosure.test.ts` fail.
- **Known limit, recorded and not closed.** Data reads built with `path.join`
  (from `fileURLToPath(import.meta.url)`, `import.meta.dirname`,
  `process.cwd()` or a base held in a variable) are not detected. No closure
  file does this today. A new one would bind nothing, so treat it as a review
  item in any PR that adds one to a closure file.
