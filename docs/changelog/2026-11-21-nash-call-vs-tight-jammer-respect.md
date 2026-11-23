# 2026-11-21: Default-OFF prototype `nashCallVsTightJammerRespect` (held in `OPTION_SWITCH_REFUSED`)

## Summary

- **Option**: `nashCallVsTightJammerRespect` (default OFF, read `=== true`, held in `OPTION_SWITCH_REFUSED` during the 4 PM switch-list hold; no migration or switch rows added).
- **Status**: Default-OFF prototype held in `OPTION_SWITCH_REFUSED` pending the 4 PM switch-list hold lift.
- **Authority file note**: `docs/horse-option-authority.d/nashCallVsTightJammerRespect.md` is intentionally NOT created on this branch because `server/src/engine/horseDecision/everySwitchListNameIsRegistered.law.test.ts` requires every `<option>.md` in `docs/horse-option-authority.d/` to be registered in `OPTION_SWITCH_NAMES`, whereas `nashCallVsTightJammerRespect` is currently held in `OPTION_SWITCH_REFUSED`.

## Motivation and mechanism

The scripted open-jammer evaluation for `nashCallVsJam` uncovered a `-6.43 +/- 1.50 bb/100` (`z = -4.27`) leak when facing a tight/nut-only `<=20bb` open-jammer (`nlh_tight_jammer_v1`).

When `nashCallVsTightJammerRespect === true` and `opts.mind !== false`, `HorseLogic.ts` inspects the lone open-jammer's evidenced tight-player read without guessing on unknown opponents (`jammerExploit?.presumed !== true`):

- Evaluates `tightOpenerRespect(HorseMind.styleReadUncounted(jammer.user_id))`; when null (unknown or non-tight jammer), `tightRead` stays `null` and exact `nashV2CallProbability` runs unchanged.
- Computes `observedOpenWidth` from Bayesian-shrunk `rfi` (`statRead(counters.rfi, counters.rfiOpp, env.rfi, ['high', 'low']).mean` via `HorseMind.currentExploitCounters(jammer.user_id)` when `counters.rfiOpp >= 8`), falling back to `Math.max(tight.rangeWidth, jammerStyle.signals.vpip.mean)`.
- Computes credibility `confidence = clamp(jammerStyle.participation.confidence, 0, 1) * (1 - jammerStyle.release.fraction)` (shrunk by sample size and gear-shift release).
- **Short-stack desperation stand-down (poker physics)**: `HorseMind` aggregates VPIP/PFR/RFI across all stack depths (dominated by 20-100bb deep play), which systematically underestimates a tight player's short-stack push/fold jam width when dead money per orbit is high. In `nashV2TightJammerParams`, tightening stands down to exact Nash whenever `depthBB <= 10` OR Harrington `M = depthBB / (1.5 + max(0, anteBB)) <= 4` (orbit cost `>= 25%` of effective stack), ramping linearly via `stackWeight = min(clamp((depthBB - 10) / 3, 0, 1), clamp((M - 4) / 1.5, 0, 1))` to full weight at voluntary open-jam depths (`depthBB >= 13` and `M >= 5.5`).
- Blends the jammer's equilibrium Nash jam width `nashPct` toward `obsPct` (`targetPct = nashPct - k * (nashPct - obsPct)` with `k = clamp(confidence, 0, 1) * stackWeight` when `obsPct < nashPct - 0.5`), maps `targetPct` onto the solved `HorseNashPushFoldV2` caller table (`effectiveBehind` in `[jammerBehind, 9]` with linear interpolation, plus at most a `2x` bounded bubble factor when tighter than `n = 9`), and records receipt `nash_call_vs_tight_jammer_seen` only when `adjusted.tightened` is true.

## Scripted open-jammer league benchmark (`EQUITY_GOVERNOR=off`, `nice -n 19`)

Registered in `NLH_SCRIPTED_TIGHT_JAMMER_RESPECT_CARDS` (`server/src/benchmark/HorseLeague.ts`):

