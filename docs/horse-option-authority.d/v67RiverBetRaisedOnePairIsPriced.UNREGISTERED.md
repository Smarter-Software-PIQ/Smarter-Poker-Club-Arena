# v67RiverBetRaisedOnePairIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-22, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `v67RiverBetRaisedOnePairIsPriced.UNREGISTERED.md` until the registration change renames it to `v67RiverBetRaisedOnePairIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812 (stacked on the HORSE DECISIONS combo; open, not merged, read 2026-11-22; this option entered the stacked bundle at `04e61bb84dcd`). Evidence NOT MET: the pre-registered offline league grade `v67-river-bet-raised-one-pair-priced` is PASS (PRIMARY 6-max cash `+0.159 +/- 0.097 bb/100`, `z = +1.632`, equal-weight pooled over 4 seeds, a not-worse bar, not a measured gain; worst guarded cell `-3.078 +/- 2.864`, `z = -1.074`; CONTROL inert; `0` illegal, `0` truncated, `0` brain fallbacks), but Criterion 5 of the same criteria, the replay on real audited decisions (HVH48 Auditor D), is not run: the scorer refuses an option set that names an option the registry refuses, so it can run only after the switch-list migration. Switch-on waits for that replay row (`newlyWrong <= fixed`) under `## Replay`.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the Horse Switch lane on 2026-11-22 (graded HEAD `981c363a1288affefe6f018121831b7e17a0cbaa`, merged into the bundle by `04e61bb84dcd`).

## The blanket rule it replaces

`v67RiverBetRaisedOnePair` (V67; decoupled from `v61RiverOnePairShade` in #11713). On single-board two-card no-limit hold'em rivers where the Horse bet or raised and now faces a raise holding the bluff-catch class (high card, one pair, or two pair through the board's pair), V67 applies three categorical overrides in `HorseLogic.ts`:

1. Site 1, the river raise stratum: the raiser is put on a fixed 10% bluff / 75% two pair or better / 22% top pair / 3% weaker pair Monte Carlo stratum (`raisePolar67`), gated by a binary `exploit.callDownMod <= 1` cliff.
2. Site 2, the V87 river block-bet raised one-pair fold: `fold` whenever the Horse's small (at most 36% pot) river block bet is raised (`potFrac >= 0.30`, `toCall < stack`), whatever the price, kicker, blockers or his river bluff-raise profile.
3. Site 3, `v67Class` / `shade67` in the committed and V38 river verdicts: a fixed raise shade (`v61RiverOnePairShade + 0.10`, capped at `0.25`) with the same binary cliff, routed through random V38 indifference noise.

## What it does

Code: `server/src/engine/HorseV67RiverBetRaisedOnePairPriced.ts`, read in `HorseLogic.decidePostflop` at two places: `v67PricedSuppressStratum` (Site 1: the `raisePolar67` stratum override is not applied) and `v67PricedEligible` (`v67RiverBetRaisedOnePairIsPricedApplies`; Sites 2 and 3 are replaced by the priced call or fold). Independent of `v67RiverBetRaisedOnePair`, with no `fastRandom` or `Math.random`:

- His river raise bluff share is anchored on measured NLH showdown data (`estimateHoldemRiverBluffShare`, `empiricalBayesShrink`, `readHudOpponentStat` in `holdemEmpiricalPriors.ts`, untouched).
- The raise range's value and bluff mix moves with the raise size (`raisePotFrac`), the number of opponents, block-bet inducement, board danger (paired, double-paired, three-flush, four-flush, straight windows), the Horse's place in the bluff-catch class (overpair, top pair and kicker, second pair, underpair, playing the board, high card), card-removal blockers (nut and second-nut flush, top straight, top board rank), his river aggression and bluff-raise profile (smooth, no `callDownMod <= 1` cliff), the true pot odds `callable / ((pot + callable) x (1 - deduction) + overlay)`, and a tournament ICM risk premium.
- It calls if and only if the risk-adjusted `EV(call) > 0` (an exact tie folds); it never re-raises or jams with the bluff-catch class.

Scope: single-board two-card NLH rivers only. No flop or turn, Omaha (PLO4/5/6, hi-lo), short deck, fixed limit, pot limit, multi-board, bomb pots or All-In-Or-Fold. No import from `opponentHud/`. Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## Receipts

`v67_river_bet_raised_one_pair_priced_call_taken`, `v67_river_bet_raised_one_pair_priced_fold_taken`, `v67_river_bet_raised_one_pair_priced_block_bet_call_taken`, `v67_river_bet_raised_one_pair_priced_block_bet_fold_taken` (registered in `HorseDataLedger.ts`).

## Tests

`server/src/engine/AV67RiverBetRaisedOnePairIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AV67RiverBetRaisedOnePairIsPriced.md`): all three V67 sites replaced on single-board two-card NLH rivers by deterministic EV pricing; no `fastRandom` or `Math.random`; no `opponentHud/` import; default-off bit-invariance; independent of `v67RiverBetRaisedOnePair`; zero reach to PLO, flop, turn, multi-board, bomb pot and non-NLH spots; strictly monotonic pricing across raise size, his river-raise bluffing, blockers, board danger and ICM risk; `NaN` / `Infinity` inputs fail closed; refused by `OPTION_SWITCH_REFUSED`; its grade cards only in `DEVELOPMENT_LEAGUE_CARDS` (`server/src/benchmark/HorseLeague.ts`).

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered): PASS (below). The PRIMARY result is not significant: the bar is "not worse".
- Replay on real audited decisions (Criterion 5): NOT RUN (see `## Replay`).
- Telemetry: the manifest states that a separate telemetry audit confirms the `v67_river_bet_raised_one_pair_priced_*` call and fold receipts at Sites 2 and 3; that audit's output is not in the grade folder, so it is not verified here.

