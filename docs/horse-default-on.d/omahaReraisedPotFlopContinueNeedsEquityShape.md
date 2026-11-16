# omahaReraisedPotFlopContinueNeedsEquityShape (owner instruction 2026-11-15 11:55 America/Chicago; branch agent/plo-3betdef-01BbZPDi/fix/omaha-elite-continues-vs-measured-wide-three-bettor, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Owner: calling a 4-bet pays only when the hand makes the nuts or flops a pair with a nut draw; the caller wants pairs with straight or flush draws on the flop and only then continues.

The rule (`omahaReraisedFlopContinueCell` in `server/src/engine/HorseOmahaOopReraisedPot.ts`, applied outermost on both decision paths in `HorseLogic.ts`): on the flop of a pot raised twice or more preflop in which the Horse did not make the last preflop raise, a call or raise facing a wager stands only with

- two pair or better of its own (`omahaNutStatus` category; the board's pair plus one pair, `omahaMadeClass` `board2p`, counts as one pair); or
- one pair with a nut-leaning draw (`omahaDrawQuality`): the nut flush draw, or 8 or more straight outs of which 4 or more make the nut straight; or
- a strong draw without a pair: 8 or more outs to a nut-class hand (`omahaNutClassOuts`), or a flush draw together with 8 or more straight outs; or
- a call costing under 10% of the resulting pot.

Otherwise the continue becomes a fold. The Horse's own bets when checked to are untouched. No random draw.

Recorded node: hand 59518335, the button called a 4-bet with Q-Q-8-7-4 and on K-10-6 rainbow called 69.5 bb into 419.5 (14% of the resulting pot) with an underpair and no draw; the cell folds it.

## Input fidelity

Status: MET

Public state and the Horse's own cards. The recorded case replays the public action of the production hand.

## Value

Status: NOT MET

Not measured. The declared paired evaluation is still to be written and run.

## Continuation

Status: NOT MET

Not measured. The turn and river are not covered by this rule.

## Reach

Status: NOT MET

Not counted, in production or in a census.

## Scope

Status: MET

PLO4 and PLO5 cash, high only, one board, the flop, a pot raised twice or more preflop that the Horse called, facing a wager, in either position. Tests in `HorseOmahaOopReraisedPot.test.ts`: the cell on each class of holding and its scope, and the recorded node in the decision (unset and false byte-identical; on, the continue folds and nothing else moves; a pair with the nut flush draw in the same spot is kept).

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_reraised_flop_continue_folded` and `omaha_reraised_flop_continue_kept`. League cards `plo4_omaha_reraised_pot_flop_continue_needs_equity_shape` and `plo5_omaha_reraised_pot_flop_continue_needs_equity_shape`.

## Limits

- A set or two pair on a board where a straight or flush is already possible continues; the made-hand rules for those boards are other options.
- The outs thresholds are declared, not fitted.
- A raise is folded like a call when the hand has no equity shape: a pure bluff raise in a re-raised pot is removed with it.
- Live behaviour is unverified: the option is off.
