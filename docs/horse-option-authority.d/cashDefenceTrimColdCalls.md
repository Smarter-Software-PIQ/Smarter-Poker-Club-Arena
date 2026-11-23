# cashDefenceTrimColdCalls: authority for the live switch

**State: default OFF in source (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`, switchable `off / shadow / on_shadow / on`); Evidence MET (2026-11-21).** Hold'em Strategy lane option (2026-11-21), read once as `opts.cashDefenceTrimColdCalls === true` inside `gtoDefend72` (`server/src/engine/HorseLogic.ts`), registered under Dan's 2026-11-19 18:42 and 2026-11-20 15:01 America/Chicago investigation and codebase-ownership directives. Mechanism, scope, receipt (`cash_defence_trim_cold_calls_seen`), and 5-case law test (`HorseCashDefenceTrimColdCalls.law.test.ts`) MET; real-human audited decision replay on `HVH48-D` Hold'em cash (`2,734` replayed of `3,891` decisions: `fixed 36`, `newlyWrong 3`, `12.0:1`, `changed 59` all `call->fold`, `0` 3-bets touched, `0` resizes, `0` illegal) and `HVH48-E` Hold'em tournaments (`5,356` replayed of `10,937`: `changed 0`, `fixed 0`, `newlyWrong 0`) MET; `HoldemCashActionProbe` confirms 9-max cash VPIP stays on Dan's 2026-11-09 `25-30%` action target (`24.7%` at 100bb, `25.2%` at 250bb, 3-bet `9.2% / 9.1%`, 3-way flops `30.7% / 35.0%`); 3-seed live-switch paired league (`108,000` hands across 3 cards against the 66-row production switch snapshot `prod-switch-20261121T2000Z.json`) MET (`+3.01 +/- 1.23 bb/100`, `z = +2.44` on 9-max cash Horse mirror; `+0.86 +/- 3.08 bb/100` on 6-max cash human field; `-3.43 +/- 4.05 bb/100`, `z = -0.85` on 9-max cash human field; `0` illegal, `0` truncated, `0` inert across all 9 runs).

## Owner authority

Created under the Antigravity Coordinator's ownership of the Hold'em Strategy lane following Dan's 2026-11-19 18:42 America/Chicago order to investigate every Horse decision played against humans over the past 48 hours and Dan's 2026-11-20 15:01 America/Chicago delegation (`antigravity-coordinator-01UxDLnH/OWNER-TEXT-20261120-ANTIGRAVITY-COORDINATOR-VERBATIM.md`, sha256 `90351f60b2dbcd6f7ce541d137fe4139c988893abf074e49de6031e5e2d9013e`). Like `holdemTournamentAllInCallIsPriced`, it ships default OFF, switchable `off / shadow / on_shadow / on`, and enters production only via its recorded authority evidence and follow-up switch-list migration.

## The defect it answers

Full-fleet ablation of `v72DefenceByOpener` on `HVH48-D` Hold'em cash (`2,734` real human-vs-Horse decisions) showed that turning `v72DefenceByOpener` off eliminated `69` `CLEAR` and `LIKELY` Auditor-D loose-call mistakes, including `38` nodes tagged `[vpip floor active]`. Root-cause instrumentation proved:

1. `vpipFloorLimpOnly` (`on` in production) has zero leak into `v72DefenceByOpener`: on `49/49` floored bad nodes in `HVH48-D`, Classic VPIP floor was active (`vpipFloor = 20`, `vpipWindowHands = 30`), `vpipFloorLimpOnlyApplies` evaluated `true`, `vpipFloorMul < 1` was `0`, and `vpipFloorCallDown` was `0`.
2. `65/69` (`94.2%`) of the cash loose calls eliminated by turning `v72DefenceByOpener` off came from double-stacked flatting width inside `gtoDefend72` (`HorseGtoDefenceRanges.ts` + `HorsePreflop.ts`):
   - V85 (`v85DefenceTargets`) replaced V72's per-player-behind IP cold-call slope (`-2.0` pts/player) with `-0.4` pts/player and an `18%` IP floor, AND added a multiway caller factor (`multiF = 1 + 0.25 * callers`) on `continueBar`.
   - V87 (`v87WidenDefence`) then widened `continueBar` a SECOND time via `perCaller` multiway bonuses on top of V85's already-widened `continueBar` (`14.0%` average V72 continue width -> `34.4%` after V85 -> `43.8%` after V85 + V87 on the audited bad calls).

## What it does

Code: `server/src/engine/HorseGtoDefenceRanges.ts` (`CASH_TRIM_IP_PER_PLAYER_BEHIND = 1.8`, `DefenceSpot.trimColdCalls`, `V87DefenceWidenSpot.defenderBehind`, `V87DefenceWidenSpot.trimContinueBar`), `server/src/engine/HorsePreflop.ts` (forwards `defenderBehind` and `trimColdCalls` on `PreflopCtx['gtoDefend']` into `v87WidenDefence` on cash tables only), `server/src/engine/HorseLogic.ts` (`const trimColdCalls = defend85 && opts.cashDefenceTrimColdCalls === true;` in `gtoDefend72`).

On no-limit hold'em cash tables facing a single open inside `gtoDefend72` (`defend85 && opts.cashDefenceTrimColdCalls === true`):

- Leaves V85/V87 3-bet widths (`valueBar`, `bluffProb`), V85 opens, heads-up BB defends, single-raised 3+ handed BB and SB defends, and single-raised BTN (`defenderBehind <= 2`, `callers === 0`) defends untouched.
- For non-BTN IP cold-calls (`defender === 'ip'`, `extra = defenderBehind - 2 >= 1`), replaces V85's `-0.4` pts/player slope and `18%` floor with `Math.max(0, baseIp - 1.8 * extra)`, floored at `value + bluff + 1` so flatting never collides with the 3-bet bar.
- In `v87WidenDefence`, when `trimContinueBar === true`, keeps V87 3-bet widening everywhere and keeps V87 single-raised (`callers === 0`) base widening on BB, SB, and BTN (`defenderBehind <= 2`), while removing V87's double-stacked multiway `perCaller` widening everywhere and V87's flatting bloat on CO through UTG+1.
- Tournaments, Omaha, short deck, pot/fixed limit, unopened pots, and facing 3-bets are completely untouched.
- When unset or `false`: byte-identical to current production (`off`).

## Receipts

`cash_defence_trim_cold_calls_seen` (`server/src/engine/HorseDataLedger.ts`, tag `Hold'em Strategy`): fired once per live decision (`telemetryOn(opts)`) inside `gtoDefend72` only when `trimColdCalls && (heroBehind > 2 || callers > 0)` (the exact spots where `cashDefenceTrimColdCalls` trims `continueBar`).

## Tests

- `server/src/engine/HorseCashDefenceTrimColdCalls.law.test.ts` (5 cases; `docs/laws.d/server-src-engine-HorseCashDefenceTrimColdCalls.md`): unset and `false` are byte-identical across cash and tournament spots; 9-max EP/MP cold-calls tighten with `CASH_TRIM_IP_PER_PLAYER_BEHIND = 1.8`; V85 + V87 multiway double-stacking is removed while single-raised BB/SB/BTN bases stay intact; V85/V87 3-bet thresholds, V85 opens, and tournament decisions are unchanged; `cash_defence_trim_cold_calls_seen` fires only on trimmed cash spots and never when off, on single-raised BTN/BB/SB, or in tournaments.
- `server/src/engine/HorseCashAction.law.test.ts` and `server/src/engine/HorseDefenceByOpener.test.ts`: regression checks pass without changes.

## Evidence rows

Rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`.

- Mechanism, scope, visibility (receipt), tests: MET (`docs/changelog/2026-11-21-cash-defence-trim-cold-calls.md` and `HorseCashDefenceTrimColdCalls.law.test.ts`).
- Option unset or false changes nothing: MET (`HorseCashDefenceTrimColdCalls.law.test.ts` case 1).
- Cash action probe (`HoldemCashActionProbe`, 2,500 hands per table, seed `20261110`, `EQUITY_GOVERNOR=off`, `off -> on`):

  | table       | VPIP %       | PFR %        | 3-Bet %      | fieldFold %  | sbFold %     | bbFold %     | calledPct %  | 3-way flop % | 4-way flop % |
  | ----------- | ------------ | ------------ | ------------ | ------------ | ------------ | ------------ | ------------ | ------------ | ------------ |
  | 9-max 100bb | 28.4 -> 24.7 | 15.8 -> 15.9 | 9.2 -> 9.2   | 74.0 -> 79.9 | 77.3 -> 78.7 | 38.6 -> 40.2 | 83.0 -> 78.2 | 47.8 -> 30.7 | 22.1 -> 7.6  |
  | 9-max 250bb | 29.4 -> 25.2 | 15.7 -> 15.8 | 8.9 -> 9.1   | 71.5 -> 78.6 | 75.5 -> 76.2 | 36.3 -> 37.7 | 85.6 -> 80.1 | 53.4 -> 35.0 | 27.2 -> 8.8  |
  | 6-max 100bb | 35.3 -> 33.4 | 21.0 -> 21.0 | 10.5 -> 10.5 | 69.6 -> 73.8 | 77.2 -> 76.9 | 32.2 -> 32.5 | 78.5 -> 76.6 | 33.2 -> 24.4 | 9.5 -> 4.0   |
  | 6-max 250bb | 36.0 -> 33.9 | 20.9 -> 20.8 | 10.2 -> 10.3 | 68.8 -> 72.6 | 76.9 -> 76.4 | 29.4 -> 29.2 | 80.7 -> 79.0 | 35.0 -> 28.0 | 11.6 -> 4.9  |

- Value (3-seed paired league on live 66-row production switch snapshot `prod-switch-20261121T2000Z.json`: 50 on / 16 off; 6,000 pairs/seed x 3 seeds = 18,000 pairs / 36,000 hands per card, 108,000 hands total, commit `4f763ca5b3c4`, `EQUITY_GOVERNOR=off`, `moodClock: 'deal_seed'`, `0` illegal, `0` truncated, `false` inert across all 9 runs):

  | card (100bb cash)                             | seed 20261120 (div)    | seed 20261121 (div)    | seed 20261122 (div)    | pooled equal-wt (z)        | pooled IVW (z)             | total div | illegal, trunc, inert |
  | --------------------------------------------- | ---------------------- | ---------------------- | ---------------------- | -------------------------- | -------------------------- | --------- | --------------------- |
  | 9-max Horse mirror (`productionStyles: true`) | +6.81 +/- 2.17 (1,180) | -0.04 +/- 2.11 (1,162) | +2.25 +/- 2.13 (1,168) | +3.01 +/- 1.23 (z = +2.44) | +2.94 +/- 1.23 (z = +2.38) | 3,510     | 0, 0, false           |
  | 6-max vs `HUMAN_CALIBRATED_POPULATION_ID`     | +4.11 +/- 3.30 (84)    | +6.12 +/- 3.53 (84)    | -7.64 +/- 7.88 (81)    | +0.86 +/- 3.08 (z = +0.28) | +3.96 +/- 2.31 (z = +1.72) | 249       | 0, 0, false           |
  | 9-max vs `HUMAN_CALIBRATED_POPULATION_ID`     | +0.99 +/- 7.41 (142)   | -1.23 +/- 5.66 (128)   | -10.04 +/- 7.77 (128)  | -3.43 +/- 4.05 (z = -0.85) | -2.83 +/- 3.89 (z = -0.73) | 398       | 0, 0, false           |

- Input fidelity, continuation, reach on recorded real human-vs-Horse hands: MET (`HVH48-D` Hold'em cash and `HVH48-E` Hold'em tournaments, seeds `1, 7, 42`, `vpipFloorLimpOnly: on`, `switch-20261120T2115Z-plus3.json`, committed scorer `5302af2ab3e`):
  - Unedited `HVH48-D` scorer line (`--placed --line on`): `placed (verdict-only; 3891 audited decisions, 372 judged bad; joined by node: 2734 replayed, 1157 not replayed, base reproduces the recorded action on 2214): arm on changed 59 (0 more aggressive, 59 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 36, newly wrong 3, still wrong 5, ok to ok 0, unjudged 15; judged bad left unchanged 185`
  - Every single change (`59/59`) was `call->fold` (`0` 3-bets touched, `0` resizes, `41` bad calls eliminated, `36` fixed vs `3` newly wrong = `12.0:1`).
  - `HVH48-E` tournaments (`5,356` of `10,937` replayed): `0` changed, `0` fixed, `0` newly wrong.

League card (`server/src/benchmark/HorseLeague.ts`): `nlh_cash_9max_trim_cold_calls_mirror` (9-max 100bb cash, `productionStyles: true`, `moodClock: 'deal_seed'`, 6,000 pairs, arm A `cashDefenceTrimColdCalls: true`, arm B live default).

## Activation prerequisites

1. Serving engine at `https://engine.smarter.poker/health` includes `cashDefenceTrimColdCalls` in `HorseOptionSwitch.ts` and `HorseLogic.ts`.
2. Production database has the follow-up switch-list migration carrying `cashDefenceTrimColdCalls` installed (`fn_ca_horse_option_switch_states('cashDefenceTrimColdCalls')` includes `'on'`).
3. Evidence row recorded via `fn_ca_horse_option_switch_record_evidence` and option switched via `fn_ca_horse_option_switch_set` citing this file and its sha256 (`authority: cashDefenceTrimColdCalls docs/horse-option-authority.d/cashDefenceTrimColdCalls.md sha256 <64 hex>`).

## Rollback

`fn_ca_horse_option_switch_set('cashDefenceTrimColdCalls', 'off', ...)` restores the base brain byte-for-byte within ~30s.

## Limits

- The 9-max human-calibrated league card has low divergence (`398` divergent pairs in `18,000` pairs) and high per-hand variance (`SE = 4.05 bb/100`), so its `-3.43 +/- 4.05 bb/100` (`z = -0.85`) estimate is statistical noise well within 1 SE; the primary real-human signal is the `36 fixed / 3 newlyWrong` (`12.0:1`) audited replay on `HVH48-D` alongside the `+3.01 +/- 1.23 bb/100` (`z = +2.44`) 9-max Horse mirror win.
- `cashDefenceTrimColdCalls` trims only flatting width (`continueBar`) on cash facing-open spots with `defenderBehind > 2` or `callers > 0`; it does not modify 3-bet frequencies, V85 opens, single-raised HU/BB/SB/BTN defends, or tournament play.

## Replay

Machine-read (`README.md`, "The Replay row"); run rows written by the committed scorer (`5302af2ab3e`) and copied unedited.

- Replay: fixed 36; newlyWrong 3; changed 59; unchanged 2675; unjudged 15; set HVH48-D Hold'em cash vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2734 of 3891
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 5356; unjudged 0; set HVH48-E Hold'em tournaments vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937
