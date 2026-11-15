# omahaStrongHandValue (owner instruction 2026-11-15 12:16 America/Chicago; branch agent/plo-playbook-01BbZPDi/feat/omaha-strong-hand-value, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Owner: add the earlier all-hands playbook's entries that are ready for PLO. Its PLO4/PLO5 cash entries flag 336 river decisions with a full house (study cut-off 2026-11-06). Replayed through today's brain: the full house checked with players behind still checks in 105 of 145; the full house facing a bet still only calls in 46 of 55, 20 of them a raise the river nut-raise rule turned into a call; the full house checked to now always bets half the pot, whatever the count of better hands (lane archive `plo-handoff-review-01a1cbbd/playbook-binding-20261115/BINDING.md`).

With the option on, `omahaStrongHandValueRule` (`HorseLogic.ts`, the last rule of the wager_rules node and the outermost outside the graph) prices, on the river with a full house or better or a nut-class hand: (a) a check against every value bet against each opponent left (`HorseOmahaCardImpact` pricing, combined across opponents with the field defending the minimum-defence share together); (c) with a player still to act the check is kept only when it is worth more than every value bet; (b) a call facing one bettor, nobody else in the hand, against every value raise on the exact count of the holdings that continue (`HorseOmahaFacingBetEv` counts and EV(call)), raised when it is a value raise worth more than the call by 4 percent of the pot. Module `server/src/engine/HorseOmahaStrongHandValue.ts`.

## Input fidelity

Status: MET

Public state, the Horse's own cards, known dead cards and the opponent memory's measured reads (`HorseMind.omahaReadConditionalOf`, `HorseMind.omahaFacingBetEvReadOf`). The hand counts are exact; the opponent range is the card-impact module's deterministic sample. No random number is drawn.

## Value

Status: NOT MET

Not measured. No league evaluation has been run. On 26 recorded study decisions (tests) the changed actions and their numbers are stated against an unknown opponent; that is a mechanism check, not a result.

## Continuation

Status: NOT MET

River only. After a check the Horse only calls a bet (no check-raise is priced).

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the `omaha_strong_hand_value_bet` / `_value_raise` / `_induce_check` receipt counts per cell.

## Scope

Status: MET

PLO4 and PLO5 cash, high only, one board, not a bomb pot, the river, a full house or better or a nut-class hand, today's answer a check (nothing to call) or a call (one bettor, nobody else in the hand, the bettor not all in). Tournaments are out (chip EV is not prize EV). A hand below a full house that is not nut class is never touched. Unset, false and a truthy non-boolean are byte-identical to today on every recorded node (tests).

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_strong_hand_value_bet`, `omaha_strong_hand_value_raise`, `omaha_strong_hand_induce_check`.

## Limits

Status: MET

- The multiway combination treats the opponents' ranges as independent (no joint card removal).
- The raise response is the minimum-defence share of his betting range moved by his measured river call rate, not a measured response.
- With the option on it reopens the river nut-raise rule (owner 2026-11-14) for a full house a bigger one beats, where the count says raise: turning it on needs the owner's word as well as a passed evaluation.
- A bet today's brain already makes is not re-priced.
- Live behaviour is unverified: the option is off.
