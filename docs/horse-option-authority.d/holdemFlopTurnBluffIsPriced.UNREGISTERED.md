# holdemFlopTurnBluffIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-22, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `holdemFlopTurnBluffIsPriced.UNREGISTERED.md` until the registration change renames it to `holdemFlopTurnBluffIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812 (stacked on the HORSE DECISIONS combo; open, not merged, read 2026-11-22). Evidence NOT MET: the pre-registered offline league grade `flop-turn-bluff-priced` is PASS (PRIMARY 6-max cash `+1.290 +/- 0.965 bb/100`, `z = +1.336`, equal-weight pooled over 4 seeds, a not-worse bar, not a measured gain; worst guarded cell `-6.428 +/- 5.170`, `z = -1.243`; CONTROL inert; `0` illegal, `0` truncated, `0` brain fallbacks), but Criterion 5 of the same criteria, the replay on real audited decisions (HVH48 Auditor D), is not run: the scorer refuses an option set that names an option the registry refuses, so it can run only after the switch-list migration. Switch-on waits for that replay row (`newlyWrong <= fixed`) under `## Replay`.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the Horse Switch lane on 2026-11-22 (graded HEAD `e1cc857d95b6da99af6d018181618a42a8af8dac`, merged into the bundle by `e59e2ca7a816`).

## The blanket rule it replaces

`flopTurnBluffBaseline` (A3, REVIEW-HOLDEM-OFFLIST-20261121.md section 5). On unopened or checked-to single-board two-card no-limit hold'em flops and turns, with a bluff or semi-bluff candidate (`strongDraw`, `pairDraw`, `weakDraw`, `backdoor`, `overcards`, `blocker`) on a coherent line (`cbet`, `barrel`, `delayed`, `probe`, `stab`), the baseline draws a random bet fraction (`flopTurnBluffSize(..., u: fastRandom())`), computes a fixed-formula frequency (`flopTurnBluffProbability`) and bets on `fastRandom() < pFtUse`: it still bluffs 25% to 55% into confirmed calling stations and fires random-size bluffs and barrels without pricing fold equity against the check.

## What it does

Code: `server/src/engine/HorseHoldemFlopTurnBluffIsPriced.ts`, read in `HorseLogic.decidePostflop` at the flop/turn bluff block (`holdemFlopTurnBluffIsPricedApplies`) and at the V87 range c-bet entry, where the priced option admits the spot whatever `flopTurnBluffBaseline` says. Independent of `flopTurnBluffBaseline`, with no `fastRandom` or `Math.random`:

- Every legal size is priced: `0.33`, `0.55`, `0.75` and `1.0` pot, capped by the effective stack (all in).
- His fold probability interpolates the measured NLH tables in `holdemEmpiricalPriors.ts` (`HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET`, n = 10,707; `HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET`, n = 6,807; flop texture and low-SPR multipliers) with Empirical-Bayes shrinkage (`estimateHoldemFlopCbetFold`, `estimateHoldemTurnBetFold`) over his HUD packet, `ExploitCounters` and HorseMind reads; selection-bias surplus retention, line and board-story conditioning, calling-station discipline and a multiway compounding discount (2 and 3 live opponents).
- Equity when called is discounted by his calling-range truncation per hand class, multiway strength and later-street pressure; the check realizes `EV(check) = realizedCheckEquity x pot x (1 - d)`.
- `EV(bet_s) = foldProb x pot x (1 - d) + (1 - foldProb) x (eqWhenCalled x (pot + 2 bet) x (1 - d) - bet)`; it bets the highest-EV legal size only when `EV(bestBet) > EV(check) + riskMargin` (the margin grows with the size and with tournament ICM risk); otherwise it checks.

Scope: single-board two-card NLH unopened or checked-to flop and turn spots owned by `flopTurnBluffBaseline` only. Not the river (`holdemRiverBluffIsPriced`, `v87RiverBlockBetTrapIsPriced`), not facing-bet semi-bluff raises (`v78`, `H4`, `v36`, `v86`); no Omaha (PLO4/5/6, hi-lo), short deck, fixed limit, multi-board, bomb pot or All-In-Or-Fold. No import from `opponentHud/`. Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## Receipts

`holdem_flop_turn_bluff_priced_bet_seen`, `holdem_flop_turn_bluff_priced_semibluff_seen`, `holdem_flop_turn_bluff_priced_air_seen`, `holdem_flop_turn_bluff_priced_check_seen`, `holdem_flop_turn_bluff_priced_station_check_seen`, `holdem_flop_turn_bluff_priced_illegal_seen` (registered in `HorseDataLedger.ts`).

