# 2026-11-21: Default-OFF prototype `nashCallVsTightJammerRespect` (held in `OPTION_SWITCH_REFUSED`)

## Summary

- **Option**: `nashCallVsTightJammerRespect` (default OFF, read `=== true`, held in `OPTION_SWITCH_REFUSED` during the 4 PM switch-list hold; no migration or switch rows added).
- **Status**: Evidence NOT MET (prototype only; `HVH48-E` REPLAY-V2 scored `fixed 0; newlyWrong 1; changed 1`).
- **Authority file note**: `docs/horse-option-authority.d/nashCallVsTightJammerRespect.md` is intentionally NOT created on this branch because `server/src/engine/horseDecision/everySwitchListNameIsRegistered.law.test.ts` requires every `<option>.md` in `docs/horse-option-authority.d/` to be registered in `OPTION_SWITCH_NAMES`, whereas `nashCallVsTightJammerRespect` is currently held in `OPTION_SWITCH_REFUSED`.

## Motivation and mechanism

The scripted open-jammer evaluation for `nashCallVsJam` uncovered a `-6.43 +/- 1.50 bb/100` (`z = -4.27`) leak when facing a tight/nut-only `<=20bb` open-jammer (`nlh_tight_jammer_v1`).

When `nashCallVsTightJammerRespect === true` and `opts.mind !== false`, `HorseLogic.ts` inspects the lone open-jammer's evidenced tight-player read without guessing on unknown opponents (`jammerExploit?.presumed !== true`):

- Evaluates `tightOpenerRespect(HorseMind.styleReadUncounted(jammer.user_id))`; when null (unknown or non-tight jammer), `tightRead` stays `null` and exact `nashV2CallProbability` runs unchanged.
- Computes `observedOpenWidth` from Bayesian-shrunk `rfi` (`statRead(counters.rfi, counters.rfiOpp, env.rfi, ['high', 'low']).mean` via `HorseMind.currentExploitCounters(jammer.user_id)` when `counters.rfiOpp >= 8`), falling back to `Math.max(tight.rangeWidth, jammerStyle.signals.vpip.mean)`.
- Computes credibility `confidence = clamp(jammerStyle.participation.confidence, 0, 1) * (1 - jammerStyle.release.fraction)` (shrunk by sample size and gear-shift release).
- In `nashV2TightJammerParams` / `nashV2TightJammerCallProbability`, blends the jammer's equilibrium Nash jam width `nashPct` toward `obsPct` (`targetPct = nashPct - k * (nashPct - obsPct)` when `obsPct < nashPct - 0.5`), maps `targetPct` onto the solved `HorseNashPushFoldV2` caller table (`effectiveBehind` in `[jammerBehind, 9]` with linear interpolation, plus at most a `2x` bounded bubble factor when tighter than `n = 9`), and records receipt `nash_call_vs_tight_jammer_seen` only when `adjusted.tightened` is true.

## Scripted open-jammer league benchmark (`EQUITY_GOVERNOR=off`, `nice -n 19`)

Registered in `NLH_SCRIPTED_TIGHT_JAMMER_RESPECT_CARDS` (`server/src/benchmark/HorseLeague.ts`):

| Card                                         | Pairs (seeds)                                    | Delta (bb/100) |      SE |     z | Divergent pairs | Illegal/Trunc/Corr/Fallback |
| :------------------------------------------- | :----------------------------------------------- | -------------: | ------: | ----: | --------------: | :-------------------------- |
| `nlh_scripted_tight_jammer_15bb_respect`     | 18,000 (3 x 6,000: 20261120, 20261121, 20261122) |          +4.98 | +/-1.20 | +4.15 |           6,471 | 0 / 0 / 0 / 0               |
| `nlh_scripted_nash_open_jammer_12bb_respect` | 4,000 (2 x 2,000: 20261120, 20261121)            |           0.00 |    0.00 |   n/a |               0 | 0 / 0 / 0 / 0               |
| `nlh_scripted_nash_open_jammer_15bb_respect` | 4,000 (2 x 2,000: 20261120, 20261121)            |           0.00 |    0.00 |   n/a |               0 | 0 / 0 / 0 / 0               |

Per-seed results on `nlh_scripted_tight_jammer_15bb_respect` (6,000 pairs each):

- Seed `20261120`: `+3.62 +/- 2.09 bb/100`, `z = +1.74` (2,163 divergent pairs)
- Seed `20261121`: `+5.29 +/- 2.05 bb/100`, `z = +2.58` (2,155 divergent pairs)
- Seed `20261122`: `+6.02 +/- 2.11 bb/100`, `z = +2.85` (2,153 divergent pairs)

## Real-human audited replay (`HU30D` and `HVH48-E`)

Run single-threaded (`nice -n 19`, `EQUITY_GOVERNOR=off`, seeds `1, 7, 42`) against the live 66-row production switch baseline (`prod-switch-20261121T2000Z.json`, `sanitized: {}`, `0` errors) using REPLAY-V2 as-of opponent memory (`AsOfOpponentMemory` over 76,098 retained public `has_human` hands strictly before each decision). With opponent memory OFF (`mind: false`), the option is inert (`0` changed by construction).

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2576; unjudged 0; set HU30D (REPLAY-V2 memory on); scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2576 of 2576
- Replay: fixed 0; newlyWrong 1; changed 1; unchanged 5355; unjudged 0; set HVH48-E (REPLAY-V2 memory on); scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937

Replay diagnostics:

- `HU30D`: 2,576 / 2,576 replayed, 0 errors, 2,532 / 2,576 facing people with `>= 15` hands learned (72,727 hands learned by end); `nash_call_vs_jam` fired 5 times, `nash_call_vs_tight_jammer_seen` fired 0 times.
- `HVH48-E`: 5,356 / 10,937 replayed (`E.job.json` Hold'em MTT subset), 0 errors, 681 / 681 facing-people nodes with `>= 15` hands learned (74,675 hands learned by end); `nash_call_vs_jam` fired 362 times, `nash_call_vs_tight_jammer_seen` fired 5 times.
- Single changed node (`HVH48-E` id `E:8677`, hand `07c3304e-e9ad-40bc-911d-e2f0005fc5a7`, seat 7, preflop, `k=0`, NLH tournament, `nlive=6`, `to_call=2000` at `bb=250`, `facingKind=mixed`, `maxOppHands=4004`): `off=call` -> `on=fold`, recorded `call` judged `OK`, giving `fixed 0 / newlyWrong 1`.
- Scratch replay runner directory on SSD2 was deleted immediately after scoring; no hole cards were written or committed.

## Verification

- `cd server && EQUITY_GOVERNOR=off npx tsc --noEmit`
- Affected vitest law and unit suites pass (`HorseNashPushFoldV2.test.ts`, `HorseDataLedger.test.ts`, `HorseOptionSwitch.test.ts`, `EveryHorseOptionRecordsItsReplay.law.test.ts`, `everyUpgradeHasALiveSwitch.law.test.ts`, `everySwitchListNameIsRegistered.law.test.ts`, `ADefaultOffFlagHasALeagueCard.law.test.ts`).
