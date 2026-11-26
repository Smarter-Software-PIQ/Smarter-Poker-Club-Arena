# holdemRiverBluffIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-22, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `holdemRiverBluffIsPriced.UNREGISTERED.md` until the registration change renames it to `holdemRiverBluffIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812 (stacked on the HORSE DECISIONS combo; open, not merged, read 2026-11-22). Evidence NOT MET: the pre-registered offline league grade `river-bluff-priced` is PASS (PRIMARY 6-max cash `+2.116 +/- 0.608 bb/100`, `z = +3.483`, equal-weight pooled over 4 seeds; worst guarded cell `+0.368 +/- 1.342`; CONTROL inert; `0` illegal, `0` truncated, `0` brain fallbacks), but Criterion 5 of the same criteria, the replay on real audited decisions (HVH48 Auditor D), is not run: the scorer refuses an option set that names an option the registry refuses, so it can run only after the switch-list migration. Switch-on waits for that replay row (`newlyWrong <= fixed`) under `## Replay`.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the Horse Switch lane on 2026-11-22 (graded HEAD `f76dda9fe3efb06efe55bb1c501ba1a411e3ff07`, merged into the bundle by `34ae2b9869ca`).

## The blanket rule it replaces

`riverBluffBaseline` (A2, REVIEW-HOLDEM-OFFLIST-20261121.md section 5). On unopened or checked-to heads-up single-board two-card no-limit hold'em rivers with air (equity below 0.25) and a coherent line, the baseline draws a random bet fraction (`riverBluffSize(..., u: fastRandom())`), computes a fixed-formula frequency (`riverBluffProbability`) and bluffs on `fastRandom() < pRbT`: it still bluffs 20% into confirmed calling stations and fires random-size bluffs with pure junk or blank-river donk leads. Nothing in it prices the bluff against the check.

## What it does

Code: `server/src/engine/HorseHoldemRiverBluffIsPriced.ts`, read at one site in `HorseLogic.decidePostflop` (the BASELINE RIVER BLUFF RANGE block, `holdemRiverBluffIsPricedApplies`). Independent of `riverBluffBaseline` (the option is read on its own), with no `fastRandom` and no hash-unit draw:

- Every legal bluff size is priced: `0.33`, `0.55`, `0.75`, `1.0` and `1.25` pot, capped by the effective stack (all in).
- His river fold probability is `estimateHoldemRiverFoldToBet` (`holdemEmpiricalPriors.ts`: the measured NLH river first-bet fold curve with Empirical-Bayes shrinkage over his HUD packet, `ExploitCounters` and HorseMind reads), adjusted for air-hand selection bias against MDF, the line (`barrel`, `opponentGaveUp`, `scare`, `initiative`, `checkedThrough`, `leadDraw`, `leadBlank`), card removal (`nutBlocker`, `unblocker`, `missedDraw`, `junk`), board scare and range advantage, polar overbet credibility, and calling-station discipline.
- `EV(bluff_s) = foldProb x pot x (1 - d) + (1 - foldProb) x (eqWhenCalled x (pot + 2 bet) x (1 - d) - bet)`, against `EV(check) = showdownEquity x pot x (1 - d)` (`d` the rake deduction, `eqWhenCalled` Bayes-conditioned on his calling range).
- It bets the highest-EV legal size only when `EV(bestBluff) > EV(check) + riskMargin` (the margin grows with the size and with tournament ICM risk); otherwise it checks.

Scope: single-board two-card NLH, heads-up, unopened or checked-to river air bluffs. Not multiway, not river value hands, not facing a bet; no Omaha (PLO4/5/6, hi-lo), short deck, fixed limit, multi-board, bomb pot or All-In-Or-Fold. No overlap with `v87RiverBlockBetTrapIsPriced` (river nut traps) or `v64RiverRaiseNeedsTwoPairIsPriced` (river raises facing a bet). No import from `opponentHud/`. Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## Receipts

`holdem_river_bluff_priced_bet_seen`, `holdem_river_bluff_priced_overbet_seen`, `holdem_river_bluff_priced_check_seen`, `holdem_river_bluff_priced_station_check_seen`, `holdem_river_bluff_priced_illegal_seen` (registered in `HorseDataLedger.ts`).

