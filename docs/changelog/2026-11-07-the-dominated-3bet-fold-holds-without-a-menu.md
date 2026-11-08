# The dominated-hand 3-bet fold holds for every caller (2026-11-07)

Dan's 2026-10-25 rule (HorseHoldemPremiumAggression rule 1): in no-limit
hold'em, facing a 3-bet at least 2.5x the level it raised and deeper than
20bb effective, an offsuit unpaired hand other than AKo folds; an opener may
also continue AQo, a cold caller folds it.

## The defect

`preflopVerdict` and `wager` read the legal actions only from
`legalActions` on the state. A state without one (the league, the exploiter
league, the preflop audit, any offline caller) read as an EMPTY menu, so
`legal.has('fold')` was false and rule 1 stood aside; rules 2 and 3 (premiums
raise and keep betting) could not size a wager either. The live worker always
passes the controller's menu, so the live table folded these hands, but every
offline measurement played a brain without the owner rules. The preflop audit
of 2026-11-07 showed it as a heads-up small blind calling a 3-bet to 8bb at
80bb with KQo, AJo and ATo (and other dominated hands calling at every table
size, which the opener charts usually hid).

## The fix

`legalMenu` (HorseHoldemPremiumAggression.ts): the controller's menu when
the state carries one, unchanged; otherwise the no-limit menu the table would
offer from the same state (fold or check, call while the stack covers more
than the call, a bet or raise from the big blind or the last full raise over
the current bet, rounded to whole settlement units, and all in). Live
decisions are unchanged.

Pinned by `HorseDominatedThreeBetFold.law.test.ts`: the whole brain, heads-up
and three-, six- and nine-handed, 25/40/80/150bb, cash and tournament, with
the menu and without it; the rule's scope edges (20bb, 2.5x, AKo/AQo) at the
verdict.
