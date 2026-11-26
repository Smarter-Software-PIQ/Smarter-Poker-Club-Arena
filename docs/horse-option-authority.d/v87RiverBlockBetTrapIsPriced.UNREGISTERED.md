# v87RiverBlockBetTrapIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-22, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `v87RiverBlockBetTrapIsPriced.UNREGISTERED.md` until the registration change renames it to `v87RiverBlockBetTrapIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812 (stacked on the HORSE DECISIONS combo; open, not merged, read 2026-11-22). Evidence NOT MET: the pre-registered offline league grade `v87-trap-priced` is PASS (PRIMARY 6-max cash `-0.070 +/- 0.165 bb/100`, `z = -0.427`, equal-weight pooled over 4 seeds, a not-worse bar, not a measured gain; worst guarded cell `-0.415 +/- 0.249`, `z = -1.666`; CONTROL inert; `0` illegal, `0` truncated, `0` brain fallbacks), but Criterion 5 of the same criteria, the replay on real audited decisions (HVH48 Auditor D), is not run: the scorer refuses an option set that names an option the registry refuses, so it can run only after the switch-list migration. Switch-on waits for that replay row (`newlyWrong <= fixed`) under `## Replay`.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the Horse Switch lane on 2026-11-22 (graded HEAD `32d48e9eaf7d492c6242352f209b03fa5c068231`, merged into the bundle by `773376a3fe23`).

## The blanket rule it replaces

`v87RiverBlockBetTrap` (V87 #13, REVIEW-HOLDEM-OFFLIST-20261121.md), two sites in single-board two-card no-limit hold'em:

1. The out-of-position heads-up river lead: with a true river nut trap (`trueRiverNutTrap87`) and his stack above `0.45 x pot`, a hash-unit coin (`unit87('rivertrap') < 0.16 + trapFrequency x 0.18`) fires a block bet of about 28-33% pot (`blockBet87('rivertrap')`, its size also drawn on `unit87`).
2. Facing a raise after that block bet: with the nut trap, it 3-bets blind (all in when `stack <= 1.5 x (pot + toCall)`, else `currentBet + 0.9 x (pot + toCall)`), whatever his fold-to-raise, the depth, or whether a vulnerable near-nut hand only gets called by better.

## What it does

Code: `server/src/engine/HorseHoldemV87RiverBlockBetTrapIsPriced.ts`, read in `HorseLogic.decidePostflop` at the lead site (`v87RiverBlockBetTrapLeadApplies`, then `v87RiverBlockBetTrapLeadVerdict`) and at the facing-raise site, and in `HorseLogic.decideInternal`, where the priced block lead keeps its own size whatever `v87RiverBlockBetTrap` says. Independent of `v87RiverBlockBetTrap`, with no `fastRandom` and no hash-unit coin:

- Lead site: `EV(trap_block_lead)` (a `0.30` pot block bet) against `EV(normal_value_lead)` (`0.55`, `0.75`, `1.0` pot; `1.0` and `1.35` pot with the exact river nuts) against `EV(check)` (eligible whenever the Horse does not hold the exact river nuts that `riverNutsRaise` enforces), the branch where he raises the lead valued by backward induction through the facing-raise pricing.
- Facing-raise site: `EV(trap_reraise)` over the legal deterministic 3-bet and jam sizes against `EV(call)`, using `holdemVillainRaiseCallPrice`, `estimateHoldemRiverFoldToRaise`, `estimateHoldemRiverBluffShare` and equity conditioned on his continuing range.
- Inputs: pot, bet, stacks, equity, the rake deduction and the measured NLH response curves in `holdemEmpiricalPriors.ts`, shrunk toward his `ExploitCounters` (HorseMind).

Scope: single-board two-card NLH river only, out of position heads-up for the lead; no Omaha (PLO4/5/6, hi-lo), short deck, fixed limit, multi-board, bomb pot or All-In-Or-Fold. No import from `opponentHud/`. Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## Receipts

`v87_river_block_bet_trap_priced_block_lead_seen`, `v87_river_block_bet_trap_priced_value_lead_seen`, `v87_river_block_bet_trap_priced_check_seen`, `v87_river_block_bet_trap_priced_reraise_seen`, `v87_river_block_bet_trap_priced_call_seen` (registered in `HorseDataLedger.ts`).

## Tests

`server/src/engine/AV87RiverBlockBetTrapIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AV87RiverBlockBetTrapIsPriced.md`): off (absent, false, truthy non-boolean) bit-identical in decisions, telemetry and PRNG draws across NLH cash and MTT and PLO4/PLO5; on, the lead site compares trap block lead, normal value lead and check, and the facing-raise site compares re-raise and call, with no `fastRandom` or `unit87` coin, independent of `v87RiverBlockBetTrap`, with its `*_seen` receipts; PLO4/5/6, hi-lo, short deck, fixed limit, multi-board, bomb pot and All-In-Or-Fold untouched; refused by `OPTION_SWITCH_REFUSED`; its grade cards only in `DEVELOPMENT_LEAGUE_CARDS` (`server/src/benchmark/HorseLeague.ts`).

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered): PASS (below). The PRIMARY point estimate is negative and not significant: the bar is "not worse".
- Replay on real audited decisions (Criterion 5): NOT RUN (see `## Replay`).
- Telemetry: the manifest states that a separate telemetry audit confirms the `v87_river_block_bet_trap_priced_*_seen` receipts; that audit's output is not in the grade folder, so it is not verified here.

