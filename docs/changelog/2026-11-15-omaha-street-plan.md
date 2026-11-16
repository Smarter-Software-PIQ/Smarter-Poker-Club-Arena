# Omaha street plan, first layer: a turn bet is priced with the river planned

Date: 2026-11-15. Lane: PLO Strategy. Owner instruction 2026-11-15 11:43 America/Chicago (Horses must think about future streets, have a plan for each response and each card, understand ranges, protect and grow the stack). One new option, off by default (read `=== true`): `omahaStreetPlan`.

## What happened

In hand 59521326 a Horse bet 373 into 669 with the nut straight on the turn card that paired the board, leaving 0.37 of the pot behind, then folded the river with 700 of 1,224 in. In hand 59517323 a Horse bet aces on three streets out of position and paid off the river. Today's sweep counted 15 voluntary stack-offs, 7 of them drawing dead or to 4 outs or fewer.

## Root cause

Each street is decided alone from an equity bar. The commitment rules read the money already in; none asks, before the bet, what the Horse will do on the next card or against a raise.

## What changed

`server/src/engine/HorseOmahaStreetPlan.ts` (pure, no engine random number): for a heads-up PLO4/PLO5 cash turn decision facing no wager it prices the check and the bet as whole lines: the opponent's fold / call / raise shares (range by his line, measured tendencies, a population prior otherwise), every unseen river card exactly, and the Horse's own planned river action on each. `HorseLogic.omahaStreetPlanRules` (wager_rules node) turns the bet into a check when the check line is worth more by 2% of the pot, and attaches the plan to the decision. On the river, facing a bet after that turn bet was called, the plan is recomputed from the public history and, where it calls, the paired-board fold stands aside. Receipts `omaha_street_plan_line_changed`, `omaha_street_plan_commit_avoided`, `omaha_street_plan_followed`. The worker receipt validator admits the check only where the plan, re-run on the request with the tendency multipliers the decision records and the facing-bet veto at its strongest, prices the check above the bet.

On the recorded hands: 59521326 turn, check 84 chips against bet 14 (the bet commits 57% of the stack with a plan for 58% of rivers): the plan checks; had the bet been made, the plan calls the river that came. 59517323 turn, bet 232 against check 191: the engine's decision stands.

## Not built

The flop (the turn planned one street ahead), the preflop stack-to-pot check, multiway pots, decisions facing a bet, and proposing a bet where the engine checked. The range model, the card impact and the facing-bet verdict are simple fallbacks behind three seams for the sibling layers.

## Verification

`HorseOmahaStreetPlan.test.ts` (recorded hands as fixtures). Unset or false the brain decides as before (tests; base decision digest unchanged). No league evaluation has been run; the option stays off.
