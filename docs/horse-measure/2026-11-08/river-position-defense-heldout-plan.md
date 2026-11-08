# riverPositionDefense held-out plan: 100bb heads-up NLH cash (2026-11-08)

**Status: PREPARED, NOT BOUND, NOT RUN.** No plan or family is registered, no
provider run is dispatched and no held-out seed is dealt. `riverPositionDefense`
stays unselected and off. This plan binds only to protected source that
contains #10048 (domain-scoped, closure-bound qualification). Until #10048
merges, the validator on `main` refuses the plan: it needs `admittedDomain` and
`sourceBinding`. Every value marked `<POST_10048_SHA>` is filled by the single
bind command below. No one fills it by hand.

Inputs: [Item 25 measurement](../2026-11-07/river-value-defense-qualification.md),
[candidate changelog](../../changelog/2026-10-27-conditional-river-position-defense-candidate.md),
[#10048 changelog](../../changelog/2026-11-08-feature-qualification-is-domain-scoped-and-closure-bound.md).
Script: [`river-position-defense-heldout/register-plan.mts`](river-position-defense-heldout/register-plan.mts).

## What is measured

|                 |                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target          | `river_position_defense` (flag `riverPositionDefense`)                                                                                                                                                        |
| Contrast        | candidate `{ riverPositionDefense: true }` vs reference `{ riverPositionDefense: false }`; every other flag is the protected source's default in both arms                                                    |
| Admitted domain | `horse-feature-admitted-domain-v1`: `nlh`, 2 dealt, 100bb                                                                                                                                                     |
| Live admission  | NLH cash, chips, 1/2 blinds, no ante, no-limit, single board, no side pots, 2 dealt at a 6-max table, 2 remaining, start 100bb, effective 0-100bb, published 1/2 rake (10%, cap 2.50 heads-up) and BBJ config |
| Source binding  | `horse-decision-closure-v1`: exactly the decision closure recomputed from the bound bytes, plus `server/package-lock.json`                                                                                    |
| Plan version    | `horse-river-position-defense-nlh-2dealt-100bb-closure-v1`, `heldout_locked`, schema `horse-incremental-ablation-plan-v2`                                                                                     |

Runtime refuses the selection outside the admitted domain (`outside_admitted_domain`). A pass therefore admits the skill only in 100bb heads-up NLH cash, which is where it was measured.

## Held-out data and seat design

- **Seeds:** the reserved incremental held-out seeds `28301109`, `28302231` and `28303347`. They have never been dealt. The only provider run of this target is run 42447773710 (#1, 2026-11-08T04:40Z). Its `plan` job refused with `heldout_plan_not_locked` before any cell job ran, and every cell and the assembly were skipped. That run becomes the family's provider anchor (baseline run number 1).
- **Pairing:** each pair is one deal played twice, once per arm, with common random numbers. The deal comes from `sha256-profile-seed-index-v1`, so card luck cancels and the error is the standard error of the per-pair difference.
- **Seats:** one profile, `river_position_defense-nlh-6max-2dealt-100bb`. Two players are dealt at a 6-max table, and the hero seat rotates through every relative position in each 576-pair rotation block, so positions stay balanced.
- **Field:** `incremental_public_overstab_stress_v1`, the declared synthetic river-overstab population. Warm public history comes from seed `27307777` (`incremental-public-overstab-warm-v1`), and the pooled public profiles are empty. The conditional last-to-act read (at least 8 opportunities, one-sided 99% Wilson lower bound of at least 0.65) needs this history to form. The field is a stress population, not calibrated human evidence (see "Not claimed").
- **Brain:** the real decision worker at the bound source (`current-worker-original-observer-controlled-crn-v1`). Controller-accepted actions are counted separately from proposals.

## Sample size and stopping rule

- **Matrix:** 3 seeds x 12 cells x 2,304 pairs (4 rotation blocks of 576) = **82,944 pairs**, which is 36 provider cells.
- **Sizing,** from the development pilot (seed 27301101, 576 pairs: +173.0 bb/100, per-pair sd 15.31bb, skewness 4.74, kurtosis 38.2, 50 accepted calls):
  - Primary (82,944 pairs): se 5.32 bb/100, 99% half-width **13.7 bb/100**, Edgeworth coverage error 0.00057, under the 0.001 cap, so the interval is trusted.
  - Each seed (27,648 pairs): Edgeworth error 0.00098. Seed cells need only a positive point estimate.
  - Each relative-position cell (41,472 pairs): every cell has at least 10,000 pairs. The effect sits entirely in the position that faces the river bet; at the pilot moments that cell's half-width is about 27 bb/100, with Edgeworth error 0.00054.
  - The primary fails only if the true effect is below about 14 bb/100, which is under a tenth of the pilot estimate.
  - Expected volume is about 342,000 hero decisions and about 7,200 accepted defense calls; the minimums below are under a third of that.
- **Stopping rule: fixed sample, one look.** There are no interim analyses, no early stop and no extension. Every cell runs once. Assembly reads every original attempt and gives one verdict.
  - `maxAttempts: 3` allows a re-attempt only for a cell whose evaluation step provably never started (`assertIncrementalUnconsumedRecovery`).
  - A failed or unknown start burns the partition. A later run of this target is refused (`already reserved by original run`). No seed is replaced and no plan is re-registered (`assertIncrementalFamilyHistory`).

## Metrics and pass thresholds (the existing gate, unchanged)

All in cash-after-rake bb/100, candidate minus reference, two-sided 99% normal interval (`PLO4_STRENGTH_CONTRACT.interval`). A pass needs all of these:

1. **Primary:** trusted interval (at least 10,000 pairs per profile, Edgeworth error at most 0.001) with lower bound **> 0**.
2. **Replication:** each of the 3 seeds has point estimate **> 0**.
3. **Critical cells:** profile, every relative position and depth 100 each have a trusted lower bound of **at least -10**.
4. **Coverage:**
   - candidate hero decisions at least **100,000**
   - reference hero decisions at least **100,000**
   - accepted hero action contrasts at least **2,400**
   - `river_position_defense_accepted` at least **2,400**
5. **Integrity,** every cell:
   - complete, and the exact registered shape
   - 0 protocol errors, brain exceptions, illegal actions, conservation, card, settlement or deduction errors, truncated hands and paired-replay mismatches.

A pass makes `feature-ablation-assemble.mjs` report `qualified: true`. The flag stays off even then. Admission needs a separate, reviewed `docs/evidence/feature-activation/selection.json` PR, and a certified engine release whose closure equals the bound bytes.

## Pinned inputs

These are all recomputed from the bytes at `<POST_10048_SHA>` by the bind command. The column on the right is the value rehearsed at #10048's head `4a34cf7b4c3`. The plan itself was never registered there.

| Input                                        | Pinned value                                                                                            | Rehearsed at 4a34cf7b (illustrative)                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `baselineReferenceRevision`                  | `<POST_10048_SHA>`                                                                                      | 4a34cf7b4c3fd13512db4b463fde0393e257b193                                     |
| `runtimeSourceFiles` / `runtimeSourceDigest` | decision closure at `<POST_10048_SHA>`                                                                  | 329 files / 449194c9b056a77d3aa8433c8c2619670b4ee1a0e8f8b8a979b504362ea6baa1 |
| `policyDigests` / `policyDigestsDigest`      | 26 admitted Phase 8-14 policy digests at `<POST_10048_SHA>`                                             | a8c6be25f94a91cba14ec0058784992becbef5ce5460cddc27053a1f80ba4d54             |
| `admissionDigest`                            | admissions at `<POST_10048_SHA>`                                                                        | 5c93404720ce02fb911240c1da720d51d58fa26393b997575d575b0be9b56c36             |
| `dependencyDigest`                           | sha256 of `server/package-lock.json`                                                                    | b9b88b0154db80a8a77a8de040834b41c53851465c793569acf2b5a7d6a80b74             |
| `storeInputsDigest`                          | frozen feature-ablation stores                                                                          | 6c1f9584009ddca56c38ee784f11644e9ae1388f6199fbf1d864d22e7bc0a92c             |
| `historyDigest`                              | warm records, seed 27307777                                                                             | e4e0ec799a14878be5e4f69e5d982562d17c8cac7eb12cf77777e1c581134cdf             |
| clock                                        | policy date 2026-10-26, public history at 2026-10-25T23:00Z, warm seed 27307777                         | same                                                                         |
| plan digest                                  | over the complete plan                                                                                  | cdcafc6378138637415d6ce5e33c716638329cd321e24c84037c54c57d153731             |
| CRN family                                   | `283`, one member (`river_position_defense`, plan digest), runtime source digest as above               |                                                                              |
| Provider anchor                              | workflow 398426971 (`horse-feature-ablation-qualification.yml`), baseline run 42447773710, run number 1 |                                                                              |
| Provider identity                            | `Smarter-Software-PIQ/Smarter-Poker-Club-Arena`, repository id 1132369872                               |                                                                              |

The rehearsal at `4a34cf7b` (local, detached, never pushed) gave these results:

- `--bind` wrote a plan that **passes #10048's own `validateLockedFeatureAblationPlan`, `featureLiveDomainRefusals` and `validateIncrementalFamily`**.
- `--verify` reproduced it exactly (`ok: true`).
- After a one-line change to `server/src/engine/HorseMind.ts`, `--verify` refused (`ok: false`): the runtime source, policy and admission digests changed.
- Logs: `/Volumes/SmarterArchives/agent-evidence/extreme-archive/hybrid-release-20261105-cont/rpd-heldout-plan-rehearsal/`.

## Bind (one step, only after #10048 merges)

On a branch cut from `<POST_10048_SHA>`, a `main` commit that contains #10048's merge commit, run from `server/`:

```bash
npx tsx ../docs/horse-measure/2026-11-08/river-position-defense-heldout/register-plan.mts \
  --bind --baseline=<POST_10048_SHA> \
  --anchor-run-id=42447773710 --anchor-run-number=1 --workflow-id=398426971
```

This writes exactly two files: `server/src/benchmark/IncrementalPressureQualificationPlans.json` and `IncrementalPressureQualificationFamilies.json`. It refuses in each of these cases:

- HEAD is not the baseline.
- `main` does not contain the baseline.
- The tracked tree is dirty.
- A plan or family 283 already exists.
- The plan fails the validators.

The same PR must also change the two assertions in `server/src/benchmark/IncrementalPressureQualification.test.ts` that pin both registries to `{}`; they assert the empty registry only. The registration lands through the normal protected PR: required checks, then squash merge. Its merge time becomes the family's registration time.

## Run (after the registration merges, and only under a closure freeze)

1. **Freeze the closure.** Activate a coordinator-held freeze of the bound set at the source commit (`(cd server && npx tsx scripts/write-closure-freeze.mjs --plan=horse-river-position-defense-nlh-2dealt-100bb-closure-v1 --reason="...")`, from #10048), so that no bound byte changes from dispatch through the certified release that ships a selection.
2. **Verify, read-only,** at the `main` commit to be measured (`SOURCE_SHA`). This must print `ok: true`:
   ```bash
   cd server && npx tsx ../docs/horse-measure/2026-11-08/river-position-defense-heldout/register-plan.mts --verify
   ```
3. **Dispatch once.** Spends the partition; there is no second attempt:
   ```bash
   env -u GH_TOKEN -u GITHUB_TOKEN gh workflow run horse-feature-ablation-qualification.yml \
     --repo Smarter-Software-PIQ/Smarter-Poker-Club-Arena --ref main \
     -f target=river_position_defense -f source_sha=<SOURCE_SHA>
   ```
4. **Read the verdict** from the `fa-assembly-river_position_defense-a1` artifact (`qualified`, `summary`).

## Decisions this needs from the owner, all one-way

- **Family 283 becomes closed to its other targets.** It is shared with `combo_draw_pressure`, `targeted_river_bluff` and `river_bluff_checkraise`. Registering it with this single member fixes its member list for good, so those three can never take a held-out run in family 283 without a code change. All three are currently inert or negative in development (#9863, #9866, #9867).
- **The held-out partition is spent by the first dispatch,** pass or fail.
- **The closure freeze holds the bound files (329 at `4a34cf7b`) for hours.** It covers the provider run, assembly, the selection PR and the release cut. Other lanes cannot merge into those files while it holds.

## Not claimed

- The field is a synthetic overstab stress population. It is not calibrated human play.
- Against production horse styles, the skill was exactly inert in development: 576 pairs, 0 accepted calls.
- 4- and 6-dealt NLH and every PLO variant are out of scope. Runtime refuses the selection there.
- A pass is evidence for this domain only. It is not a live-activation claim.