## Grade (2026-11-22, `v67-river-bet-raised-one-pair-priced`, grade #19)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/v67-river-bet-raised-one-pair-priced/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `278b3b1e931056b87a084c5e3aa72bcf797b2b7c6f1cfd7cb95a83395ba7fb72`, `HOST.md`). Pre-registered manifest `grade-manifests/v67-river-bet-raised-one-pair-priced.manifest.json` (sha256 `3b7bff46004bb0e1282b0d543e67df3dd0f82b7d5a29e44deb24ef6f12621d7f`, the sha the verdict records) and criteria `grade-manifests/CRITERIA-v67-river-bet-raised-one-pair-is-priced.md` (sha256 `aba14f0a08040636d136c2d4255555a558f20a1de69bc00ca754cee6a88e3daa`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `981c363a1288`, offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Host (`HOST.md`): 12 of the 13 jobs ran on the operations Mac; the run was resumed on an isolated Linux cloud container (same harness and pinned HEAD, `enforceRevisionMatch` on), where only the CONTROL job ran. Determinism proof: the heads-up seed `20261122` (6,000 pairs) re-run on the container was byte-identical to the Mac result (`-2.231958333333334 bb/100`, stderr `4.109466263709087`, `826` divergent pairs).

Arms: A `{ v67RiverBetRaisedOnePair: true, v67RiverBetRaisedOnePairIsPriced: true }` vs B `{ v67RiverBetRaisedOnePair: true }`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and each pooled GUARD above `-2.0 x` its own SE; CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `13` cell exit codes `0`.
- PRIMARY `cash6_v67_river_bet_raised_one_pair_is_priced` (6-max NLH cash): equal-weight pooled **`+0.159 +/- 0.097 bb/100` (`z = +1.632`)**; inverse-variance cross-check `+0.163 +/- 0.089` (`z = +1.835`). Seeds: `+0.139 +/- 0.139` (`z = +1.000`), `+0.111 +/- 0.210` (`+0.530`), `+0.151 +/- 0.247` (`+0.612`), `+0.235 +/- 0.166` (`+1.411`). `17` divergent pairs.
- GUARD `cash9_v67_river_bet_raised_one_pair_is_priced` (9-max NLH cash): pooled inverse-variance `-0.005 +/- 0.014` (`z = -0.375`), equal-weight `+0.147 +/- 0.054`. Seeds: `+0.190 +/- 0.103`, `+0.219 +/- 0.128`, `-0.015 +/- 0.015`, `+0.194 +/- 0.137`.
- GUARD `hu_v67_river_bet_raised_one_pair_is_priced` (heads-up NLH cash): pooled inverse-variance `+0.072 +/- 1.738` (`z = +0.042`), equal-weight `+0.278 +/- 1.804`. Seeds: `-2.232 +/- 4.109`, `+6.050 +/- 3.456`, `+0.369 +/- 3.881`, `-3.078 +/- 2.864`.
- Worst guarded cell: `hu_v67_river_bet_raised_one_pair_is_priced` seed `20261125`, `-3.078 +/- 2.864` (`z = -1.074`), inside the `-2.0` bar.
- CONTROL (`a = b = { v67RiverBetRaisedOnePair: true }`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=aba14f0a... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-22 no replay of v67RiverBetRaisedOnePairIsPriced on real audited decisions is recorded; the pre-registered Criterion 5, HVH48 Auditor D real-card replay with newlyWrong <= fixed, waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- The spot is rare in the league: `17` divergent pairs over the 4 PRIMARY seeds of `6,000` pairs each. The PRIMARY gain is not significant (`z = +1.632`); the grade shows no harm at its bars, not a win.
- The grade is offline Horse-against-Horse league play with empty solver stores; no human field and no live decision has seen it.
- The grade is of the pinned HEAD. `HorseV67RiverBetRaisedOnePairPriced.ts` in the bundle is byte-identical to it; `HorseLogic.ts` and `holdemEmpiricalPriors.ts` carry later merges. A grade on the bundle itself is not measured.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: v67RiverBetRaisedOnePairIsPriced docs/horse-option-authority.d/v67RiverBetRaisedOnePairIsPriced.md sha256 <64 hex>` (this file's sha256 after that rename; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set v67RiverBetRaisedOnePairIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('v67RiverBetRaisedOnePairIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseV67RiverBetRaisedOnePairPriced.ts` or its `HorseLogic` sites).