## Tests

`server/src/engine/AHoldemFlopTurnBluffIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AHoldemFlopTurnBluffIsPriced.md`): off (absent, false, non-boolean) bit-identical across NLH cash and MTT and PLO4/PLO5; on, the candidate sizes are priced against the realized check with no `fastRandom`; zero reach to PLO4/5/6, hi-lo, short deck, fixed limit, multi-board, bomb pot, All-In-Or-Fold, the river and facing-bet spots; refused by `OPTION_SWITCH_REFUSED`; its grade cards only in `DEVELOPMENT_LEAGUE_CARDS` (`server/src/benchmark/HorseLeague.ts`, never `LEAGUE_MATCHUPS`); no `opponentHud/` import.

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered): PASS (below). The PRIMARY result is not significant: the bar is "not worse".
- Replay on real audited decisions (Criterion 5): NOT RUN (see `## Replay`).
- Telemetry: the manifest states that a separate telemetry audit confirms the `holdem_flop_turn_bluff_priced_*_seen` receipts; that audit's output is not in the grade folder, so it is not verified here.

## Grade (2026-11-22, `flop-turn-bluff-priced`)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/flop-turn-bluff-priced/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `289cde3aaa4120aba590f94287d8bb6724f3b44bb933747d90a8e6271ba4e481`). Pre-registered manifest `grade-manifests/flop-turn-bluff-priced.manifest.json` (sha256 `8ef5161e47ed262086deea346c170ea5974273e3ad1cf8f41166a901ddba31cd`, the sha the verdict records) and criteria `grade-manifests/CRITERIA-holdem-flop-turn-bluff-is-priced.md` (sha256 `dc10c7ada3835e4ca71a3baa835bb87d7cdf6cf1e18c72a93c542416a815bb65`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `e1cc857d95b6`, offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Arms: A `{ flopTurnBluffBaseline: true, holdemFlopTurnBluffIsPriced: true }` vs B `{ flopTurnBluffBaseline: true }`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and the pooled GUARD above `-2.0 x` its own SE; CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `9` cell exit codes `0`.
- PRIMARY `cash6_holdem_flop_turn_bluff_is_priced` (6-max NLH cash): equal-weight pooled **`+1.290 +/- 0.965 bb/100` (`z = +1.336`)**; inverse-variance cross-check `+0.966 +/- 0.951` (`z = +1.015`). Seeds: `+3.376 +/- 2.065` (`z = +1.635`), `+1.631 +/- 1.872` (`+0.871`), `-1.882 +/- 1.685` (`-1.117`), `+2.034 +/- 2.073` (`+0.981`). `2,469` divergent pairs.
- GUARD `hu_holdem_flop_turn_bluff_is_priced` (heads-up NLH cash): pooled inverse-variance `+1.829 +/- 2.568` (`z = +0.712`), equal-weight `+1.607 +/- 2.571`. Seeds: `-1.176 +/- 5.248`, `+10.304 +/- 4.936`, `+3.727 +/- 5.206`, `-6.428 +/- 5.170`.
- Worst guarded cell: `hu_holdem_flop_turn_bluff_is_priced` seed `20261125`, `-6.428 +/- 5.170` (`z = -1.243`), inside the `-2.0` bar.
- CONTROL (`a = b = { flopTurnBluffBaseline: true }`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=dc10c7ad... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-22 no replay of holdemFlopTurnBluffIsPriced on real audited decisions is recorded; the pre-registered Criterion 5, HVH48 Auditor D real-card replay with newlyWrong <= fixed, waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- The PRIMARY gain is not significant (`z = +1.336`) and one PRIMARY seed is negative (`-1.882`); the grade shows no harm at its bars, not a win.
- The grade is offline Horse-against-Horse league play with empty solver stores; no human field and no live decision has seen it.
- The grade is of the pinned HEAD. `HorseHoldemFlopTurnBluffIsPriced.ts` in the bundle is byte-identical to it; `HorseLogic.ts` and `holdemEmpiricalPriors.ts` carry later merges, among them `78bec5fc4539` (the texture classifier this option imports is aliased beside the HORSE DECISIONS slowplay classifier; `HorseLogic.ts` only). A grade on the bundle itself is not measured.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: holdemFlopTurnBluffIsPriced <the path of this file after that rename> sha256 <64 hex>` (this file's sha256 after that rename; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set holdemFlopTurnBluffIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('holdemFlopTurnBluffIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseHoldemFlopTurnBluffIsPriced.ts` or its `HorseLogic` sites).