## Grade (2026-11-22, `v87-trap-priced`)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/v87-trap-priced/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `62984e8fcf4f652ce802c20501ab5298a9b3839ac3d7d8a747a0d8f9d25d99d7`). Pre-registered manifest `grade-manifests/v87-trap-priced.manifest.json` (sha256 `64436be4c8a56e063204d3565372c0a6e80b9b10b3ec70535a1297ac5e31c3bf`, the sha the verdict records) and criteria `grade-manifests/CRITERIA-v87-river-block-bet-trap-is-priced.md` (sha256 `8d855d36a457223d11a592e8eda66f3aa157af80b2f4ad8f5354c8633f3e06de`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `32d48e9eaf7d`, offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Arms: A `{ v87RiverBlockBetTrap: true, v87RiverBlockBetTrapIsPriced: true }` vs B `{ v87RiverBlockBetTrap: true }`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and the pooled GUARD above `-2.0 x` its own SE; CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `9` cell exit codes `0`.
- PRIMARY `cash6_v87_river_block_bet_trap_is_priced` (6-max NLH cash): equal-weight pooled **`-0.070 +/- 0.165 bb/100` (`z = -0.427`)**; inverse-variance cross-check `-0.181 +/- 0.126` (`z = -1.440`). Seeds: `-0.300 +/- 0.225` (`z = -1.334`), `+0.451 +/- 0.530` (`+0.851`), `-0.415 +/- 0.249` (`-1.666`), `-0.018 +/- 0.206` (`-0.088`). `57` divergent pairs.
- GUARD `hu_v87_river_block_bet_trap_is_priced` (heads-up NLH cash): pooled inverse-variance `-0.800 +/- 1.695` (`z = -0.472`), equal-weight `-0.275 +/- 1.733`. Seeds: `-0.658 +/- 3.247`, `+4.814 +/- 4.049`, `-2.835 +/- 3.050`, `-2.421 +/- 3.437`.
- Worst guarded cell: `cash6_v87_river_block_bet_trap_is_priced` seed `20261124`, `-0.415 +/- 0.249` (`z = -1.666`), inside the `-2.0` bar.
- CONTROL (`a = b = { v87RiverBlockBetTrap: true }`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=8d855d36... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-22 no replay of v87RiverBlockBetTrapIsPriced on real audited decisions is recorded; the pre-registered Criterion 5, HVH48 Auditor D real-card replay with newlyWrong <= fixed, waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- No measured gain: PRIMARY pooled `-0.070 +/- 0.165` and heads-up pooled `-0.800 +/- 1.695` are both negative point estimates, neither significant; the inverse-variance PRIMARY cross-check is `z = -1.440`. The case for it is the removal of the coin flips and the blind 3-bet (the owner order), not a league win.
- The spot is rare: `57` divergent pairs over the 4 PRIMARY seeds of `6,000` pairs each.
- The grade ran with `v87RiverBlockBetTrap: true` in both arms. The bundle's later commit `731fcb2140d8` (`HorseLogic.decideInternal`: the priced block lead keeps its size when the legacy `v87RiverBlockBetTrap` sub-flag is off) acts only with that sub-flag off, which the grade did not play (not measured).
- The grade is offline Horse-against-Horse league play with empty solver stores; no human field and no live decision has seen it. `HorseHoldemV87RiverBlockBetTrapIsPriced.ts` in the bundle is byte-identical to the graded HEAD; `HorseLogic.ts` and `holdemEmpiricalPriors.ts` carry later merges. A grade on the bundle itself is not measured.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: v87RiverBlockBetTrapIsPriced <the path of this file after that rename> sha256 <64 hex>` (this file's sha256 after that rename; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set v87RiverBlockBetTrapIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('v87RiverBlockBetTrapIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseHoldemV87RiverBlockBetTrapIsPriced.ts` or its `HorseLogic` sites).
