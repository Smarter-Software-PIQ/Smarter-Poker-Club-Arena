# omahaPreflopStackPlan: authority for the live switch

The Omaha street plan's preflop stack-to-pot layer (HorseOmahaStreetPlan.ts). Evidence NOT MET.

## What it does

PLO4/PLO5 (cash, or a tournament hand inside omahaStrategyInTournaments' scope), pot limit, one board, high only, no bomb pot, not all-in-or-fold. The Horse's decision is a CALL of a preflop raise (an open, a 3-bet or more), the last raiser is live and not all in and is the only opponent with chips in voluntarily, and the call is not itself all in. It computes the stack-to-pot ratio the call creates (the smaller of what is behind for it and for the raiser, over the pot after the call). Only under 3 (OMAHA_PREFLOP_STACK_PLAN_LOW_SPR) is the call priced as the stack it commits:

EV(call) = (equity - charge) x (pot after the call + 2 x behind) - (call + behind); EV(fold) = 0.

- Equity: against the raiser's range (HorseOmahaReraisedPot's sampler, 300 samples): the band the mind reads for him, else the line-implied prior (open 0.40-1, 3-bet 0.62-1, 4-bet 0.86-1).
- Charge, from the hand's playability: realisation, the engine's margin (0.10 out of position, 0.05 in position) scaled by ratio / 3 and halved for a nut-making hand (coordinated by omahaOopCoordinated, or a suited ace); stack-off, 0.06 x min(1, ratio) for a hand that makes mostly one pair (neither).

A negative EV(call) turns the call into a fold. It never widens a range: only call -> fold. It runs first inside omahaOopReraisedPotStrongRange, before the day's 3-bet / 4-bet options (omahaReraiseRangeOutOfPosition / EarlyPosition, omahaOopReraisedPotStrongRange), so a call those rules make from a raise is theirs and is never seen by this rule. No engine random number.

## The owner's orders it rests on (verbatim, as relayed in the build order)

- 2026-11-15 11:43 America/Chicago: "HORSES SHOULD ALWAYS BE THINKING ABOUT FUTURE STREETS… PLAN AHEAD… PROTECT AND GROW THERE STACK…"
- 2026-11-15 11:39 America/Chicago: no blanket rules; the decision is hand, player, price and pot dependent. Owner-ruled checks and folds are final.

## Receipts

omaha_preflop_stack_plan_folded; vetoed twin omaha_preflop_stack_plan_folded_vetoed. A call -> fold in the wager_rules node is already admitted by the receipt validator in PLO4/PLO5 (the paired-board fold's admission: a fold puts no chip in).

## Tests

HorseOmahaStreetPlanLayers.test.ts; HorseOmahaStrategyPrecedence.test.ts and its tournament twin.

## Evidence rows

- Mechanism, scope, visibility (flag row and receipts in HorseDataLedger.ts), tests: MET on the branch.
- Option unset: decisions identical to the base (decision digest, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1).
- Value, continuation, reach: NOT MET. The constants are unmeasured (population priors and owner-order readings, not fitted); evaluation NOT RUN. The league cards are declared, not run.

Default OFF in source (read `=== true`). Registered in the live switch OFF-ONLY (follow-up list migration 20261117181040 names it): it turns a heads-up preflop call into a fold, so it changes a preflop calling range and is under the owner preflop range hold (HorseOptionSwitch.ts OPTION_SWITCH_OFF_ONLY, source 'owner preflop range hold'). It cannot be switched on until the owner lifts that hold for it by name (OPTION_SWITCH_PREFLOP_HOLD_LIFTED).

## Limits

Heads-up against the raiser only; players still to act behind are not modelled. The stack-off model assumes the stacks go in (at a ratio under 3 they mostly do); a hand that folds a flop cheaply is under-credited. The charges are readings of the owner's order, not fitted.
