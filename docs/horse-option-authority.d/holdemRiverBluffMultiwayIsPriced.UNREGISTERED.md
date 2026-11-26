# holdemRiverBluffMultiwayIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-22, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `holdemRiverBluffMultiwayIsPriced.UNREGISTERED.md` until the registration change renames it to `holdemRiverBluffMultiwayIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812 (stacked on the HORSE DECISIONS combo; open, not merged, read 2026-11-22). Evidence NOT MET: the pre-registered offline league grade `river-bluff-multiway-priced` is PASS (PRIMARY 6-max cash `+0.561 +/- 0.223 bb/100`, `z = +2.519`, equal-weight pooled over 4 seeds; worst guarded cell `-0.023 +/- 0.238`, `z = -0.097`; CONTROL inert; the heads-up inert guard inert on all 4 seeds; `0` illegal, `0` truncated, `0` brain fallbacks), but Criterion 5 of the same criteria, the replay on real audited decisions (HVH48 Auditor D), is not run: the scorer refuses an option set that names an option the registry refuses, so it can run only after the switch-list migration. Switch-on waits for that replay row (`newlyWrong <= fixed`) under `## Replay`.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the Horse Switch lane on 2026-11-22 (graded HEAD `81743902bc01f73429c77bdd1902029adff98aba`, merged into the bundle by `6f78cf2151a2`).

## The blanket rule it replaces

`riverBluffMultiway` (A5, REVIEW-HOLDEM-OFFLIST-20261121.md section 5). On unopened or checked-to single-board two-card no-limit hold'em rivers with two or more opponents, air (`equity < 0.5 / (N + 1)`, no hole pair), a nut blocker and a capped-field story, the rule hard-caps evaluation at 2 or 3 opponents (more is skipped as `too_many`), draws a random bet fraction (`multiwayRiverBluffSize(..., u: fastRandom())`), computes a fixed-formula decay probability (`multiwayRiverBluffProbability`) and bluffs on `fastRandom() < pMw`: it still bluffs 5% into confirmed calling stations and bets non-scare and barrel spots without pricing multiway fold equity against the check.

## What it does

Code: `server/src/engine/HorseHoldemRiverBluffMultiwayIsPriced.ts`, read at one site in `HorseLogic.decidePostflop` (the multiway river bluff block). Independent of `riverBluffMultiway`, with no `fastRandom` or `Math.random`:

- Every legal size is priced: `0.50`, `0.75`, `1.00` and `1.25` pot, stack-capped, against `EV(check) = showdownEquity x pot x (1 - d)`.
- Each opponent's fold probability `pFold_i` is read from the measured NLH river first-bet fold curve (`HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET`, n = 15,623 pooled NLH rivers, `holdemEmpiricalPriors.ts`), with multiway credibility, selection-bias surplus retention around the three-way per-opponent MDF `sqrt(f / (1 + f))`, and per-opponent Empirical-Bayes shrinkage on his calling tendency (HUD packet, `ExploitCounters` `riverCall / riverCallOpp`, HorseMind `riverFoldRate` / `fastCalldownRead`, `lightCallerFactor`).
- Fold equity compounds over every active opponent: `pFoldAll = prod_i pFold_i` (no hard opponent cutoff); equity when called is conditioned on at least one opponent holding the top `1 - pFold_i` of his range.
- Station veto: if any active opponent is a confirmed river calling station (`station`, `fastCalldown.callingDown`, or `riverFoldRate < 0.35`), his fold probability is capped at `0.22` and the decision is a check.
- It bets the highest-EV legal size only when `EV(bestBluff) > EV(check) + riskMargin` (the margin grows with the size and with tournament ICM risk; all-in bluffs withheld under severe ICM risk); otherwise it checks.

Scope: single-board two-card NLH unopened or checked-to rivers with `opponentsLive >= 2`. Not heads-up rivers (`holdemRiverBluffIsPriced`), not heads-up OOP leads (`holdemRiverLeadRangeIsPriced`), not river nut traps (`v87RiverBlockBetTrapIsPriced`), not facing-bet river raises, not river value hands; no Omaha (PLO4/5/6, hi-lo), short deck, fixed limit, multi-board, bomb pot or All-In-Or-Fold. No import from `opponentHud/`. Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## Receipts

`holdem_river_bluff_multiway_priced_bet_seen`, `holdem_river_bluff_multiway_priced_overbet_seen`, `holdem_river_bluff_multiway_priced_check_seen`, `holdem_river_bluff_multiway_priced_station_check_seen`, `holdem_river_bluff_multiway_priced_illegal_seen` (registered in `HorseDataLedger.ts`).

