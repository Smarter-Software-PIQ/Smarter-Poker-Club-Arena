# v66BetRaisedOnePairIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-21, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `v66BetRaisedOnePairIsPriced.UNREGISTERED.md` until the registration change renames it to `v66BetRaisedOnePairIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812. Evidence NOT MET: the code in this bundle is the version whose pre-registered league grade FAILED (r1, a heads-up guard seed); the repaired version that passed the re-grade (r2) is not in this bundle; no replay on real audited decisions has judged a single decision of it. This file does not authorize switching the option on.

Owner order it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc." Built by the Horse Switch lane on 2026-11-21. This file was written on 2026-11-25, when the bundle was re-synced on main: a line-by-line audit of the bundle (2026-11-24) found the option had a law test and a law doc but no authority file.

## The blanket rule it replaces

`v66BetRaisedOnePair` (V66): on single-board two-card no-limit hold'em flops and turns where the Horse bet, was raised, and holds one pair or a bluff-catcher without a real draw, the blanket rule decides by hand class with a fixed 0.42 floor and hardcoded class folds and jams.

## What it does

Code: `server/src/engine/HorseHoldemV66RaisedOnePairIsPriced.ts`, read in `HorseLogic.decidePostflop` only when `opts.v66BetRaisedOnePairIsPriced === true`. The spot is priced by `EV(call) > EV(fold) = 0` against the raiser's narrowed, combo-weighted line range: no fixed floor, no hardcoded class fold or jam, no `fastRandom`, independent of `v66BetRaisedOnePair`.

Scope: single-board two-card NLH flop and turn, bet-then-raised, one pair or bluff-catch class without a real draw. Not the river, real draws, two pair, sets, multiway spots, Omaha (PLO4/5/6, hi-lo), multi-board or bomb pots. Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## Receipts

`v66_bet_raised_one_pair_priced_call_taken`, `v66_bet_raised_one_pair_priced_fold_taken`, `v66_bet_raised_one_pair_priced_unpriced` (registered in `HorseDataLedger.ts`).

## Tests

`server/src/engine/HoldemV66RaisedOnePairIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-HoldemV66RaisedOnePairIsPriced.md`): default-off bit-invariance across NLH cash, MTT, Lightning and the Omaha games; on, the spot is priced by EV with no floor, class fold, class jam or randomness; no reach outside its scope.

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered) of the code in this bundle: FAIL (r1, below).
- League re-grade of the repaired code: PASS (r2, below). That code is not in this bundle.
- Replay on real audited decisions (Criterion 5): no evidence. The lane's 2026-11-23 replay of this option changed no judged decision (fixed 0, newly wrong 0); it is recorded as NOT RUN below because the scorer refuses an option named in `OPTION_SWITCH_REFUSED` and the run was made on a scratch copy.
- Decided-spot telemetry (Criterion 2): met in the lane's 2026-11-23 count for the bundle's options; the count's output is in the lane folder, not in a grade folder.

## Grades

Evidence root: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/`. Arms: A `{ v66BetRaisedOnePair: true, v66BetRaisedOnePairIsPriced: true }` vs B `{ v66BetRaisedOnePair: true }`; 4 PRIMARY 6-max cash seeds, 4 GUARD heads-up seeds, 1 CONTROL seed, 6,000 pairs per seed.

- r1, `v66-priced/` (2026-11-22, pinned HEAD `718b241650df`, criteria sha256 `a121152a446667d9d99f4674defc62cef56cf9f4cd096c31d5ada56e7f809dbf`, `results.jsonl` sha256 `54da4fbb81350beae218439b12ea61bee5786ceb66b7f789a43628099ecde7fa`): **FAIL**. PRIMARY inverse-variance pooled `+1.258 +/- 0.671 bb/100` (`z = +1.874`); the failing bar was the guard: heads-up seed `20261124` at `-11.326 +/- 5.128 bb/100` (`z = -2.208`). This is the code in this bundle.
- r2, `v66-priced-r2/` (2026-11-22 to 23, root-cause fix pinned at `b34d999f6bbc`, fresh seeds `20261201` to `20261204`, criteria sha256 `0231cb05aafd8aba59bb1c5af57ef86b7fe5d91413dfacdca4154b099544adbc`, `results.jsonl` sha256 `9afc302b55c9e73e9345fc160fd5133fe2d90dc6a1d8eafd054cf653211cf0ee`): **PASS**. PRIMARY inverse-variance pooled `-0.438 +/- 0.732 bb/100` (`z = -0.599`, inside the "not worse" bar); worst guard cell heads-up seed `20261203` at `-4.828 +/- 5.542` (`z = -0.871`). Commit `b34d999f6bbc` is local to the lane (bundle 3) and is not an ancestor of this bundle.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-25 no replay of v66BetRaisedOnePairIsPriced on real audited decisions is recorded through the registered scorer; the pre-registered Criterion 5 waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- The code here failed its own grade. It must not be registered for switch-on as it stands: the r2 repair has to land first and be graded on the tree that ships.
- Both grades are offline Horse-against-Horse league play with empty solver stores; no human field and no live decision has seen the option.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: v66BetRaisedOnePairIsPriced docs/horse-option-authority.d/v66BetRaisedOnePairIsPriced.md sha256 <64 hex>`, roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set v66BetRaisedOnePairIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>`. Off is byte-identical to the base brain (law test); no data migration.
