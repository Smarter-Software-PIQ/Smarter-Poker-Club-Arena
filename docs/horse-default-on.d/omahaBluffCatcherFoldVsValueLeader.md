# omahaBluffCatcherFoldVsValueLeader (owner complaint, PLO Strategy, 2026-11-15; branch agent/plo-bcvl-01BbZPDi/feat/omaha-bluff-catcher-fold-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`), unmeasured. This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until a declared evaluation passes.

## Mechanism

Status: MET

`omahaBluffCatcherRaiseFold` (`omahaBluffCatcherCell`, `server/src/engine/HorseOmahaBigBetCalls.ts`, unchanged) folds a PLO4/PLO5 bluff catcher (two pair, set or trips on a straight- or flush-possible board, non-nut straight, non-nut flush) that is raised 0.9 pot or more on the turn or river, or faces a 0.9-pot+ turn bet from the flop bettor, unless the turn redraw pays the price; a measured postflop over-bluffer keeps the call. It failed its evaluation because it folds on bet size alone and so loses to players who bluff-raise. The owner's complaint is the call against a player who always has it.

This option runs the same cells in the same place (`omahaBigBetCallFold` in `HorseLogic.ts`, after V81 and V84) and keeps the fold only when the player whose bet or raise is faced is a measured postflop value leader (`server/src/engine/HorseOmahaReadConditional.ts`, read through `HorseMind.omahaReadConditionalOf`, `measured` and `valueLeader`): at least 15 decayed hands of his own and the Omaha presumption evidenced or disproved on his counters (a presumed read never counts); at least 8 decayed opportunities both checked to and facing a bet postflop; not over-bluffing; folds to a postflop bet at least, and calls river bets at most, as often as the average Horse. Otherwise the decision is today's. It stands aside while `omahaBluffCatcherRaiseFold` is on, and with the mind off.

## Input fidelity

Status: MET

Public state, the Horse's own cards and the opponent memory's decayed counters of the one player faced (exact context, probe-adjusted).

## Value

Status: NOT MET

Not measured. No evaluation has been declared or run.

## Continuation

Status: NOT MET

Not measured.

## Reach

Status: NOT MET

Not counted, in production or in the simulator. With the mind on, today's brain already folds the recorded river node (hand 59414191 continued), so the river reach in particular is unknown.

## Scope

Status: MET

The bluff-catcher cells' own scope: PLO4 and PLO5 high cash, one board, turn and river, chips behind the call. Decision-level cases in `HorseOmahaBluffCatcherVsValueLeader.test.ts` on the recorded turn node (hand 59416584 with deep stacks, top set raised): unset, false and a non-boolean byte-identical; an unknown, presumed or measured non-value-leader player gives today's decision with the withheld receipt; a measured value leader gives the fold with its receipt; only the player faced is asked; the priced redraw keeps the call; the fold is admitted by the worker receipt validator.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_bluff_catcher_fold_vs_value_leader` and `omaha_bluff_catcher_fold_vs_value_leader_withheld`, beside `omaha_bluff_catcher_raise_fold` and `v81_omaha_big_bet_call_fold`. League cards `plo4_omaha_bluff_catcher_fold_vs_value_leader` and `plo5_omaha_bluff_catcher_fold_vs_value_leader`.

## Limits

Status: MET

- "Value leader" is read from frequencies (bet when checked to, fold to a bet, river call); the counters hold no showdown strength and no raise-specific bluff rate.
- Only the player faced is read; other live players are not.
- The measured over-bluffer exception is the cell's own and is tested at cell level; at the decision level with the mind on today's brain raises such a player at the test node, so that case is not shown there.
- Live behaviour is unverified: the option is off.
