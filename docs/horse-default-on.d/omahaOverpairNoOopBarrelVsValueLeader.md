# omahaOverpairNoOopBarrelVsValueLeader (owner ruling 2026-11-15 11:04 America/Chicago, hand 59517323; branch agent/plo-pairedriver-01BbZPDi/fix/omaha-paired-river-no-thin-lead-vs-value-leader, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

In hand 59517323 the Horse, out of position with aces in a 4-bet pot, bet the 5-8-9 flop, was called, and bet the turn 233 into 555 with the same one pair and the nut flush draw it had picked up. Owner ruling: called on the flop and not improved, the turn is a check; the nut flush draw does not change that. The turn bet comes from three branches of `HorseLogic.ts` depending on the equity draw: the thin-value branch (0.36 to 0.46 of the pot), the strong-value branch capped at half the pot by the V40 small-ball rule, and the flop/turn bluff baseline's pair-plus-draw barrel (0.63 to 0.88 of the pot). Position enters them only as a frequency or realisation factor.

This option (`omahaOopCheckRules`; spot `omahaOverpairOopTurnBarrelSpot` in `server/src/engine/HorseOmahaOopChecks.ts`) turns the turn bet into a check when the pot is heads-up, the opponent acts behind and called the Horse's flop bet, the Horse's made hand is exactly one pair (draws are not read), a straight is possible on the board, and the opponent is a measured postflop value leader.

## Input fidelity

Status: MET

Public state, the Horse's own cards and the opponent memory's decayed counters of the opponent, read through `HorseMind.omahaReadConditionalOf`.

## Value

Status: NOT MET

Not measured. No league or production evaluation has been run for this option. The evaluation is to be declared in the evidence archive (`plo-handoff-review-01a1cbbd/pairedriver-20261115/`) before any graded run, and its verdict recorded in `docs/changelog/2026-11-15-omaha-oop-bets-that-become-checks.md`.

## Continuation

Status: NOT MET

Not measured as value. On the anonymised hand, after the check the Horse never folds to a turn bet of a third of the pot up to the pot (it raises or calls; pinned in the test).

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the receipt count per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, turn, heads-up, nothing to call, check legal. Two pair or better still bets; in position the Horse plays as today. Decision-level cases in `HorseOmahaOopChecks.test.ts`.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_overpair_oop_turn_barrel_checked` and `omaha_overpair_oop_turn_barrel_withheld`. League cards `plo4_omaha_overpair_no_oop_barrel_vs_value_leader` and `plo5_omaha_overpair_no_oop_barrel_vs_value_leader`.

## Limits

Status: MET

- The made hand is the engine's category: exactly one pair, whichever pair (an overpair, top pair or a lower pair). High card (a pure bluff barrel) is left to the bluff policy; two pair is left betting.
- "Connected" is the engine's board shape: three board ranks inside a five-rank window.
- Heads-up only.
- Live behaviour is unverified: the option is off.
