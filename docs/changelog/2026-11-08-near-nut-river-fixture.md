# Near-nut river fixture: the skill reaches its decision in development, and in production once selected (2026-11-08)

`smallPotNearNutRiverValue` (target `small_pot_near_nut_value_raise`, counter
`small_pot_near_nut_value_raise_accepted`) acted once in 2,876 development
pairs and never in the duplicate-deal league
(`docs/horse-measure/2026-11-07/river-value-defense-qualification.md`), so it
could not be measured. This adds a deterministic fixture that deals its spot
and drives the original decision worker with it. No default, selection file or
strategy line changed; `docs/evidence/feature-activation/selection.json` still
does not exist and the skill stays off in production.

## What was built

`server/src/benchmark/NearNutRiverFixture.ts` (development only):

- Deals PLO4/PLO5/PLO6 heads-up 100bb 1/2 cash hands on a real
  `HandController` from a stacked deck: the board is paired exactly once, and
  the hero holds a full house with exactly one bigger boat and no quads live
  (near-nut, not the nuts). The public line (limp or open to 4/6, a checked or
  third-pot flop, a checked turn) and the river opening bet (0.25, 0.33, 0.45 or
  0.5 of the pot) are scripted, and every size is legal on the controller's own
  menu. Action timestamps are pinned, so the decision key and the worker's
  sampling seed are identical on every run.
- Builds the cash `HandConfig` the way `ServerTableEngineDealing` does
  (`getFullRakeConfig`, `cashPolicy`, player-count caps, the BBJ config the
  engine attaches, chips asset). It also builds the river snapshot field for
  field the way `ServerTableEngineTurns.scheduleHorseAction` does
  (`applyTableCommitmentCap` / `applyAllInOrFoldActionState`,
  `getChipRulesSnapshot`, `getRakeConfigSnapshot`, `computeLivePots`, the
  contestable pot, the public-seat firewall, the hybrid cash profile, no
  `opts`).
- Runs the decision through `HorseDecisionWorkerRuntime` with the default
  production dependencies: every phase admission, the feature release
  authority and `HorseLogic.decide`. Service start-up, journals and the
  observation clock are replaced, as `FeatureAblationWorker` does. Three arms:
  `production` (the default worker); `off` (the development harness's
  `offlineFeatureFlags` worker with no flag); and `on` (the same worker with the
  flag true, paired on the production arm's RNG seed). The accepted counter is
  computed with `acceptedIncrementalComponents` from the controller-accepted
  action.

`server/src/benchmark/NearNutRiverFixture.test.ts` pins the result.

## What it reaches (60 states per variant)

| variant | in domain | gate reached (flag on) | skill's own raise | PLO6 flat exception | accepted counter | flag-on vs flag-off changed | flag-off equals production |
| ------- | --------- | ---------------------- | ----------------- | ------------------- | ---------------- | --------------------------- | -------------------------- |
| plo4    | 60/60     | 60/60                  | 13                | 0                   | 13               | 13                          | 60/60                      |
| plo5    | 60/60     | 60/60                  | 12                | 0                   | 12               | 12                          | 60/60                      |
| plo6    | 60/60     | 60/60                  | 19                | 11                  | 19               | 23                          | 60/60                      |

The other in-domain decisions are `small_pot_near_nut_value_considered`: the
original value gate already raised there. No later policy node replaced a
reference raise. The variant packs ran in candidate mode on every decision
(owner-forced authority) and retained the reference (`reference_retained`
60/60 per variant). Neither the production arm nor the flag-off arm fired any
near-nut receipt.

## What it found: production could not reach the gate (fixed in the base commit)

The handoff concern that the PLO variant packs own the river first does not
hold. The gate runs inside the policy graph's `reference` node
(`HorseLogic.decide` -> `decideInternal` -> `graph.run('reference')` ->
`decidePostflop` -> the facing-a-bet value-raise band). That node runs before
`variant_policy`, and the packs retained its raise every time.

The block is the worker's feature admission. In production the flag reaches
`HorseLogic.decide` only through `HorseDecisionWorkerRuntime.featureAdmission`
-> `admittedHorseFeatureFlags` -> `featureDomainMatches`
(`server/src/engine/HorseFeatureAuthority.ts`). With no selection the flag is
off. With a near-nut authority admitted for exactly this declared profile (a
domain that `featureLiveDomainRefusals` accepts), the predicate still refuses
every state the skill acts on, for two independent reasons:

1. `gs.pots.length <= 1`. Facing an uncalled opening river bet, the live pots
   always have two layers, because the bettor-only refundable layer is its
   own pot. That is the exact shape the skill itself admits.
2. `hash(gs.rakeConfig) === hash(d.rakeConfig)`. The live rake snapshot carries
   `cashPolicy: { version: 1, scope: 'standard' }`. A declared domain cannot
   carry it, because `featureLiveDomainRefusals` pins the domain's rake config
   to `publishedCashPricing`, which has none.

Either one alone refuses; with both corrected, the predicate admits the state.
The worker then passes `smallPotNearNutRiverValue: false` to `HorseLogic.decide`.
The rake mismatch is not specific to this skill: as written, it refuses every
cash feature authority on every live cash snapshot. Selecting the skill
could not activate it until the predicate matched the live snapshot.

**Fixed underneath this fixture** by
`docs/changelog/2026-11-08-a-declared-feature-domain-admits-the-live-snapshot.md`
(the commit this one is stacked on). The fixture's production test now
asserts the opposite of what it found. Given an admitted near-nut authority,
the original production worker hands `HorseLogic.decide`
`smallPotNearNutRiverValue: true` on all twelve production snapshots per
variant, and the gate's own receipts fire. The release still ships no
selection, so production stays off until a held-out qualification selects the
skill.