| Card                                                  | Pairs (seeds)                                    | Delta (bb/100) |      SE |     z | Divergent pairs | Illegal/Trunc/Corr/Fallback |
| :---------------------------------------------------- | :----------------------------------------------- | -------------: | ------: | ----: | --------------: | :-------------------------- |
| `nlh_nash_call_vs_tight_jammer_respect_vs_tight_15bb` | 18,000 (3 x 6,000: 20261120, 20261121, 20261122) |          +4.98 | +/-1.20 | +4.15 |             222 | 0 / 0 / 0 / 0               |
| `nlh_nash_call_vs_tight_jammer_respect_vs_nash_12bb`  | 4,000 (2 x 2,000: 20261120, 20261121)            |           0.00 |    0.00 |   n/a |               0 | 0 / 0 / 0 / 0               |
| `nlh_nash_call_vs_tight_jammer_respect_vs_nash_15bb`  | 4,000 (2 x 2,000: 20261120, 20261121)            |           0.00 |    0.00 |   n/a |               0 | 0 / 0 / 0 / 0               |

Per-seed results on `nlh_nash_call_vs_tight_jammer_respect_vs_tight_15bb` (6,000 pairs each):

- Seed `20261120`: `+5.18 +/- 1.98 bb/100`, `z = +2.62` (65 divergent pairs)
- Seed `20261121`: `+4.08 +/- 2.05 bb/100`, `z = +1.99` (71 divergent pairs)
- Seed `20261122`: `+5.67 +/- 2.20 bb/100`, `z = +2.58` (86 divergent pairs)

## Real-human audited replay (`HU30D` and `HVH48-E`)

Run single-threaded (`nice -n 19`, `EQUITY_GOVERNOR=off`, seeds `1, 7, 42`) against the live 66-row production switch baseline (`prod-switch-20261121T2000Z.json`, `sanitized: {}`, `0` errors) using REPLAY-V2 as-of opponent memory (`AsOfOpponentMemory` over 76,098 retained public `has_human` hands strictly before each decision). With opponent memory OFF (`mind: false`), the option is inert (`0` changed by construction).

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2576; unjudged 0; set HU30D (REPLAY-V2 memory on); scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2576 of 2576
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 5356; unjudged 0; set HVH48-E (REPLAY-V2 memory on); scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937

Replay diagnostics:

- `HU30D`: 2,576 / 2,576 replayed, 0 errors; `nash_call_vs_jam` fired 5 times, `nash_call_vs_tight_jammer_seen` fired 0 times (`0 fixed / 0 newlyWrong / 0 changed`).
- `HVH48-E`: 5,356 / 10,937 replayed (`E.job.json` Hold'em MTT subset), 0 errors; `nash_call_vs_jam` fired 362 times, `nash_call_vs_tight_jammer_seen` fired 2 times at voluntary open-jam depth (`13.69bb`, `M = 5.48`), `0 fixed / 0 newlyWrong / 0 changed`.
- Prior to adding the short-stack desperation stand-down, `HVH48-E` had 1 false-positive fold (`E:8677`, `depthBB = 8.0`, `anteBB = 1.0`, `M = 3.2`) caused by feeding a full-ring all-depth RFI (`10.74%`) into an 8bb big-blind-ante red-zone push/fold spot. Standing down below `depthBB <= 10` / `M <= 4` eliminated that false positive cleanly while preserving 100% of the `+4.98 +/- 1.20 bb/100` (`z = +4.15`) 15bb tight-jammer win.
- Scratch replay runner directories on SSD2 were deleted immediately after scoring; no hole cards were written or committed.

## Verification

- `cd server && EQUITY_GOVERNOR=off npx tsc --noEmit`
- Affected vitest law and unit suites pass (`HorseNashPushFoldV2.test.ts`, `HorseDataLedger.test.ts`, `HorseOptionSwitch.test.ts`, `EveryHorseOptionRecordsItsReplay.law.test.ts`, `everyUpgradeHasALiveSwitch.law.test.ts`, `everySwitchListNameIsRegistered.law.test.ts`, `ADefaultOffFlagHasALeagueCard.law.test.ts`).