## Tests

`server/src/engine/AHoldemRiverBluffMultiwayIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AHoldemRiverBluffMultiwayIsPriced.md`): off (absent, false, non-boolean) bit-identical across NLH cash and MTT and PLO4/PLO5; on, the candidate sizes are priced against the check with per-opponent shrinkage, the product fold equity, called-range equity, the station veto and ICM-protected margins, with no `fastRandom`; zero reach to heads-up rivers, PLO4/5/6, hi-lo, short deck, fixed limit, multi-board, bomb pot, All-In-Or-Fold, other streets, river value hands and facing-bet spots; refused by `OPTION_SWITCH_REFUSED`; its grade cards only in `DEVELOPMENT_LEAGUE_CARDS` (`server/src/benchmark/HorseLeague.ts`, never `LEAGUE_MATCHUPS`); no `opponentHud/` import.

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered): PASS (below).
- Replay on real audited decisions (Criterion 5): NOT RUN (see `## Replay`).
- Telemetry: the manifest states that a separate telemetry audit confirms the `holdem_river_bluff_multiway_priced_*_seen` receipts; that audit's output is not in the grade folder, so it is not verified here.

## Grade (2026-11-22, `river-bluff-multiway-priced`, grade #13)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/river-bluff-multiway-priced/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `d5fb545e9275ac80ccf0cd7679e18c055f99f7ef46cab91d33ff4683d6ecf75a`). Pre-registered manifest `grade-manifests/river-bluff-multiway-priced.manifest.json` (sha256 `fe29bc6b8356356a40d5da26fb7a949dcbec0060aa54d4386b927d08754fc6fb`, the sha the verdict records) and criteria `grade-manifests/CRITERIA-holdem-river-bluff-multiway-is-priced.md` (sha256 `5a849843e59d2a3d1701fd04b98af6cfa7e1e72ac99e4f69d19454ba70d9e102`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `81743902bc01`, offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Arms: A `{ riverBluffMultiway: true, holdemRiverBluffMultiwayIsPriced: true }` vs B `{ riverBluffMultiway: true }`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and each pooled GUARD above `-2.0 x` its own SE; the heads-up card declared inert (it must not diverge); CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `13` cell exit codes `0`.
- PRIMARY `cash6_holdem_river_bluff_multiway_is_priced` (6-max NLH cash): equal-weight pooled **`+0.561 +/- 0.223 bb/100` (`z = +2.519`)**; inverse-variance cross-check `+0.451 +/- 0.198` (`z = +2.280`). Seeds: `+0.007 +/- 0.491` (`z = +0.014`), `+0.421 +/- 0.373` (`+1.128`), `+0.356 +/- 0.299` (`+1.192`), `+1.460 +/- 0.570` (`+2.564`). `151` divergent pairs.
- GUARD `cash9_holdem_river_bluff_multiway_is_priced` (9-max NLH cash): pooled inverse-variance `+0.277 +/- 0.087` (`z = +3.173`), equal-weight `+0.233 +/- 0.094`. Seeds: `+0.281 +/- 0.195`, `+0.308 +/- 0.151`, `-0.023 +/- 0.238`, `+0.367 +/- 0.152`.
- Inert GUARD `hu_holdem_river_bluff_multiway_is_priced` (heads-up, where the option has no reach): `4` checked, `0` breaches, `0.000 bb/100` on every seed.
- Worst guarded cell: `cash9_holdem_river_bluff_multiway_is_priced` seed `20261124`, `-0.023 +/- 0.238` (`z = -0.097`).
- CONTROL (`a = b = { riverBluffMultiway: true }`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=5a849843... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-22 no replay of holdemRiverBluffMultiwayIsPriced on real audited decisions is recorded; the pre-registered Criterion 5, HVH48 Auditor D real-card replay with newlyWrong <= fixed, waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- The grade is offline Horse-against-Horse league play with empty solver stores; no human field and no live decision has seen it.
- The spot is rare: `151` divergent pairs over the 4 PRIMARY seeds of `6,000` pairs each.
- The grade is of the pinned HEAD. `HorseHoldemRiverBluffMultiwayIsPriced.ts` in the bundle is byte-identical to it; `HorseLogic.ts` and `holdemEmpiricalPriors.ts` carry later merges. A grade on the bundle itself is not measured.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: holdemRiverBluffMultiwayIsPriced <the path of this file after that rename> sha256 <64 hex>` (this file's sha256 after that rename; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set holdemRiverBluffMultiwayIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('holdemRiverBluffMultiwayIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseHoldemRiverBluffMultiwayIsPriced.ts` or its `HorseLogic` site).
