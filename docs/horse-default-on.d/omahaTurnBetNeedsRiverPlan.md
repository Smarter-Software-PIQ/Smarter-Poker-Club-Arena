# omahaTurnBetNeedsRiverPlan (lane owner 2026-11-15, hand 59521326; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

In hand 59521326 a Horse bet 373 into 669 on the turn, leaving 524 behind a pot of 1,415, with a hand its own paired-board fold then folded on the river: it put 700 in and folded. A turn bet that leaves less than half the resulting pot behind is the stack decision.

This option (`omahaOopCheckRules` in `HorseLogic.ts`; `omahaTurnBetShortBehind` and `omahaTurnBetLacksRiverPlan` in `server/src/engine/HorseOmahaOopChecks.ts`) acts on a heads-up turn bet (not an all-in) after which the smaller stack is under 0.5 of the pot the called bet makes. It enumerates every unseen river card and asks one function, `omahaRiverShoveFoldVerdict`, whether the Horse's own river fold rules would fold to an all-in for what is left: the paired-board fold (with its price exception when that option is on), then the big-bet tier as the river decision asks it (`v81Cell`, `v86OmahaUnderboatOrDominatedFold`). When more than 35% of the rivers fold, the bet becomes a check. That function is the single seam `omahaFacingBetEv` is to replace.

## Input fidelity

Status: MET

Public state and the Horse's own cards only. No opponent read, no Monte Carlo, no random number; exact enumeration of at most 47 river cards. Measured on the anonymised hand: mean decision time 1.67 ms without and 2.25 ms with the option (16 seeds, one run on a loaded machine).

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
- In this geometry the all-in is under half the pot, below the smallest wager any big-bet cell folds to (0.58 pot; V81 needs 0.9), so the big-bet tier is asked and cannot fold today, and the verdict does not depend on the two opponent-memory values it reads. The receipt validator replays the same function with every rule on; that replay is exact up to the option state.
- The reference decision's own equity fold (a Monte Carlo estimate) is not asked. Measured on a third-nut flush on an unpaired board in this geometry: the real river decision folded 0 of 31 non-pairing rivers to the all-in, and the rules fold only the 12 rivers that pair the board (28%), so that bet stands.
- A law in the test file: every river the look-ahead counts as a fold is folded by the real river decision (hand 59521326, every river card).
- With `omahaPairedBoardFoldRespectsPrice` on, a straight on a paired turn has a river plan at such prices and the bet stands.
- Live behaviour is unverified: the option is off.
