# 2026-11-21: plo6FacingBetIsPriced is locked off-only as measured harm

Antigravity Coordinator ruling of 2026-11-21 on the declared human-calibrated PLO6 field evaluation (`DECLARATION-PLO6-FACING-BET-IS-PRICED.md` sha256 `95ca359f`, `eval-40aba893fbc9/RESULT.json`). Templates: `#11567` (`fixedLimitCallIsNotACommitment`) and `#11659` (`holdemCommittedNoPairIsPriced` / `holdemDangerBoardEquityIsPriced`).

## What changed

- `server/src/engine/HorseOptionSwitch.ts`: added `plo6FacingBetIsPriced` to `OPTION_SWITCH_OFF_ONLY` with status `harm` and to `OPTION_SWITCH_RELEASE_DEFAULT_OFF` (it is read `=== true`, default off in source).
  - Declared `eval-40aba893fbc9` (2026-11-21) returned VALID FAIL: F6 human-calibrated PLO6 field 400/400 sessions (200,000 pairs / 400,000 hands) `-15.510 +/- 2.655 bb/100` (`z = -5.84 < -2.0`, `256/400` sessions negative); M6 Horse mirror 100/100 `+1.483 +/- 1.319 bb/100` (`z = +1.12`); `0` illegal/truncated/corrected/fallbacks; HVH48 true-card river `fold -> call` `-334.4 bb` vs OFF.
- `server/src/engine/horseDecision/everyUpgradeHasALiveSwitch.law.test.ts`: pinned `plo6FacingBetIsPriced` as `harm`, with its declaration source prefix and `z = -5.84` in the reason.
- `server/src/benchmark/AuditedDecisionReplay.test.ts`: switched the synthetic `--plo6` replay CLI test option from hardcoded `'plo6FacingBetIsPriced'` to `OPTION_SWITCH_ON_OFF_NAMES[0]` (matching the test file's existing `ON_A` pattern) because `plo6FacingBetIsPriced` is now off-only.
- `docs/horse-option-authority.d/plo6FacingBetIsPriced.md`: status line updated to record `off-only (measured harm)` (still `Evidence NOT MET`; no switch row proposed; all three `- Replay:` rows untouched).
- `supabase/migrations/20261122181616_horse_option_switch_turn5_antigravity_train.sql`: generated with `gen-horse-option-switch-sql.ts --follow-up`; `-- registry:follows: 20261122131322_horse_option_switch_turn4b_plo_replacements_and_locks` (3-item Antigravity Turn 5 switch-list train over Turn 4B `#11747`, carrying the `plo6FacingBetIsPriced` off-only harm lock, `cashDefenceTrimColdCalls` default-OFF switch registration, and `plo6FacingBetIsPricedV2` default-OFF switch registration; `horseRunItTwiceIsPriced` excluded per Rule 11). Semantic diff for `plo6FacingBetIsPriced`: leaves `on-shadow-options` and joins `off-only-options`. `scripts/ci/test-horse-option-switch-evidence-postgres.sh` lists regenerated with it.

## What did not change

No switch row was written (only the SWITCH lane writes rows; `plo6FacingBetIsPriced` was OFF with no row). The option code stays in source, read `=== true`, release default off. Re-evaluating the option after a future root-cause repair needs the lock lifted first in source and a new list migration.

## Timing

Rebased onto `origin/main` (`1ad80fe1a32b`, carrying Turn 4B `#11747` `20261122131322_horse_option_switch_turn4b_plo_replacements_and_locks.sql`) for Turn 5.
