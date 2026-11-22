# 2026-11-21: plo6FacingBetIsPriced declared evaluation eval-40aba893fbc9 VALID FAIL (F6 z = -5.84)

## Summary

Finalized the declared PLO6 human-field (`F6`) and Horse-mirror (`M6`) evaluation `eval-40aba893fbc9` (`DECLARATION-PLO6-FACING-BET-IS-PRICED.md`, sha256 `95ca359fb420389e6cc33f79ce52ff6237fd45eff439daa45cebcb0880a048e2`, clean tree `40aba893fbc9`) by completing the remaining 24 of 100 `M6` sessions (`i = 38..49`, `88..99`) and writing `RESULT.json` (`valid: true`, `verdict: "FAIL"`).

- `F6` (`400/400` sessions, `200,000` pairs / `400,000` hands vs `HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID`): `A - B = -15.510 +/- 2.655 bb/100` (`z = -5.84`), `4,173` divergent pairs, `256/400` sessions negative, `0` illegal/truncated/corrected/fallbacks.
- `M6` (`100/100` sessions, `50,000` pairs / `100,000` hands, `productionStyles`): `A - B = +1.483 +/- 1.319 bb/100` (`z = +1.12`), `7,237` divergent pairs, `0` illegal/truncated/corrected/fallbacks.

## Root causes recorded

1. `plo6ValueShareAtSameStrength` (`server/src/engine/HorsePlo6ValueShare.ts:139-162`) maps 4-card hand strength onto 15-pair six-card holdings, inflating `valueShare` to `0.55-0.89` on flops and `0.42-0.58` on rivers and defeating E7's `plo6RiverFoldGuardStands`.
2. Low-SPR 3-bet/4-bet all-in jams (`potFrac = 0.31-0.41`) fall into `under40`/`mid` stab buckets while `spot.final = true` bypasses E6's realization discount and two-street barrel tree.
3. Request-pure PLO4/PLO5 bluff priors (`bettorRead = null`) plus strictly one-way `fold -> call` flop/turn overrides disable `pairedBoardFold` and `plo6RiverNutDiscipline` against value-heavy bettors (consistent with the `-334.4 bb` HVH48 true-card river `fold -> call` bleed vs OFF).

## Action

Updated `docs/horse-option-authority.d/plo6FacingBetIsPriced.md` with the valid FAIL result and root causes (docs only; no engine, migration, switch-list, or release-control paths changed). `plo6FacingBetIsPriced` stays OFF and is queued for `OPTION_SWITCH_OFF_ONLY` in Turn 4 of the post-seal switch-list sequence.
