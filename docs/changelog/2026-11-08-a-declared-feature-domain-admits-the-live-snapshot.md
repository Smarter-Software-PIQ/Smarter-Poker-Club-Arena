# A declared feature domain admits the live engine snapshot (2026-11-08)

## What was wrong

`featureDomainMatches` (HorseFeatureAuthority.ts) decides whether a selected,
qualified feature authority may act on a live decision. Two conjuncts refused
every live cash decision. Each one refused on its own:

1. `hash(gs.rakeConfig) === hash(d.rakeConfig)`. Every cash hand's rake config
   is stamped `cashPolicy: { version: 1, scope }` by ServerTableEngineDealing
   (and ServerTableEngineBase, LightningHandHost). The declared domain is pinned
   to `publishedCashPricing`, which carries the numbers alone. The hashes could
   never be equal.
2. `gs.pots.length <= 1`. `computeLivePots` layers a decision facing an
   uncalled bet as two pots: the contested pot, then the bettor's unmatched
   excess. A multiway bet with a call still unmatched is layered the same way.
   Neither is a side pot, and the near-nut river skill admits only that shape.

Every existing test built its state from the published pricing with
`pots: []`, so every test admitted it. Found by the near-nut river fixture
(`draft/near-nut-fixture`). An admitted authority for the exact profile was
still handed `false` by the production worker on every in-domain state.

No selection has shipped (`docs/evidence/feature-activation/selection.json` does
not exist), so nothing live was affected yet. Without this fix, any skill
qualified and selected later would have been refused on every live hand.

## The fix

- The rake label is compared as a label: absent, or exactly
  `{ version: 1, scope: standard | midway | standalone }`. The economics (every
  other field) must equal the declared pricing exactly. An unknown version,
  scope or extra key refuses.
- "No side pot" now means what it says. A side pot exists when a live all-in
  player is shut out of a layer that two or more players still contest. An
  uncalled excess and a pending call are admitted. A layer without
  `eligiblePlayers`, or with none, refuses.
- The qualification harness supplies the same `computeLivePots` layers and
  measured those states with the feature on. The predicate now admits what was
  measured, and nothing wider.

## Proof

- `HorseFeatureDomainLiveSnapshot.test.ts` builds the state from the engine's
  own `calculatePots` and the engine's rake stamp:
  - Five of its eight cases fail on the previous predicate.
  - The side-pot case carries a control.
  - A source pin requires every engine site to stamp a version this predicate
    understands.
- The existing HorseFeatureAuthority and HorseDormantCandidateReadiness tests
  pass unchanged, including the refusal of malformed layers.
