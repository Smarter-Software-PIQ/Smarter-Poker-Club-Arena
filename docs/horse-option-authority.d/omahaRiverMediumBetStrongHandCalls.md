# omahaRiverMediumBetStrongHandCalls: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

PLO4/PLO5 cash river: a fold of two pair or better facing an opening bet of 40-70% pot, heads-up or closing the action, becomes a call when the price-based requirement is met; withheld against a measured value leader. Stands aside where omahaFacingBetEv is on and answers the spot.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaRiverMediumBetStrongHandCalls docs/horse-option-authority.d/omahaRiverMediumBetStrongHandCalls.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

one PLO5 player's river bets (11 folds in 15, five of them the best hand); rivercall hands in HorseOmahaRiverMediumBetCalls.test.ts

## Receipts

omaha_river_medium_bet_strong_hand_call, \_withheld, \_unpriced

## Tests

HorseOmahaRiverMediumBetCalls.test.ts, HorseOmahaStrategyPrecedence.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

The spot reads gs.toCall; the league state carries none, so the option is inert in the league (facing-bet builder's finding). Its reach through the production worker path (workerRuntime) was NOT proven by a worker-path test in this head.
