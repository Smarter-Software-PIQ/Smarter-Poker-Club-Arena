# holdemRiverLeadRangeIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-22, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `holdemRiverLeadRangeIsPriced.UNREGISTERED.md` until the registration change renames it to `holdemRiverLeadRangeIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812 (stacked on the HORSE DECISIONS combo; open, not merged, read 2026-11-22). Evidence NOT MET: the pre-registered offline league grade `river-lead-range-priced` is PASS (PRIMARY 6-max cash `+1.704 +/- 0.729 bb/100`, `z = +2.337`, equal-weight pooled over 4 seeds; worst guarded cell `-8.172 +/- 4.980`, `z = -1.641`; CONTROL inert; `0` illegal, `0` truncated, `0` brain fallbacks), but Criterion 5 of the same criteria, the replay on real audited decisions (HVH48 Auditor D), is not run: the scorer refuses an option set that names an option the registry refuses, so it can run only after the switch-list migration. Switch-on waits for that replay row (`newlyWrong <= fixed`) under `## Replay`.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the Horse Switch lane on 2026-11-22 (graded HEAD `b5d50fcd154a25dc07fa9eb2e34213c60b231be6`, merged into the bundle by `5fbe9b9b712b`).

## The blanket rule it replaces

`riverLeadRange` (A4, REVIEW-HOLDEM-OFFLIST-20261121.md section 5), at two sites in `HorseLogic.ts` for heads-up out-of-position river leads into the turn bettor (`riverLeadSpot`: he bet the turn, the Horse called out of position, nobody has acted on the river):

1. Site 1 (`riverBluffBaseline`, `leadRange`): air (equity below 0.25) classed `leadDraw` or `leadBlank` draws a random size (`riverBluffSize(..., u: fastRandom())`) and a random coin (`fastRandom() < pRbT`).
2. Site 2 (V11 initiative gate, `leadValueSpot`): on draw-completing rivers only, value hands roll fixed coins (equity `>= 0.80` leads on `0.60`, `>= 0.70` on `0.30`) and fall to the generic sizing ladder; thin value (equity 0.55 to 0.70) against passive check-backs and check-call or check-raise traps against aggressive stabbers are not priced.

## What it does

Code: `server/src/engine/HorseHoldemRiverLeadRangeIsPriced.ts`, read at one site in `HorseLogic.decidePostflop` ahead of the baseline river bluff block. Independent of `riverLeadRange`, with no `fastRandom` or `Math.random`, it prices the lead sizes `0.33`, `0.55`, `0.75` and `1.0` pot (stack-capped) against the check, over measured NLH priors in `holdemEmpiricalPriors.ts`:

- `EV(check)` uses his river bet-when-checked-to rate (`estimateHoldemBetWhenCheckedTo('river', ...)`, conditioned on draw completion and his aggression), his measured river bluff share (`estimateHoldemRiverBluffShare`) and the Horse's best answer to his bet, `max(check-fold, check-call, check-raise)` (with `estimateHoldemRiverFoldToRaise` and `holdemVillainRaiseCallPrice`).
- `EV(lead_s)` prices his three answers at every size: fold (`pFold`, interpolated from `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET`, n = 15,623, with Empirical-Bayes shrinkage over structural HUD, `ExploitCounters` and `riverFoldRate`, air-bluff MDF calibration, blocker, unblocker and scare conditioning, and calling-station discipline); call (`pCall = 1 - pFold - pRaise`, with Bayes-conditioned equity over his flat-calling interval); raise (`pRaise`, size- and aggression-sensitive, `0` when the lead is all in, with equity against his polarized raising range and the best of fold or call).
- The highest-value option is taken: a thin-value block lead where he checks back too often and calls worse, value and bluff leads on draw-completing rivers, or the check (to call or raise) where he stabs when checked to.

Scope: single-board two-card NLH heads-up out-of-position river leads into the turn aggressor only. Not the non-lead `riverBluffBaseline` / `holdemRiverBluffIsPriced` lines, not `v87RiverBlockBetTrap` / `v87RiverBlockBetTrapIsPriced` (`initiative !== 'opp'`), not `holdemRiverFullHouseValue` / `holdemRiverFullHouseValueIsPriced` (qualifying river full houses), not multiway; no Omaha (PLO4/5/6, hi-lo), short deck, fixed limit, multi-board, bomb pot or All-In-Or-Fold. No import from `opponentHud/`. Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## Receipts

