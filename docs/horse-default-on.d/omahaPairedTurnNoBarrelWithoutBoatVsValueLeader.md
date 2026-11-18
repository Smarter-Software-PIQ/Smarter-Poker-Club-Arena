# omahaPairedTurnNoBarrelWithoutBoatVsValueLeader (lane owner 2026-11-15, hand 59521326; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

In hand 59521326 (PLO5 cash) a Horse out of position check-raised the 2-4-5 flop to 290 with the nut straight, was called, bet 373 into 669 on the turn card that paired the board (leaving 524 behind a pot of 1,415), was called, checked the river and folded the straight to the all-in. The turn bet is the strong-value branch of `HorseLogic.ts` (equity 0.58 to 0.72 against a bar of 0.58 after the low stack-to-pot shift; the hand reads as nut class and vulnerable). The 2026-11-06 paired-board check acts only on the river. The river fold is the 2026-10-25 paired-board fold (`plo_paired_board_fold`), which overrode the reference decision's call: the engine's own equity was 0.50 to 0.58 against a price of 0.213.

This option (`omahaOopCheckRules` in `HorseLogic.ts`; spot `omahaPairedTurnBarrelSpot` in `server/src/engine/HorseOmahaOopChecks.ts`) turns the turn bet into a check when the pot is heads-up, the opponent acts behind and called the Horse's flop bet or raise, the turn card pairs the board, the Horse holds less than a full house, and the opponent is a measured postflop value leader (`HorseOmahaReadConditional.ts`; a presumed read never counts).

## Input fidelity

Status: MET

Public state, the Horse's own cards and the opponent memory's decayed counters of the opponent, read through `HorseMind.omahaReadConditionalOf`.

## Value

Status: NOT MET

Not measured. No league or production evaluation has been run. The evaluation is to be declared in the evidence archive (`plo-handoff-review-01a1cbbd/pairedriver-20261115/`) before any graded run.

## Continuation

Status: NOT MET

Not measured as value. On the anonymised hand, after the check today's brain moves all in over a turn bet of a third of the pot, and the 2026-10-25 paired-board fold folds the nut straight to a bet of half the pot or more (pinned in the test). The check therefore hands the opponent a fold for half a pot; whether that is better than the recorded line is what an evaluation has to measure.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, turn, heads-up, nothing to call, check legal. A full house or better still bets; in position, or when the turn card does not pair the board, the Horse plays as today. Decision-level cases in `HorseOmahaPairedTurnBarrel.test.ts`.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_paired_turn_barrel_checked` and `omaha_paired_turn_barrel_withheld`. League cards `plo4_omaha_paired_turn_no_barrel_without_boat_vs_value_leader` and `plo5_omaha_paired_turn_no_barrel_without_boat_vs_value_leader`.

## Limits

Status: MET

- Every hand below a full house in the spot checks, a bluff included.
- Heads-up only; a board already paired on the flop is not the spot.
- No stack-plan guard: the option does not look at what the bet leaves behind.
- Live behaviour is unverified: the option is off.
- In position, heads-up, on the wider paired-board line (`omahaPairedBoardNoBoatSpot`), the check is decided by a priced comparison run through the card-impact model (`omahaCardImpactDecision`, called by `omahaPairedBoardPricedCheck`), whether `omahaCardImpact` is on or off. That model's response constants are unfitted priors (`omahaCardImpact.md`, Value NOT MET), so the in-position comparison is not measured (stated 2026-11-16, review note N7).
