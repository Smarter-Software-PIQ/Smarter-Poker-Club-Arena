# omahaFlopDefenceIsPriced: authority for the live switch

Built 2026-11-18 by the WooWoo audit lane FLOP-DEFENCE on top of the PLO Strategy batch (omahaFlopFacingBetEv and its realization fit). This file does not authorize switching the option on: no owner order to switch it on is recorded here. It records what the option is, what was measured and what must pass first.

## What it does

PLO4/PLO5 cash, one board, high only, no bomb pot, not Lightning, not fixed limit, on the FLOP, heads-up, facing the first bet of the street (no raise, no caller, nobody behind, not all in) with chips behind: the fold or call becomes the flop expected-value verdict of `HorseOmahaFlopFacingBetEv.ts` (the exact hand on its sampled runouts against the bettor's value region and his other holdings at a non-value share moved by his read), with the call priced as a two-street game tree on those same runouts (`server/src/engine/HorseOmahaFlopDefenceTree.ts`) in place of equity x a realization factor:

- He barrels the turn and bets the river at his measured rates: the per-street read (`HorseMind.omahaStreetReadOf`, bet.turn / bet.river) shrunk toward his kind's measured rate (`omahaPricedKindPrior`: persons 0.343 / 0.319, Horses 0.403 / 0.363, 5,379 hands) with the one priced shrink.
- His later betting ranges keep the measured odds of non-value to value of his classified bets (archive woowoo-analysis/VALUE-BLUFF.md section 1, n 340 / 227 / 141 flop / turn / river bets): turn over flop 0.885, river over turn 0.680; his checking range is the rest of his range.
- Sizes 0.73 pot (his measured turn barrel after a called flop bet, ATTRIBUTION 1.4, n 81; the river uses the same figure, stated). Every later wager is bounded by the smaller stack behind.
- The Horse answers each later bet by its price on the cards it can see (call when the call pays on the turn card's runouts, else fold; on the river with the river card known). Every fold in the tree is a priced fold.
- The margin is the verdict's own (2% of the final pot). No threshold on bet size, hand class, position or account.

A raise is not decided here: the priced raise owners (`omahaDrawRaiseIsPriced`, `omahaPressureIsPriced`) run after this rule and see its call. The value of a pot raise on the same runouts (he folds at his measured fold to a flop raise: persons 0.15, Horses 0.61, ATTRIBUTION 3.1 / 3.3; the folded share leaves his range from its non-value side; his re-raise unpriced, so an upper bound) is measured beside the call and reported by receipt only.

Stands alone: with `omahaFlopFacingBetEv` off, only the spot above is answered and every other flop decision is exactly as with both off; with `omahaFlopFacingBetEv` on, the tree replaces that verdict's realization in the same spot and changes nothing else. Off (unset, false or any non-`true` value) is byte-identical.

Left out (each makes the call worth more, so the tree is conservative): the Horse's own bet when checked to (float, probe, river bluff), the Horse's raise. Left out the other way: his check-raise of a Horse bet (the Horse never bets in the tree) and his re-raise.

Default OFF in source (read `=== true`), `OPTION_SWITCH_RELEASE_DEFAULT_OFF`. The switch-list migration is not part of this build (the integrator regenerates it). On live only by an option-switch row whose note cites this file and its sha256.

## The owner's orders it rests on

- 2026-11-17 (recorded verbatim in the lane rules, SUCCESSOR-LANE-RULES.md rule 4): "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS".
- 2026-11-16 (verbatim as recorded in `omahaFlopFacingBetEv.md`): "THE SIZE OF THE BET SHOULD NOT MAKE OR BREAK THE DECISION, THE DECISION NEEDS TO BE MADE ON THE HAND, AND THE MATH AND THE OPPONENTS RANGE AND OTHER FACTORS NOT JUST "IF ITS A BIG BET" ITS ALMOST ALWAYS A BIG BET!"

Neither is an order to switch this option on.

## What it answers

Live 24 h to 2026-11-18 07:30Z (archive repairs/LIVE-VERIFY/DAILY/2026-11-18.md, RESULTS-BASELINE.md): heads-up, Horses fold 57% (n 49) to a person's first flop bet of 0.60-0.85 pot against a 43% break-even; 51.6% (n 128) to about 0.75 pot. Measured cause (archive repairs/FLOP-DEFENCE/ATTRIBUTION.md): a flop call is worth what the turn does with it (he fires the turn 58% after a called flop bet), which a single realization factor cannot see.

Recorded hands in the tests (anonymised recorded flop decisions of `HorseOmahaFlopFacingBetEv.test-support.ts`): 59848622 (a fold the audit judged wrong; the flop verdict alone keeps it, the tree calls), 59868806 and 59870825 (calls the flop verdict alone folds; the tree calls), 59833693 and 59831538 (stay folds, reported), 59727433 (multiway: unchanged).

## Receipts

omaha_flop_defence_priced_call, omaha_flop_defence_priced_fold (every time the tree answers), omaha_flop_defence_priced_changed (alone, it differed from the answer it was given), omaha_flop_defence_raise_priced_higher (measurement only). A failure fires omaha_strategy_rule_failed and keeps the decision it was given.

## Tests

`server/src/engine/HorseOmahaFlopDefenceTree.test.ts`: the range by street (the measured compositions reproduced, his checking range completes his range), rates moved continuously by his read, the nuts and air bounds, nothing behind, the barrel rate priced in (monotone), the raise measured and never moving the call, refusal of unreadable rows; recorded spots through the verdict and `HorseLogic.decide`: option off byte-identical, outside the spot unchanged alone and with the flop verdict, alone equal to both on in every recorded heads-up first-bet spot, a recorded fold becoming a call of the exact chips, Lightning and fixed limit outside.

## Evaluation

Declared before the run: archive repairs/FLOP-DEFENCE/EVAL-DECLARATION-v2.md (with its sha256). Result: archive repairs/FLOP-DEFENCE/EVAL-RESULTS-v2.md. The league cards `plo4/plo5_omaha_flop_defence_is_priced` and `_on_flop_ev` are registered and not run by this lane.
