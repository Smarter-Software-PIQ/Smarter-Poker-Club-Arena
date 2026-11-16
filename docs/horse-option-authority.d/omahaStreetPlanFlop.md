# omahaStreetPlanFlop: authority for the live switch

Second layer of the Omaha street plan (HorseOmahaStreetPlan.ts). Evidence NOT MET.

## What it does

PLO4/PLO5 cash (a tournament hand only inside omahaStrategyInTournaments' scope), heads-up, one board, high only, not a bomb pot. Before a FLOP bet facing no wager the Horse prices the bet and the check as two-street lines:

- the opponent's response to the bet (fold / call / raise), his bet after a check out of position: the turn layer's population priors (flop raise 0.10, flop bet 0.40 with 0.5 bluffs per value bet) scaled by his measured tendency multipliers;
- his range by his PREFLOP line: a fixed pool of 160 hands, the top share by preflop percentile kept (aggressor 0.35, called a raise 0.50, called a bet 0.50, checked 0.85), the first 40 used; within it his responses go by flop strength;
- the turn card by CLASS: every unseen card in its texture class (pairs the board / flush / straight / brick), 8 representative cards in all spread over the classes and weighted by each class's exact share; each classed good / neutral / bad by the Horse's equity change (±0.10, the turn layer's rule);
- the planned turn action per class (the turn layer's line model: bet 0.75 pot or check; his fold / call / raise; his bet after a check), with 8 sampled rivers under each turn card priced by the turn layer's river model.

Verdict: a bet line that commits the stack (stack-to-pot after the call at or under 1.5) with a hand that folds to the raise the model expects, or that continues (bets or calls) on fewer than 65% of turn cards, is not made. Of the rest the bet stands only when its line is worth more than the check line by 2% of the pot (streetPlanFlopMarginPotShare); a smaller size of the engine's menu (omahaCardImpactAmounts' fractions 0.33 / 0.5 / 0.66 / 0.75 / 1 of the pot, below the engine's size, not all in) replaces the engine's size only when it beats it by the same margin. Otherwise the check. Only a bet becomes a check or a smaller bet; no raise is created.

Precedence: inside the owner-ruled chain (omahaOwnBetRules). The owner's flop checks (omahaBareOverpairOopFlopCheck: the big pair with the lead out of position) act first and are final; a nut-class wager is never checked or made smaller (omaha_nut_class_wager_kept); a wager a later rule proposes that the flop plan checks is checked again in omahaOwnerRuledFinal (omahaWagerIsChecked). No engine random number: the private generator keyed by the cards and the board.

## The owner's orders it rests on (verbatim, as relayed in the build order)

- 2026-11-15 11:43 America/Chicago: "HORSES SHOULD ALWAYS BE THINKING ABOUT FUTURE STREETS… PLAN AHEAD… PROTECT AND GROW THERE STACK…"
- 2026-11-15 11:39 America/Chicago: no blanket rules; the decision is hand, player, price and pot dependent. Owner-ruled checks and folds are final.

## Receipts

omaha_street_plan_flop_checked, omaha_street_plan_flop_commit_avoided, omaha_street_plan_flop_resized; vetoed twins omaha_street_plan_flop_checked_vetoed, omaha_street_plan_flop_commit_avoided_vetoed, omaha_street_plan_flop_resized_vetoed (a receipt fires only when its verdict is the final action).

The receipt validator admits the flop bet -> check only with the request, where the plan re-run on it with the multipliers the decision records gives the check (omahaStreetPlanFlopAdmitsCheck).

## Tests

HorseOmahaStreetPlanLayers.test.ts; HorseOmahaStrategyPrecedence.test.ts and its tournament twin.

## Evidence rows

- Mechanism, scope, visibility (flag row and receipts in HorseDataLedger.ts), tests: MET on the branch.
- Option unset: decisions identical to the base (decision digest, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1).
- Value, continuation, reach: NOT MET. The constants are unmeasured (population priors and owner-order readings, not fitted); evaluation NOT RUN. The league cards are declared, not run.

Default OFF in source (read `=== true`). Not registered in the live switch: no option-switch migration was generated with it.

## Limits

A model, not a solver: the opponent's turn lead when the Horse is in position is his bet-after-check share; the river has no facing-bet seam (the call is the equity against his betting range); the preflop range is a percentile cut, not his read band; 40 hands x 8 turn cards x 8 rivers is a sample.
