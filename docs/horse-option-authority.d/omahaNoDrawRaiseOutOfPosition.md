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

## The combo draw made precise (2026-11-16, owner 12:30 and 12:52)

One definition (`omahaComboDrawForRaise`, `HorseOmahaBigDrawAggression.ts`) serves omahaTurnRiverRaiseNeedsNuts's in-position turn exception, omahaNoDrawRaiseOutOfPosition's bar and omahaBigDrawAggression's in-position raise: a hand below two pair holding a flush draw (five or more flush outs) together with a straight draw of eight or more outs, a 13+ out wrap with a flush draw included; straight outs are counted by rank under the two-card rule, a card that also completes the flush included (`omahaComboStraightOuts`). A pair adds nothing: a pair with the nut flush draw is not a combo draw, nor a pair with the nut flush draw and a gutshot (it does not raise), nor a pair with a wrap and no flush draw. Before this, a strong pair with any draw counted (and in the big-draw rule every class but the bare wrap). Tests: HorseOmahaBigDrawAggression.test.ts (`omahaComboDrawForRaise`).

## Live change on this head (review B2, 2026-11-16)

This option is ON live since 2026-11-16T02:55Z (option-switch row, Hand Analysis's owner-forced record); this change alters its live behaviour as follows: For this option the in-position bar on a PLO4/PLO5 cash flop or turn now turns into a call every raise by a hand below two pair that holds a flush draw without an eight-out straight draw, a pair or not: a pair with the nut flush draw (with or without a gutshot) that raised in position live today now calls. An open-ender with a flush draw whose flush-suit straight cards were left out now passes the bar and keeps its raise. Out of position nothing changes (every draw raise below two pair becomes a call, as before); two pair or better is never barred.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
