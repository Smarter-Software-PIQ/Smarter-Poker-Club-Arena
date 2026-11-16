# omahaTurnRiverRaiseNeedsNuts: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

PLO4/PLO5 cash turn and river facing a bet: a raise stands only with a nut-class hand (turn only: an in-position combo draw by the one definition, omahaComboDrawForRaise); otherwise call or fold by the exact-hand EV (omahaFacingBetEv), the owner-ruled turn verdict, or a price fallback. The outermost raise conversion on both decision paths.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaTurnRiverRaiseNeedsNuts docs/horse-option-authority.d/omahaTurnRiverRaiseNeedsNuts.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

59534208 (owner 2026-11-15 12:52 / 12:53)

## Receipts

see HorseDataLedger.ts (omaha_turn_river_raise_needs_nuts receipts: \_by_ev, \_by_oop_turn_verdict, \_by_price)

## Tests

HorseOmahaTurnRiverRaiseNeedsNuts.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false, this one included, at 0477c15da9f equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

The price fallback (fold at a third of the pot after the call) is the builder's constant, not measured. Policy-graph phase-pack raises are governed only through the wager_rules node.

## The combo draw made precise (2026-11-16, owner 12:30 and 12:52)

One definition (`omahaComboDrawForRaise`, `HorseOmahaBigDrawAggression.ts`) serves omahaTurnRiverRaiseNeedsNuts's in-position turn exception, omahaNoDrawRaiseOutOfPosition's bar and omahaBigDrawAggression's in-position raise: a hand below two pair holding a flush draw (five or more flush outs) together with a straight draw of eight or more outs, a 13+ out wrap with a flush draw included; straight outs are counted by rank under the two-card rule, a card that also completes the flush included (`omahaComboStraightOuts`). A pair adds nothing: a pair with the nut flush draw is not a combo draw, nor a pair with the nut flush draw and a gutshot (it does not raise), nor a pair with a wrap and no flush draw. Before this, a strong pair with any draw counted (and in the big-draw rule every class but the bare wrap). Tests: HorseOmahaBigDrawAggression.test.ts (`omahaComboDrawForRaise`).

## Live change on this head (review B2, 2026-11-16)

This option is ON live since 2026-11-16T02:55Z (option-switch row, Hand Analysis's owner-forced record); this change alters its live behaviour as follows: For this option the in-position turn exception (the only non-nut raise it lets stand) narrows the same way: on a PLO4/PLO5 cash turn facing a bet, a pair with the nut flush draw (with or without a gutshot) or a pair with a wrap and no flush draw, which kept its raise live today, now calls or folds by the exact-hand EV (omahaFacingBetEv) like every other non-nut hand. One raise is now KEPT that live today becomes a call or a fold: on a PLO4/PLO5 cash turn in position facing a bet, a flush draw with an open-ended straight draw and no top pair or overpair, whose straight outs fell under eight live only because flush-suit straight cards were counted as flush outs, now passes the exception as a combo draw and keeps its raise. The river and every out-of-position turn are unchanged (raise only with a nut-class hand).
