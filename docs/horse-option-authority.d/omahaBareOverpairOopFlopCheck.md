# omahaBareOverpairOopFlopCheck: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

The bare overpair out of position checks the flop (any opponent).

The continuation (same option, heads-up only): having checked and facing the flop bet, the Horse never raises; it calls when the expected value of the call clears 2 percent of the final pot, and folds otherwise. The expected value uses the Horse's exact cards against the bettor's range (the engine's tiered Omaha aggressor ranges, stronger as the bet grows from a third of the pot to 70 percent of it), moved by the bettor's measured read (toward any hand for a measured postflop over-bettor, one tier stronger for a measured value leader, unmoved for an unknown or presumed one), at the price, with a realisation discount of 0.75 for being out of position. The 0.75 is the engine's flop out-of-position realisation factor: a stated constant, not measured. The facing-bet expected-value model (`HorseOmahaFacingBetEv.ts`) has no flop form, so the flop uses the equity helper (`simulateEquity`) on a private seeded stream. Multiway, a whole-stack call and a hand outside the check rule's class keep today's decision.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaBareOverpairOopFlopCheck docs/horse-option-authority.d/omahaBareOverpairOopFlopCheck.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

59517323

## Receipts

omaha_bare_overpair_oop_flop_checked, omaha_bare_overpair_oop_flop_check_called, omaha_bare_overpair_oop_flop_check_folded, omaha_bare_overpair_oop_flop_check_raise_flatted

## Tests

HorseOmahaOopChecks.test.ts, HorseOmahaStrategyPrecedence.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Continuation, mechanism: MET (built 2026-11-15; nine hand classes in PLO4 and PLO5, four bet sizes, three reads, 16 seeds in `HorseOmahaOopChecks.test.ts`; before and after tables in the evidence archive `plo-handoff-review-01a1cbbd/overpaircont-20261115/MEASURE.md`).
- Value, continuation as value, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

- The continuation replaces the coordinator's earlier follow-up wording (never fold to a bet of pot or less heads-up) with a priced decision, on the owner's 11:39 principle (no blanket rule; hand, player, price and pot dependent) and 12:09 ruling (no check-raise without the nuts). Before it, today's brain folded the checked bare pair to two thirds of the pot at 100 of 100 seeds and to the pot at 23 to 100 of 100, the same against every read (MEASURE.md).
- With it the bare pair still folds: to a pot-sized bet in every PLO5 class measured, and to half the pot or more against a measured value leader in most. That is the expected value at the stated 0.75 discount, which is not measured; nor are the size line (a third to 70 percent of the pot) and the 0.5 any-hand share of the aggressive lean.
- Heads-up only. Multiway, the whole-stack call, a raise war on the flop and a Horse in position keep today's decision.
- Under load the equity governor may shrink the sample the equity helper is given.
