# omahaFacingBetEv: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

PLO4/PLO5 cash turn and river fold-or-call facing a bet is one expected-value decision on the exact hand, the player and the price; the single river decider where it answers (river medium-bet call, price-respect and bluff-catcher fold stand aside). Yields to the owner-ruled turn verdict.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaFacingBetEv docs/horse-option-authority.d/omahaFacingBetEv.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

rivercall nodes, 59521326, 59517323, multiway river nodes (owner 2026-11-15 11:39)

## Receipts

omaha_facing_bet_ev_call, omaha_facing_bet_ev_fold, omaha_facing_bet_ev_changed

## Tests

HorseOmahaFacingBetEv.test.ts, HorseOmahaStrategyPrecedence.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

The callerShown parameter is never passed (audit item 8, NOT done); the size-bucket best/second shown-down reads are optional and have no learner yet. PLO5 turn cost 177 ms measured by the builder. Its validator admission admits any fold -> call of the exact chips in its spot (cannot re-run the memory-reading verdict from the request).
