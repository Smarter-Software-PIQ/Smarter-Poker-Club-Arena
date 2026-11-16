# omahaPairedBoardFoldRespectsPrice (lane owner 2026-11-15, hand 59521326; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

The paired-board fold (`server/src/engine/HorsePloPairedBoardFold.ts` `ploPairedBoardMustFold`, receipt `plo_paired_board_fold`) is the owner's binding rule of 2026-10-25 (`docs/changelog/2026-10-25-plo5-plo6-no-full-house-folds-on-a-paired-board.md`, widened the same evening by `docs/changelog/2026-10-26-paired-board-fold-adds-plo4-and-the-flop.md`): on a hand where a Horse called off 190 chips with two pair when the turn paired the board, "IT'S A FOLD 100% OF THE TIME", and "ADD PLO4 AND PLO5 AND THE FLOP TO THE PAIRED BOARD FOLD RULE". A Horse without a full house or better folds to a committing bet (bettor all in, a quarter of its stack or more, or a call that leaves it all in) unless the required equity is under 15%.

In hand 59521326 that rule folded the nut straight on a paired river to an all-in for the Horse's last 524 into 1,939 (price 0.213) after it had put 700 of 1,224 in; the reference decision was a call on a range equity of 0.50 to 0.58.

This option narrows the rule in PLO4/PLO5 cash only (`ploPairedBoardFoldRespectsPrice`, applied in `pairedBoardFold` in `HorseLogic.ts`): the fold stands aside, and the reference decision stands, when the call price (the call over the pot after it, uncalled excess removed) is at most 0.25 AND the Horse holds a straight or a flush, or the call is for the rest of an effective stack of which it has already put in at least 60% this hand. Two pair, trips and one pair below that 60% still fold, as does every price above 0.25.

## Input fidelity

Status: MET

Public state and the Horse's own cards only.

## Value

Status: NOT MET

Not measured. No league or production evaluation has been run. The evaluation is to be declared in the evidence archive (`plo-handoff-review-01a1cbbd/pairedriver-20261115/`) before any graded run.

## Continuation

Status: NOT MET

The reference decision stands and may still be a fold; the later call-discipline folds still run on it. Not measured as value.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, wherever the paired-board fold acts (flop, turn, river). PLO6, tournaments, Hi-Lo and multi-board pots keep the fold. Decision-level cases in `HorseOmahaPairedFoldPriceAndRiverPlan.test.ts`.

## Visibility

Status: MET

Receipt in `HorseDataLedger.ts`: `omaha_paired_board_fold_price_respected`, beside `plo_paired_board_fold`. League cards `plo4_omaha_paired_board_fold_respects_price` and `plo5_omaha_paired_board_fold_respects_price`.

## Limits

Status: MET

- This narrows a rule the owner declared binding; it must not be switched on without his ruling.
- The hand that prompted the original rule (two pair, a turn all-in at a price of about 0.25, a small share of the stack in) still folds.
- A straight or flush on a paired board loses to every full house; the exception trusts the engine's range model at prices of 0.25 or better.
- Multiway, the uncalled-excess adjustment assumes no other player matches the bet.
- Live behaviour is unverified: the option is off.
