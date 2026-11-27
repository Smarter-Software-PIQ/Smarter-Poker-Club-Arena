# A Fold Facing A 3-Bet Is Priced Against The 4-Bet (omahaReraisedPotFoldReraiseIsPriced, Default Off)

## What was found

Public actions of PLO4/PLO5 cash hands with a person, 2026-11-19 to 11-27 (7,995 hands). People re-raise 42.9% of opens in PLO5 (the rate is the person's: 0% to 53%), fold 0 of 786 times to a 3-bet and 1 of 277 times to a 4-bet. A Horse that opened and met a person's 3-bet out of position folded 72.1% of the time (495 decisions), called 15.8% and 4-bet 12.1%.

Every re-raised-pot rule priced a standing fold against the CALL only (`HorseOmahaReraisedPotPricedRule`: a fold never met the re-raise). Out of position the call is priced out by the measured realization (the owner's rule: calling 3-bets out of position is a losing play), so the fold stood without the 4-bet ever being asked.

## What changed

- `omahaReraisedPotFoldReraiseIsPriced` (default OFF, read `=== true`). PLO4/PLO5 cash, preflop, facing exactly a 3-bet, out of position and heads-up against the 3-bettor: the standing fold becomes the pot-size re-raise (the all-in when that is the whole stack) when EV(re-raise) > max(EV(call), 0) + deadband + the sampling error of the price, on the existing verdict of `HorseOmahaReraisedPotPriced`. The 3-bettor's width and his fold to the 4-bet are read from his own public record, then the people-only person-level prior (`RERAISED_POT_PEOPLE_PRIOR`).
- It never makes a call, changes no standing call or re-raise, and does nothing in position, multiway or facing a 4-bet or more.
- Receipts `omaha_reraised_pot_priced_fold_reraised`, `omaha_reraised_pot_priced_fold_reraise_kept`.
- The receipt validator admits a fold that became the largest legal re-raise in the rule's own spot.
- A switch-list migration registers the option. It writes no row.

## Not changed

Option off: every decision byte for byte the one it was. The sibling options `omahaReraisedPotCallIsPriced` and `omahaReraisedPotReraiseIsPriced` read their own prior as before (the new prior is a parameter that defaults off).

## Evidence

`docs/horse-option-authority.d/omahaReraisedPotFoldReraiseIsPriced.md` (Evidence NOT MET), `server/src/engine/anOmahaReraisedPotFoldReraiseIsPriced.law.test.ts`, `server/src/engine/anOmahaReraisedPotFoldReraiseIsPriced.realHands.law.test.ts`.
