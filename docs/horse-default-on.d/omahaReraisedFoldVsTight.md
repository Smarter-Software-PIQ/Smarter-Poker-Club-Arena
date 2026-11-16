# omahaReraisedFoldVsTight (owner instruction 2026-11-15 01:03 America/Chicago; branch agent/plo-readcond-01Gw7aDt/feat/omaha-read-conditional-defence, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

`omahaReraisedPotDiscipline`'s preflop cell (`omahaReraisedPreflopCell` in `server/src/engine/HorseOmahaReraisedPot.ts`, unchanged) folds a continue facing a 4-bet or more with a hand that holds no pair of aces and no premium structure, unless a committed call pays the price against aces. Its declared evaluation failed because it is right against one kind of 4-bettor and wrong against another: against a seat that 4-bets light it gained (PLO4 +14.94 bb/100), against a loose-aggressive value seat it lost (PLO5 -11.95, z -2.32). The owner's instruction is to play a maniac and a tight player differently and to fix the problem rather than order particular folds.

This option runs the same cell, outermost on both decision paths after `omahaReraisedPotFold` (`omahaReraisedFoldVsTight` in `HorseLogic.ts`), only when the last preflop raiser is a measured tight re-raiser (`server/src/engine/HorseOmahaReadConditional.ts`, read through `HorseMind.omahaReadConditionalOf`): at least 15 decayed hands of his own, the Omaha presumption evidenced or disproved on his counters (a presumed read never counts), not a maniac (`maniacRaiseWidth` null), his re-raise read not engaged high, at least 12 decayed re-raise opportunities, his re-raise rate credibly (0.9 one-sided) at or below the Horse mean for the game and table size, and no recent re-raise burst in the fast window. Against a measured wide re-raiser, a maniac, an unknown or a presumed player the decision is today's. It stands aside while `omahaReraisedPotDiscipline` is on, and with the mind off.

## Input fidelity

Status: MET

Public state, the Horse's own cards and the opponent memory's decayed counters of the 4-bettor, the same counters every exploit read uses (exact context, probe-adjusted). In the league the memory learns during each session (league default); the evaluation protocol states how many hands the reads need to engage.

## Value

Status: NOT MET

Not yet measured. The declared paired evaluation (archive `plo-handoff-review-01a1cbbd/readcond-20261115/PROTOCOL-omahaReraisedFoldVsTight.md`; pass rule: pooled human-field gain more than 2 SE above zero, no cell more than 2 SE below zero, no illegal action or fallback) records its verdict in `docs/changelog/2026-11-15-omaha-read-conditional-defence.md`.

## Continuation

Status: NOT MET

Not measured separately. A preflop fold ends the hand; the paired evaluation's arms include every later street of the hands where the continue was kept or folded.

## Reach

Status: NOT MET

Not counted in production. The reach in the simulator is the fold receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, one board, high only, preflop, facing three or more preflop raises, fold legal (the cell's own scope). Hi-Lo, PLO6, bomb pots, all-in-or-fold tables and tournaments are outside. Decision-level cases in `HorseOmahaReadConditional.test.ts` (PLO4 deep, PLO5 committed): off byte-identical; an unknown, presumed or wide 4-bettor gives today's decision; a measured tight one gives the cell's verdict with its receipt; the real opponent memory reads a non-re-raiser tight and a wide re-raiser, a Horse-like and a sparse player not.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_reraised_fold_vs_tight` (folded), `omaha_reraised_fold_vs_tight_priced_in` (kept on price), `omaha_reraised_fold_vs_tight_withheld` (the 4-bettor was not a measured tight re-raiser). League cards `plo4_omaha_reraised_fold_vs_tight` and `plo5_omaha_reraised_fold_vs_tight`.

## Limits

Status: MET

- The read has no 4-bet statistic of its own; it reads the 3-bet rate (re-raise of a single raise) as the measure of how tight a player's re-raising is.
- At six-handed PLO the Horse mean re-raise rate is about 4.7% and the envelope's low edge is 0, so "well below the Horses" is measured as credibly at or below the mean on 12+ decayed opportunities; in practice that is a player with no re-raise in his recent window.
- The decayed window holds about 44 hands; a tight player who re-raises once loses the read for some hands.
- The declared ranges (aces) are the cell's model, unchanged.
- Live behaviour is unverified: the option is off.