`holdem_river_lead_range_priced_value_lead_seen`, `holdem_river_lead_range_priced_thin_value_lead_seen`, `holdem_river_lead_range_priced_bluff_lead_seen`, `holdem_river_lead_range_priced_check_seen`, `holdem_river_lead_range_priced_illegal_seen` (registered in `HorseDataLedger.ts`).

## Tests

`server/src/engine/AHoldemRiverLeadRangeIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AHoldemRiverLeadRangeIsPriced.md`): only heads-up out-of-position river leads into the turn aggressor; the candidate sizes priced against the check (his bet-when-checked-to, fold to the lead, called-range equity, raise risk) with no `fastRandom` or `Math.random`; zero bytes changed when off; zero PLO4/5/6 reach; no overlap with `holdemRiverFullHouseValue` or the non-lead `riverBluffBaseline`; refused by `OPTION_SWITCH_REFUSED`; its literal `holdem_river_lead_range_priced_*_seen` receipts; its grade cards only in `DEVELOPMENT_LEAGUE_CARDS` (`server/src/benchmark/HorseLeague.ts`); no `opponentHud/` import.

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered): PASS (below).
- Replay on real audited decisions (Criterion 5): NOT RUN (see `## Replay`).
- Telemetry: the manifest states that a separate telemetry audit confirms the `holdem_river_lead_range_priced_*_seen` receipts; that audit's output is not in the grade folder, so it is not verified here.

## Grade (2026-11-22, `river-lead-range-priced`)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/river-lead-range-priced/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `d558c956cf886cc32273cac6a31013e3a59a9a4995289a968b5bf9ec97ed44eb`). Pre-registered manifest `grade-manifests/river-lead-range-priced.manifest.json` (sha256 `738377ad54f4900c18b1e3c4aa405bdbf0ecf9aaab77baebc4a225db9a74db06`, the sha the verdict records) and criteria `grade-manifests/CRITERIA-holdem-river-lead-range-is-priced.md` (sha256 `4230615126b045a9849c450d4c7bcf39029526557822988c2992977010a22d9b`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `b5d50fcd154a`, offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Arms: A `{ riverLeadRange: true, holdemRiverLeadRangeIsPriced: true }` vs B `{ riverLeadRange: true }`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and the pooled GUARD above `-2.0 x` its own SE; CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `9` cell exit codes `0`.
- PRIMARY `cash6_holdem_river_lead_range_is_priced` (6-max NLH cash): equal-weight pooled **`+1.704 +/- 0.729 bb/100` (`z = +2.337`)**; inverse-variance cross-check `+1.681 +/- 0.722` (`z = +2.330`). Seeds: `+3.004 +/- 1.433` (`z = +2.096`), `+0.720 +/- 1.463` (`+0.492`), `+1.215 +/- 1.314` (`+0.924`), `+1.876 +/- 1.608` (`+1.167`). `831` divergent pairs.
- GUARD `hu_holdem_river_lead_range_is_priced` (heads-up NLH cash): pooled inverse-variance `-1.343 +/- 2.534` (`z = -0.530`), equal-weight `-1.327 +/- 2.537`. Seeds: `+1.116 +/- 5.269`, `+9.496 +/- 4.981`, `-8.172 +/- 4.980`, `-7.748 +/- 5.062`.
- Worst guarded cell: `hu_holdem_river_lead_range_is_priced` seed `20261124`, `-8.172 +/- 4.980` (`z = -1.641`), inside the `-2.0` bar.
- CONTROL (`a = b = { riverLeadRange: true }`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=42306151... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-22 no replay of holdemRiverLeadRangeIsPriced on real audited decisions is recorded; the pre-registered Criterion 5, HVH48 Auditor D real-card replay with newlyWrong <= fixed, waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- Heads-up is the weak cell: the pooled heads-up guard is negative (`-1.343 +/- 2.534`, not significant) and two of its four seeds are below `-7.7 bb/100`, inside the bar. Watch heads-up tables first after a switch-on.
- The grade is offline Horse-against-Horse league play with empty solver stores; no human field and no live decision has seen it.
- The grade is of the pinned HEAD. `HorseHoldemRiverLeadRangeIsPriced.ts` in the bundle is byte-identical to it; `HorseLogic.ts` and `holdemEmpiricalPriors.ts` carry later merges. A grade on the bundle itself is not measured.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: holdemRiverLeadRangeIsPriced <the path of this file after that rename> sha256 <64 hex>` (this file's sha256 after that rename; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set holdemRiverLeadRangeIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('holdemRiverLeadRangeIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseHoldemRiverLeadRangeIsPriced.ts` or its `HorseLogic` site).
