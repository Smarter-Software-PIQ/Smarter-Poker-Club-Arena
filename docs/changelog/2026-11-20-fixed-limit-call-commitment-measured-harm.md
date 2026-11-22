# fixedLimitCallIsNotACommitment is off-only: measured harm (2026-11-20)

Antigravity Coordinator ruling (session 01UxDLnH). The fixed-limit hold'em option `fixedLimitCallIsNotACommitment` moves to `OPTION_SWITCH_OFF_ONLY` with status `harm`.

## Evidence

The scripted fixed-limit league field (PR #11565, `docs/horse-league-fixed-limit.md`) was measured after that PR's league memory fix. `HorseMind.observe` now receives the betting structure, as production's `workerRuntime` does. Before the fix every fixed-limit bet was counted as a probe, which inflated the earlier reading to +124 bb/100.

| Card | Seeds | Pairs per seed | bb/100 (SE) |
|---|---|---|---|
| flh_call_is_not_a_commitment_vs_maniac | 20261120, 20261121 | 12,000 | -24.68 (5.45), z -4.53; per seed -28.02 +/- 7.30 and -21.35 +/- 8.10 |
| flh_call_is_not_a_commitment_vs_tight_value (harm control) | 20261120, 20261121 | 50,000 | 0.00 (0.02) |

No measured cell is positive. Earlier readings are a Horse mirror that almost never moves the option (refused as unmeasurable), and AB-EVALUATION-2 found no value at flo8, where the option is already out of scope.

## What changes

- `server/src/engine/HorseOptionSwitch.ts`: an `OPTION_SWITCH_OFF_ONLY` entry with status `harm`.
- `supabase/migrations/20261121024624_horse_option_switch_fixed_limit_call_commitment_harm.sql`: the regenerated switch lists, made with `--follow-up` after `20261121005533`, with 56 off-only options.
- `everyUpgradeHasALiveSwitch.law.test.ts`: the option leaves the "inconclusive or not yet evaluated" list and is pinned as `harm` with this source.

## What does not change

- Production holds no switch row for any `fixedLimit*` option (read 2026-11-21 02:2xZ). The option was default OFF and stays OFF.
- Live play is unchanged.
- The migration only narrows the allowed states, so `on` is refused for this option.

Lifting the lock needs a new evaluation with a positive cell and no harm cell, then the entry is removed in source and the lists regenerated.