## Tests

`server/src/engine/AHoldemRiverBluffIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AHoldemRiverBluffIsPriced.md`): off (absent, false, truthy non-boolean) is bit-identical in decisions, telemetry and PRNG draws across NLH cash and MTT and PLO4/PLO5; on, the candidate sizes are priced against `EV(check)` with no `fastRandom`, independent of `riverBluffBaseline`, with its literal receipts; PLO4/5/6, hi-lo, short deck, fixed limit, multi-board, bomb pot, All-In-Or-Fold, multiway, river value hands and facing-bet rivers untouched; refused by `OPTION_SWITCH_REFUSED`; its grade cards only in `DEVELOPMENT_LEAGUE_CARDS` (`server/src/benchmark/HorseLeague.ts`).

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered): PASS (below).
- Replay on real audited decisions (Criterion 5): NOT RUN (see `## Replay`).
- Telemetry: the manifest states that a separate telemetry audit confirms the `holdem_river_bluff_priced_*_seen` receipts; that audit's output is not in the grade folder, so it is not verified here.

## Grade (2026-11-22, `river-bluff-priced`)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/river-bluff-priced/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `d2150bb586d6281460296b9013602182a948b3ee46a4de5f6d08fc68741c0a5d`). Pre-registered manifest `grade-manifests/river-bluff-priced.manifest.json` (sha256 `9f9ff35972825f0dc302117c34ea6b91917a806f6bc0fd6f2dedb32967df5bfe`, the sha the verdict records) and criteria `grade-manifests/CRITERIA-holdem-river-bluff-is-priced.md` (sha256 `8088be910946fb83af2e32a6edefd48c033c8071a2473deedfc6937dfa569078`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `f76dda9fe3ef`, offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Arms: A `{ riverBluffBaseline: true, holdemRiverBluffIsPriced: true }` vs B `{ riverBluffBaseline: true }`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and the pooled GUARD above `-2.0 x` its own SE; CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `9` cell exit codes `0`.
- PRIMARY `cash6_holdem_river_bluff_is_priced` (6-max NLH cash): equal-weight pooled **`+2.116 +/- 0.608 bb/100` (`z = +3.483`)**; inverse-variance cross-check `+2.203 +/- 0.598` (`z = +3.683`). Seeds: `+2.658 +/- 1.062` (`z = +2.502`), `+0.368 +/- 1.342` (`+0.274`), `+2.003 +/- 1.166` (`+1.718`), `+3.435 +/- 1.272` (`+2.701`). `711` divergent pairs.
- GUARD `hu_holdem_river_bluff_is_priced` (heads-up NLH cash): pooled inverse-variance `+6.012 +/- 2.145` (`z = +2.803`), equal-weight `+6.426 +/- 2.160`. Seeds: `+11.877 +/- 4.539`, `+8.842 +/- 4.466`, `+1.857 +/- 3.892`, `+3.128 +/- 4.353`.
- Worst guarded cell: `cash6_holdem_river_bluff_is_priced` seed `20261123`, `+0.368 +/- 1.342` (`z = +0.274`); no cell is below zero.
- CONTROL (`a = b = { riverBluffBaseline: true }`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=8088be91... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-22 no replay of holdemRiverBluffIsPriced on real audited decisions is recorded; the pre-registered Criterion 5, HVH48 Auditor D real-card replay with newlyWrong <= fixed, waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- The grade is offline Horse-against-Horse league play with empty solver stores; no human field and no live decision has seen it.
- The grade is of the pinned HEAD. `HorseHoldemRiverBluffIsPriced.ts` in the bundle is byte-identical to it; `HorseLogic.ts` and `holdemEmpiricalPriors.ts` in the bundle carry later merges (other options and the HORSE DECISIONS combo). A grade on the bundle itself is not measured.
- His fold probability is a population curve shrunk toward his reads; with no read it is the population figure.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: holdemRiverBluffIsPriced <the path of this file after that rename> sha256 <64 hex>` (this file's sha256 after that rename; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set holdemRiverBluffIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('holdemRiverBluffIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseHoldemRiverBluffIsPriced.ts` or its `HorseLogic` site).
