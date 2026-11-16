# omahaNoDrawRaiseOutOfPosition: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

PLO4/PLO5 cash flop or turn: no raise with a draw out of position; in position only a combo draw raises (a bare flush draw and a bare straight draw or wrap may not). Two pair or better is a made hand and never barred.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaNoDrawRaiseOutOfPosition docs/horse-option-authority.d/omahaNoDrawRaiseOutOfPosition.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"
- Option ruling: "RAISING WITH DRAWS SHOULD NEVER HAPPEN OUT OF POSITION. ONLY IN POSITION WHEN ITS COMBO DRAWS, NOT NAKED NUT FLUSH DRAWS." (as quoted in the option comment in HorseLogic.ts)

## Recorded hands and rulings it answers

owner 2026-11-15 12:30

## Receipts

omaha_no_draw_raise_final_call and the site receipts (ledger)

## Tests

HorseOmahaBigDrawAggression.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

One pair with no flush draw and under eight straight outs is not classed as a draw and can still raise; policy-graph and phase-pack raises are not exercised by its tests.
