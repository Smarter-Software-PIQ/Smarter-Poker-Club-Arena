# Omaha street plan: the flop, the turn three-way and the preflop stack-to-pot plan

Date: 2026-11-16. Lane: PLO Strategy. Owner instruction 2026-11-15 11:43 America/Chicago (Horses always think about future streets, plan ahead, protect and grow the stack) and 11:39 (no blanket rules; owner-ruled checks and folds are final). Three new options, each off by default (read `=== true`): `omahaStreetPlanFlop`, `omahaStreetPlanThreeWay`, `omahaPreflopStackPlan`.

## What was missing

The first layer of the street plan (`omahaStreetPlan`) planned only a heads-up turn bet. A flop bet was still decided alone, a preflop call did not ask what stack-to-pot ratio it creates, and the turn plan stood aside whenever two opponents were in.

## What changed

All three live in `server/src/engine/HorseOmahaStreetPlan.ts` (no new module; no engine random number).

- Flop (`omahaStreetPlanFlop`): a heads-up PLO4/PLO5 flop bet facing no wager is priced against the check, and against the smaller sizes of the engine's own menu, as a two-street line: the opponent's fold / call / raise, the turn card by texture class (eight representative cards weighted by their exact share, each good / neutral / bad), the planned turn action on each class with the turn layer's line model, and eight sampled rivers under each turn card. A line that commits the stack (stack-to-pot after the call at or under 1.5) with a hand that folds to the expected raise or continues on under 65% of turn cards is not made; otherwise the bet stands only when it beats the check by 2% of the pot. Only bet -> check or a smaller bet; never a raise. The owner's flop checks act first and are final.
- Turn three-way (`omahaStreetPlanThreeWay`): exactly two live opponents, each with his own independent range and tendency; the bet wins at once only when both fold, otherwise it must beat every caller on every river card. Bet -> check when the check line is worth more by 2% of the pot.
- Preflop (`omahaPreflopStackPlan`): a call of a raise heads-up against the raiser that creates a stack-to-pot ratio under 3 is priced as the stack it commits, with a charge from the hand's playability (nut-making or one-pair-making, position). A negative value folds the call; nothing else changes. The day's 3-bet / 4-bet options keep precedence.

Receipts: `omaha_street_plan_flop_checked`, `_commit_avoided`, `_resized`, `omaha_street_plan_three_way_checked`, `omaha_preflop_stack_plan_folded`, each with a `_vetoed` twin. The worker receipt validator admits the flop and three-way checks only where the plan, re-run on the request, checks.

## Verification

`HorseOmahaStreetPlanLayers.test.ts` (class-based, recorded spots re-dealt, many seeds) and the precedence laws (cash and tournament) with the options on. Unset or false the decision digest is unchanged (b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1). The constants are unmeasured and no evaluation has been run; the options stay off.
