# 2026-11-21: Cash Facing-Open Cold-Call Trim (`cashDefenceTrimColdCalls`, default OFF)

## Root Cause

Replay ablation of `v72DefenceByOpener` on `HVH48-D` Hold'em cash (`2,734` real human-vs-Horse decisions) showed that turning `v72DefenceByOpener` off eliminated `69` `CLEAR` and `LIKELY` Auditor-D loose-call mistakes (`38` of them annotated `[vpip floor active]`).

Diagnostic instrumentation established two facts:

1. **`vpipFloorLimpOnly` is clean (zero leak):** Across `49/49` floored bad nodes in `HVH48-D`, Classic VPIP floor was active (`vpipFloor = 20`, `vpipWindowHands = 30`), `vpipFloorLimpOnlyApplies` evaluated `true`, `vpipFloorMul < 1` was `0`, and `vpipFloorCallDown` was `0`.
2. **V85 + V87 double-stacking inside `gtoDefend72` caused `65/69` (`94.2%`) of the loose calls:**
   - V85 (`v85DefenceTargets` in `server/src/engine/HorseGtoDefenceRanges.ts`) flattened V72's IP per-player-behind slope from `-2.0` to `-0.4` pts/player with an `18%` IP floor and applied a multiway caller multiplier (`multiF = 1 + 0.25 * callers`) to `continueBar`.
   - V87 (`v87WidenDefence`) widened `continueBar` a second time on top of V85 with additional `perCaller` multiway bonuses and flatting width, lifting the average continue width on those audited spots from `14.0%` (V72) to `34.4%` (V85) to `43.8%` (V85 + V87).

## Change (Default OFF)

Added default-OFF option `cashDefenceTrimColdCalls` (read strictly as `opts.cashDefenceTrimColdCalls === true` inside `gtoDefend72` in `server/src/engine/HorseLogic.ts`), registered in `HorseDataLedger.ts`, `HorseOptionSwitch.ts` (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`), and `HorseLeague.ts` (`nlh_cash_9max_trim_cold_calls_mirror`), with telemetry receipt `cash_defence_trim_cold_calls_seen`.

### V1 vs V2 Tuning

- **V1 prototype** (`e946b89e5c74`): trimmed all IP and BB early-open flats and zeroed V87 `continueBar` widening. Fixed `54/5` on `HVH48-D`, but pushed 9-max 100bb cash VPIP in `HoldemCashActionProbe` down from `28.4%` to `19.4%` (below Dan's 2026-11-09 `25-30%` 9-max cash action target) and 3-way flops down to `4.9%`.
- **V2 sweet spot** (`4f763ca5b3c4`, current):
  - Keeps V85/V87 3-bet widths (`valueBar`, `bluffProb`), V85 opens, HU BB, single-raised BB/SB, and single-raised BTN (`defenderBehind <= 2`, `callers === 0`) untouched.
  - Restores non-BTN IP per-player-behind discipline (`CASH_TRIM_IP_PER_PLAYER_BEHIND = 1.8` pts/player beyond BTN, floored at `value + bluff + 1`).
  - Removes V85 + V87 multiway `perCaller` double-stacking everywhere and V87 flatting bloat on CO through UTG+1.
  - Leaves tournaments, Omaha, short deck, pot/fixed limit, and off/unset decisions byte-identical.

## Verification

- **Audited real-human replay (`AuditedDecisionReplay.ts`, scorer `5302af2ab3e`, seeds `1, 7, 42`, `vpipFloorLimpOnly: on`):**
  - `HVH48-D` cash (`2,734` of `3,891`): `fixed 36; newlyWrong 3; changed 59; unchanged 2675; unjudged 15` (`12.0:1`, `59/59` `call->fold`, `0` 3-bets touched, `0` resizes, `0` illegal).
  - `HVH48-E` tournaments (`5,356` of `10,937`): `fixed 0; newlyWrong 0; changed 0`.
- **`HoldemCashActionProbe` (`2,500` hands, seed `20261110`, off -> on):**
  - 9-max 100bb: VPIP `28.4 -> 24.7%`, 3-Bet `9.2 -> 9.2%`, fieldFold `74.0 -> 79.9%`, 3-way flops `47.8 -> 30.7%`.
  - 9-max 250bb: VPIP `29.4 -> 25.2%`, 3-Bet `8.9 -> 9.1%`, fieldFold `71.5 -> 78.6%`, 3-way flops `53.4 -> 35.0%`.
  - 6-max 100bb: VPIP `35.3 -> 33.4%`, 3-Bet `10.5 -> 10.5%`, fieldFold `69.6 -> 73.8%`, 3-way flops `33.2 -> 24.4%`.
  - 6-max 250bb: VPIP `36.0 -> 33.9%`, 3-Bet `10.2 -> 10.3%`, fieldFold `68.8 -> 72.6%`, 3-way flops `35.0 -> 28.0%`.
- **3-Seed Live-Switch Paired League (`prod-switch-20261121T2000Z.json`, 66 rows, seeds `20261120, 20261121, 20261122`, 6,000 pairs/seed = 36,000 hands/card, 108,000 total hands, `0` illegal / `0` truncated / `false` inert):**
  - 9-max cash Horse mirror (`productionStyles: true`): `+3.01 +/- 1.23 bb/100` (`z = +2.44`, IVW `+2.94 +/- 1.23`, `3,510` div).
  - 6-max cash vs `HUMAN_CALIBRATED_POPULATION_ID`: `+0.86 +/- 3.08 bb/100` (`z = +0.28`, IVW `+3.96 +/- 2.31`, `249` div).
  - 9-max cash vs `HUMAN_CALIBRATED_POPULATION_ID`: `-3.43 +/- 4.05 bb/100` (`z = -0.85`, IVW `-2.83 +/- 3.89`, `398` div).
- **Authority file:** `docs/horse-option-authority.d/cashDefenceTrimColdCalls.md`.
- **Law test:** `server/src/engine/HorseCashDefenceTrimColdCalls.law.test.ts` (`docs/laws.d/server-src-engine-HorseCashDefenceTrimColdCalls.md`).
