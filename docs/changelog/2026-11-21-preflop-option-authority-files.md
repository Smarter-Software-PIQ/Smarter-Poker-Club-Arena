# 2026-11-21: authority files for four preflop options

Four registered Horse options had no file in docs/horse-option-authority.d/: `huBbDefendsToPrice`, `huSmallBlindStealsVsTightBigBlind`, `nashCallVsJam` and `v72DefenceByOpener`. Each now has one, in the README format, recording only what the repository and the Antigravity Coordinator desk already record. Nothing was run to write them.

| option | registry state | file status |
| ------ | -------------- | ----------- |
| huBbDefendsToPrice | off-only, owner preflop range hold (not lifted; the 2026-11-20 lift was huBbDefendsUnreadToPrice alone) | Evidence NOT MET: HU-NLH-001c +0.53 +/- 0.46 bb/100 not significant; Replay NOT RUN |
| huSmallBlindStealsVsTightBigBlind | off-only by the steal pattern (owner ruling 2026-11-14 21:30 Chicago) | Evidence NOT MET: development +13.75 +/- 0.98 at 40bb, held by the steal ruling; review law case missing; Replay NOT RUN |
| nashCallVsJam | default ON in source, on/off/shadow | Evidence NOT MET for the replay bar: mirror league only; Replay NOT RUN |
| v72DefenceByOpener | default ON in source, on/off/shadow | Evidence NOT MET for the replay bar: mirror positive, human field not significant; Replay NOT RUN |

Every NOT RUN row names the corrected replay history of #11556 (no forced posts in preflop actionHistory), which listed all four options among those whose replay evidence must be re-run.

No source, switch row or migration changes. Laws: server/src/engine/EveryHorseOptionRecordsItsReplay.law.test.ts and server/src/engine/horseDecision/everySwitchListNameIsRegistered.law.test.ts.
