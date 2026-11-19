# omahaBigDrawAggression: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

PLO4/PLO5 cash flop or turn: a check or call with a declared big draw becomes a pot-sized bet or raise when that wager's expected value is higher; obeys omahaNoDrawRaiseOutOfPosition; never turns an owner-ruled or street-plan check into a bet.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaBigDrawAggression docs/horse-option-authority.d/omahaBigDrawAggression.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

owner 2026-11-15 11:55

## Receipts

omaha_big_draw_aggression_bet and related (ledger)

A receipt describes the final action (2026-11-15 follow-up): a verdict a later rule can still overturn is proposed and settled when the decision is final; its receipt fires when the final action is the verdict, and its `_vetoed` twin fires when a later rule replaced it. Vetoed twins: omaha_big_draw_aggression_bet_vetoed, omaha_big_draw_aggression_raise_vetoed.

## Tests

HorseOmahaBigDrawAggression.test.ts, HorseOmahaStrategyPrecedence.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

No evaluation run; one-street model; the 0.8 out-of-position realisation and the 0.42 default fold rate are assumptions; the measured human fold to a Horse raise was 20 of 114.

## The combo draw made precise (2026-11-16, owner 12:30 and 12:52)

One definition (`omahaComboDrawForRaise`, `HorseOmahaBigDrawAggression.ts`) serves omahaTurnRiverRaiseNeedsNuts's in-position turn exception, omahaNoDrawRaiseOutOfPosition's bar and omahaBigDrawAggression's in-position raise: a hand below two pair holding a flush draw (five or more flush outs) together with a straight draw of eight or more outs, a 13+ out wrap with a flush draw included; straight outs are counted by rank under the two-card rule, a card that also completes the flush included (`omahaComboStraightOuts`). A pair adds nothing: a pair with the nut flush draw is not a combo draw, nor a pair with the nut flush draw and a gutshot (it does not raise), nor a pair with a wrap and no flush draw. Before this, a strong pair with any draw counted (and in the big-draw rule every class but the bare wrap). Tests: HorseOmahaBigDrawAggression.test.ts (`omahaComboDrawForRaise`).

## Live change on this head (review B2, 2026-11-16)

This option is ON live since 2026-11-16T02:55Z (option-switch row, Hand Analysis's owner-forced record); this change alters its live behaviour as follows: For this option the in-position raise with a big draw on a PLO4/PLO5 cash flop or turn no longer fires for a pair with the nut flush draw (with or without a gutshot) or a pair with a wrap and no flush draw: those decisions keep today's check, call or fold instead of the raise. Two pair with the nut flush draw or a nut wrap, which this rule raised in position live today, no longer gets this rule's raise either (the call stays): the one combo-draw definition is false at two pair or better. One raise is ADDED: a nut wrap (thirteen or more straight outs, nine or more to the nut straight) that also holds a non-nut flush draw, below two pair, was held as not a combo draw live (the call stood) and now counts as a combo draw, so in position facing a bet on the flop or turn this rule may turn that call into a raise. Nothing changes out of position (no raise, no new bet, as before).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
