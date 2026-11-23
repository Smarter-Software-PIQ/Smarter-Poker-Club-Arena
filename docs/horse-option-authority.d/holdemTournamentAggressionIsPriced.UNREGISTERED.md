# holdemTournamentAggressionIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-22, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `holdemTournamentAggressionIsPriced.UNREGISTERED.md` until the registration change renames it to `holdemTournamentAggressionIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812 (stacked on the HORSE DECISIONS combo; open, not merged, read 2026-11-22). Evidence NOT MET: the pre-registered offline league grade `v57-tournament-aggression-priced` is PASS (PRIMARY 6-max 30bb MTT `+1.053 +/- 0.374 bb/100`, `z = +2.814`, equal-weight pooled over 4 seeds; worst guarded cell `-0.057 +/- 0.475`, `z = -0.120`; CONTROL inert; `0` illegal, `0` truncated, `0` brain fallbacks), but Criterion 5 of the same criteria, the replay on real audited decisions (HVH48 Auditor D), is not run: the scorer refuses an option set that names an option the registry refuses, so it can run only after the switch-list migration. Switch-on waits for that replay row (`newlyWrong <= fixed`) under `## Replay`.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the Horse Switch lane on 2026-11-22, Wave 10.1 (graded HEAD `d61bd7f824efa924f831044c627552cdc6feb30b`, merged into the bundle by `fba8c5ed1ce6`).

## The blanket rule it replaces

The four postflop no-limit hold'em tournament overrides gated on `v57TournamentAggression` (the preflop half of `v57TournamentAggression`, in `HorsePreflop.ts`, is not touched):

1. `planBarrel`: a flat 50% coin for planning a multi-street barrel.
2. `v58_low_spr_stack_off`: a blind jam when `effBehind <= pot && equity >= 0.45 + 0.5 x mw`.
3. The V7 BARREL CONTINUATION coins (`0.66` / `0.42` to continue, `0.65` to give up) and the `initiativeTurn57` turn-cell bypass (16%) that ignores who has the initiative.
4. `v58_one_card_low_flush_fold`: an unconditional fold on a four-flush board with three or more higher flush ranks out when the call commits half the stack or more.

## What it does

Code: `server/src/engine/HorseHoldemTournamentAggressionPriced.ts`, read once in `HorseLogic.decidePostflop` (`holdemTourneyAggroPricedActive`, from `holdemTournamentAggressionIsPricedApplies`) and used at each of the four sites. Each override is replaced by an EV and ICM price over `holdemEmpiricalPriors.ts`, with no random draw:

1. `planBarrel` -> `priceHoldemTournamentBarrelPlan`;
2. `v58_low_spr_stack_off` -> `priceHoldemTournamentLowSprDecision` (jam, bet or check);
3. V7 barrel continuation and the turn-cell bypass -> `priceHoldemTournamentBarrelContinue`;
4. `v58_one_card_low_flush_fold` -> `priceHoldemTournamentOneCardFlushCall` (call or fold).

Scope: single-board two-card NLH tournaments, postflop only (flop, turn, river). Preflop, `v58MadeHandCellSkip`, cash, Lightning, Omaha (PLO4/5/6, hi-lo), short deck, fixed limit, pot limit, multi-board, bomb pots and All-In-Or-Fold are untouched. Independent of `v57TournamentAggression`: with this option on, the postflop decision is the same whether `v57TournamentAggression` is true, false or unset. No import from `opponentHud/` (it takes `HoldemHudPacketOpponent` through `holdemEmpiricalPriors.ts` only). Off (absent or false): nothing in the module is entered; byte-identical.

## Receipts

`holdem_tourney_aggro_priced_plan_yes_seen`, `holdem_tourney_aggro_priced_plan_no_seen`, `holdem_tourney_aggro_priced_low_spr_jam_seen`, `holdem_tourney_aggro_priced_low_spr_bet_seen`, `holdem_tourney_aggro_priced_low_spr_check_seen`, `holdem_tourney_aggro_priced_turn_cell_skip_seen`, `holdem_tourney_aggro_priced_barrel_bet_seen`, `holdem_tourney_aggro_priced_barrel_check_seen`, `holdem_tourney_aggro_priced_one_card_flush_fold_seen`, `holdem_tourney_aggro_priced_one_card_flush_call_seen` (registered in `HorseDataLedger.ts`).

## Tests

