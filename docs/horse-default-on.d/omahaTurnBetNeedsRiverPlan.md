# omahaTurnBetNeedsRiverPlan (lane owner 2026-11-15, hand 59521326; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

In hand 59521326 a Horse bet 373 into 669 on the turn, leaving 524 behind a pot of 1,415, with a hand its own paired-board fold then folded on the river: it put 700 in and folded. A turn bet that leaves less than half the resulting pot behind is the stack decision.

This option (`omahaOopCheckRules` and `omahaTurnBetLacksRiverPlan` in `HorseLogic.ts`; geometry `omahaTurnBetShortBehind` in `server/src/engine/HorseOmahaOopChecks.ts`) acts on a heads-up turn bet (not an all-in) after which the smaller stack is under 0.5 of the pot the called bet makes. It enumerates every unseen river card and asks the Horse's own fold rules whether they would fold to an all-in for what is left: the paired-board fold (with its price exception when that option is on) and, where that does not fold, the big-bet call folds (`omahaBigBetCallFold`). When more than 35% of the rivers fold, the bet becomes a check.

## Input fidelity

Status: MET

Public state and the Horse's own cards only. No opponent read, no Monte Carlo, no random number; exact enumeration of at most 47 river cards. Measured on the anonymised hand: mean decision time 1.82 ms without and 2.40 ms with the option (16 seeds, one run on a loaded machine).

## Value

Status: NOT MET

Not measured. No league or production evaluation has been run. The evaluation is to be declared in the evidence archive (`plo-handoff-review-01a1cbbd/pairedriver-20261115/`) before any graded run.

## Continuation

Status: NOT MET

Not measured as value. After the check the Horse faces the turn bet under today's rules (on the anonymised hand: all in over a third of the pot, folded by the paired-board fold to half the pot or more).

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, turn, heads-up, nothing to call. A bet that leaves half the pot or more behind, an all-in bet, a raise facing a wager and multiway pots are unchanged. Decision-level cases in `HorseOmahaPairedFoldPriceAndRiverPlan.test.ts`.

## Visibility

Status: MET

Receipt in `HorseDataLedger.ts`: `omaha_turn_bet_without_river_plan_checked`. League cards `plo4_omaha_turn_bet_needs_river_plan` and `plo5_omaha_turn_bet_needs_river_plan`.

## Limits

Status: MET

- The 0.5 and 35% thresholds are stated, not fitted.
- The river question is a shove for exactly what is left after a river check; other river lines are not asked.
- The receipt validator re-runs only the geometry (turn, heads-up, under half the pot behind), not the river enumeration.
- With `omahaPairedBoardFoldRespectsPrice` on, a straight on a paired turn has a river plan at such prices and the bet stands.
- Live behaviour is unverified: the option is off.
