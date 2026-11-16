# omahaStreetPlan (owner instruction 2026-11-15 11:43 America/Chicago; branch agent/plo-streetplan-01BbZPDi/feat/omaha-street-plan, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

`server/src/engine/HorseOmahaStreetPlan.ts` prices a heads-up turn bet facing no wager against the check as whole lines: opponent fold / call / raise shares, every unseen river card exactly, and the Horse's planned river action on each; a river the plan folds is worth bet-then-fold. `omahaStreetPlanRules` (HorseLogic.ts, wager_rules node, after the paired-board river check) turns the bet into a check when the check line is worth more by 2% of the pot. On the river after that bet was called, the plan is recomputed from the public history; where it calls this card for this bet or less, the paired-board fold stands aside.

## Input fidelity

Status: MET

The Horse's own cards, the board, the public action history, stacks and pot, and the opponent memory's decayed counters when measured (a presumed read is never used). The opponent hands are a fixed 160-hand sample from a private generator keyed by the Horse's cards and the board; the engine's seeded random stream is not read or advanced.

## Value

Status: NOT MET

Not measured. No evaluation protocol has been declared. The opponent response shares and range shares are population priors chosen for this first layer, not fitted.

## Continuation

Status: NOT MET

Not measured. The river after a planned turn bet follows the plan only where the paired-board fold would have folded; other river rules are unchanged.

## Reach

Status: NOT MET

Not counted in production. In the simulator the reach is the three receipt counts per evaluation cell.

## Scope

Status: MET

PLO4 and PLO5 cash, pot limit, one board, high only, heads-up, turn bet facing no wager, and the river facing a bet after that turn bet was called. Decision-level cases in `HorseOmahaStreetPlan.test.ts` on three anonymised recorded hands: off byte-identical; the board-pairing turn bet with the nut straight becomes a check; the aces turn bet stands; the flop, preflop, multiway and facing-a-bet nodes are byte-identical; the check and the river call are admitted by the worker receipt validator.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_street_plan_line_changed`, `omaha_street_plan_commit_avoided`, `omaha_street_plan_followed`. The decision carries the bounded plan record (`streetPlan`). League cards `plo4_omaha_street_plan` and `plo5_omaha_street_plan`.

## Limits

Status: MET

- First layer: no flop plan, no preflop stack-to-pot check, no multiway pot, no decision facing a bet, and it never proposes a bet where the engine checked or a different size.
- The opponent's raise is one pot-sized raise with no later betting; the check line's river after a turn bet from him is priced, not planned card by card.
- The range model, card impact and facing-bet verdict are fallbacks behind three seams for the shared layers.
- About 40 ms per planned decision on the evaluation machine under load.
- Live behaviour is unverified: the option is off.