`server/src/engine/AHoldemTournamentAggressionIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-AHoldemTournamentAggressionIsPriced.md`): the four overrides replaced by EV and ICM pricing on single-board two-card NLH tournament postflop spots only; no `fastRandom` or `Math.random`; no `opponentHud/` coupling; bit-identical when unset or false; no reach to preflop, cash, Lightning, Omaha, short deck, fixed limit or multi-board; `v58MadeHandCellSkip` preserved; independent of `v57TournamentAggression`; monotonic EV/ICM pricing; `NaN` / `Infinity` inputs fail safe; refused by `OPTION_SWITCH_REFUSED`; its grade cards only in `DEVELOPMENT_LEAGUE_CARDS` (`server/src/benchmark/HorseLeague.ts`).

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered): PASS (below).
- Replay on real audited decisions (Criterion 5): NOT RUN (see `## Replay`). HVH48 Auditor E holds the tournament decisions; the grade's criteria name Auditor D.
- Telemetry: the manifest states that a separate telemetry audit confirms the `holdem_tourney_aggro_priced_*_seen` receipts; that audit's output is not in the grade folder, so it is not verified here.

## Grade (2026-11-22, `v57-tournament-aggression-priced`, grade #17)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/v57-tournament-aggression-priced/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `b29db1eb55a549e1652d5d1d615c945470bb143f7a665e46e8680746bd31ef84`). Pre-registered manifest `grade-manifests/v57-tournament-aggression-priced.manifest.json` (sha256 `fec0e8025239c210cca49731ec5b8694ef0f4babe0ea97470b3629c0f968e69f`, the sha the verdict records) and criteria `grade-manifests/CRITERIA-holdem-tournament-aggression-is-priced.md` (sha256 `d2e788a5ab0be3f4812f3387e3a0c64d17ab867c170d1c6e713f8b93bb67780a`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `d61bd7f824ef`, offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Arms: A `{ v57TournamentAggression: true, holdemTournamentAggressionIsPriced: true }` vs B `{ v57TournamentAggression: true }`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and each pooled GUARD above `-2.0 x` its own SE; CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `13` cell exit codes `0`.
- PRIMARY `mtt6_holdem_tournament_aggression_is_priced` (6-max 30bb big-blind-ante MTT): equal-weight pooled **`+1.053 +/- 0.374 bb/100` (`z = +2.814`)**; inverse-variance cross-check `+1.044 +/- 0.373` (`z = +2.798`). Seeds: `+0.592 +/- 0.763` (`z = +0.776`), `+0.785 +/- 0.747` (`+1.051`), `+1.061 +/- 0.703` (`+1.510`), `+1.772 +/- 0.778` (`+2.278`). `1,601` divergent pairs.
- GUARD `mtt6_ft_holdem_tournament_aggression_is_priced` (6-max 25bb final-table ICM MTT): pooled inverse-variance `+0.609 +/- 0.252` (`z = +2.412`), equal-weight `+0.627 +/- 0.253`. Seeds: `-0.057 +/- 0.475`, `+0.669 +/- 0.540`, `+0.433 +/- 0.510`, `+1.464 +/- 0.500`.
- GUARD `mtt_hu_holdem_tournament_aggression_is_priced` (2-max 25bb heads-up MTT): pooled inverse-variance `+2.814 +/- 1.004` (`z = +2.802`), equal-weight `+2.756 +/- 1.008`. Seeds: `+4.387 +/- 1.976`, `+3.012 +/- 1.898`, `+1.817 +/- 2.132`, `+1.808 +/- 2.051`.
- Worst guarded cell: `mtt6_ft_holdem_tournament_aggression_is_priced` seed `20261122`, `-0.057 +/- 0.475` (`z = -0.120`).
- CONTROL (`a = b = { v57TournamentAggression: true }`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=d2e788a5... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-22 no replay of holdemTournamentAggressionIsPriced on real audited decisions is recorded; the pre-registered Criterion 5, HVH48 real-card replay with newlyWrong <= fixed, waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- The grade is offline Horse-against-Horse league play with empty solver stores and Horse ICM models; no human field and no live tournament decision has seen it.
- Bounty events (PKO, mystery bounty): not measured.
- The grade is of the pinned HEAD. `HorseHoldemTournamentAggressionPriced.ts` in the bundle is byte-identical to it; `HorseLogic.ts` and `holdemEmpiricalPriors.ts` carry later merges. A grade on the bundle itself is not measured.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: holdemTournamentAggressionIsPriced docs/horse-option-authority.d/holdemTournamentAggressionIsPriced.md sha256 <64 hex>` (this file's sha256 after that rename; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set holdemTournamentAggressionIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('holdemTournamentAggressionIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseHoldemTournamentAggressionPriced.ts` or its `HorseLogic` sites).
