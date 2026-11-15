# omahaOopTurnCheckAfterFlopCall: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

Out of position on the turn after the flop bet was called (heads-up, or multiway with the Horse first to act and every live opponent a caller): a bet becomes a check (nut class keeps betting); facing the bet it never raises, calls with 4+ nut outs at its price, folds with no out at 0.15 or more. Owner-ruled and final over every later rule.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaOopTurnCheckAfterFlopCall docs/horse-option-authority.d/omahaOopTurnCheckAfterFlopCall.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"
- Option ruling: "THIS SHOULD BE A CHECK CALL 100% OF THE TIME ... CHECK CALL WHEN DRAWING TO THE NUTS, CHECK FOLD WHEN YOU CAN'T IMPROVE" (as quoted in the option comment in HorseLogic.ts; hands 59517323, 59521326, 59526261)

## Recorded hands and rulings it answers

59517323, 59521326, 59526261

## Receipts

omaha_oop_turn_check_after_flop_call, omaha_oop_turn_check_call_nut_draw, omaha_oop_turn_check_fold_no_outs, omaha_oop_turn_check_raise_flatted

A receipt describes the final action (2026-11-15 follow-up): a verdict a later rule can still overturn is proposed and settled when the decision is final; its receipt fires when the final action is the verdict, and its `_vetoed` twin fires when a later rule replaced it. Vetoed twins: omaha_oop_turn_check_call_nut_draw_vetoed, omaha_oop_turn_check_fold_no_outs_vetoed, omaha_oop_turn_check_raise_flatted_vetoed.

## Tests

HorseOmahaOopTurnCheckAfterFlopCall.test.ts, HorseOmahaStrategyPrecedence.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

No evaluation run. The 0.15 showdown credit and the 0.15 price floor on the no-outs fold are the builder's constants, not measured.
