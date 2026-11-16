# omahaStreetPlanThreeWay: authority for the live switch

The Omaha street plan's turn layer for exactly two live opponents (HorseOmahaStreetPlan.ts). Evidence NOT MET.

## What it does

PLO4/PLO5 cash (a tournament hand only inside omahaStrategyInTournaments' scope), one board, high only, not a bomb pot, exactly two live opponents, neither all in. Before a TURN bet facing no wager each opponent gets his OWN range (an independent fixed sample of 64 hands filtered by his own flop line with the first layer's keep shares) and his own measured tendency multipliers, and answers the bet on his own (fold / call / raise by the turn layer's priors). The bettor wins the pot at once only when BOTH fold; otherwise it must beat every caller at showdown: on every unseen river card, exactly, the Horse's share against both callers is the product of its shares against each. After a raise it prices calling the raiser heads-up; checking out of position it prices calling the bettor heads-up. The bet becomes a check when the check line is worth more by 2% of the pot (streetPlanMarginPotShare, the first layer's).

Precedence: inside the owner-ruled chain (omahaOwnBetRules), after the owner-ruled checks; checked again in omahaOwnerRuledFinal for a later rule's wager; never a nut-class wager. No engine random number.

## The owner's orders it rests on (verbatim, as relayed in the build order)

- 2026-11-15 11:43 America/Chicago: "HORSES SHOULD ALWAYS BE THINKING ABOUT FUTURE STREETS… PLAN AHEAD… PROTECT AND GROW THERE STACK…"
- 2026-11-15 11:39 America/Chicago: no blanket rules; the decision is hand, player, price and pot dependent. Owner-ruled checks and folds are final.

## Receipts

omaha_street_plan_three_way_checked; vetoed twin omaha_street_plan_three_way_checked_vetoed. The receipt validator admits the turn bet -> check only with the request, where the plan re-run on it with the recorded multipliers gives the check (omahaStreetPlanThreeWayAdmitsCheck).

## Tests

HorseOmahaStreetPlanLayers.test.ts; HorseOmahaStrategyPrecedence.test.ts and its tournament twin.

## Evidence rows

- Mechanism, scope, visibility (flag row and receipts in HorseDataLedger.ts), tests: MET on the branch.
- Option unset: decisions identical to the base (decision digest, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1).
- Value, continuation, reach: NOT MET. The constants are unmeasured (population priors and owner-order readings, not fitted); evaluation NOT RUN. The league cards are declared, not run.

Default OFF in source (read `=== true`). Not registered in the live switch: no option-switch migration was generated with it.

## Limits

No river betting three-way (a river is a showdown). Card overlap between the two opponents' hands is ignored (independent ranges). No side pots: the bet is capped at the larger opponent stack. The river follow of the first layer is heads-up only.
