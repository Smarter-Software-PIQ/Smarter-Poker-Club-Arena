# 2026-11-17: a fold of the re-raised-pot preflop call cell must be confirmed by the price

Owner, 2026-11-17 15:30 Chicago (verbatim): "DONT' MAKE ANY BLANKET RULES, EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND
DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS". Ownership of these functions: owner ruling 2026-11-17 15:17 Chicago
(PLO5 audit owner session).

Scope correction of the ON option `omahaOopReraisedPotStrongRange` (no new option; option off is unchanged because the cell
is not reached). PLO4/PLO5 cash only; PLO6, tournaments, Hi-Lo and bomb pots are untouched.

## What changes

For every preflop call of a 3-bet or more that the cell examines (its scope is unchanged) the class cell is computed exactly
as before (`omahaOopReraisedClassCell`: suited aces kept, commitment, coordination, equity against the raiser's band with
the realization margins). Then:

- the class cell KEEPS the call: the call stands, with the same verdict and the same receipt as before
  (`omaha_oop_reraised_call_kept`). The priced numbers are computed and travel on the verdict; they cannot fold the call.
- the class cell FOLDS the call: the fold stands only when the priced test confirms it,
  EV(call) = realization x equity x (pot after the call) x (1 - rake) - call < 0 (`omaha_reraised_call_priced_fold`, with
  `omaha_oop_reraised_call_folded`). Otherwise the fold is overturned and the call stands
  (`omaha_reraised_call_priced_call`, with `omaha_oop_reraised_call_kept`). `_after_own_raise` marks the subset in which the
  Horse had raised earlier in the hand (a receipt input, not a term of the decision).

So the pricing is only allowed to overturn folds. The first version of this change (97de6c23913) priced in both
directions; the independent review rejected that: on 627 journaled decisions it folded 39 calls the class cell kept (34
recorded calls that netted +457.6 bb, 20 holding a pair of aces, none judged a wrong call by the audit). The realization
terms that produced those folds are too uncertain to create a fold: the out-of-position depth cost is 0.70 with a standard
error of 0.54 (in position 0.15, SE 0.31) and the 0.35 per other player (SE 0.11) is one pooled figure laid over heads-up
equity. The folding direction needs its own default-OFF option and a declared evaluation with multiway equity.

Equity is against the re-raiser's range, its width from his measured re-raise rate (posterior mean with opportunity
denominators, the game's population mean when nothing is known), narrowed for a 4-bet by the engine's line rule.
Realization comes from the position held after the call (after the re-raiser and every player already in for the price; a
raiser still to act behind is charged as another player in, not as position lost; players still to act who have not raised
are not counted), the stack-to-pot ratio after the call and the other players in. Constants: the PLO Strategy lane's
measurements (2,023 recorded calls; 3-bet holdings fit), cited in HorseOmahaOopReraisedPot.ts.

## Measured on the journal (627 decisions, builds 3529e866 and 28372c9a, replayed through the worker runtime)

Main 141da7bfd3a against this change: 97 folds become calls, 0 calls become folds, 530 unchanged. Of the 253 class folds,
158 are confirmed by the price and 95 overturned; the other two new calls are downgraded 4-bets of the re-raise range
rules whose call now stands. All 66 class keeps are byte-identical and fire no priced receipt.

Two recorded regression spots decide differently at the cell and are pinned with their numbers in
HorsePloPostflopMinBetRegression.test.ts: #59728213 (kings with a suited ace, out of position, 4-bet, ratio 1.60: class
fold overturned, +78.6 chips on a call of 147) and #59732319 (in-position cold call of a 3-bet: class fold overturned by a
margin inside the sampler's error, +1.36 chips on a call of 36).

## Rollback

There is no switch for the priced test alone. Behaviour changes wherever the cell runs, which is under three options:

- `omahaOopReraisedPotStrongRange` (the cell itself);
- `omahaReraiseRangeOutOfPosition` and `omahaReraiseRangeEarlyPosition`: a 4-bet they turn into a call is handed to the
  same cell with the option forced on, even when `omahaOopReraisedPotStrongRange` is off, and without telemetry (no priced
  receipt fires from inside that hand-off).

`fn_ca_horse_option_switch_set(<option>, 'off', ...)` on all three removes every decision this change touches, and with
it the whole cell and both re-raise range rules (the behaviour before those options existed). Turning off only the first leaves the
priced test live inside the other two. To return to the class rule with the options on, revert this commit and 97de6c23913.

## Known limits (handed to the follow-up lane, behaviour not changed here)

- Where realization x (1 - rake) is at or below the price, no hand can pass the priced test: the confirmed fold is then
  set by position, players in, depth and price, not by the cards (43 of the 158 confirmed folds have a required equity of
  1 or more). These were folds on main too.
- A re-raiser with no read is priced on the Horse population rate (PLO5 full ring 0.046), although measured human widths
  are wider: the priced test under-rescues against unknown people.
- A class fold whose pricing inputs cannot be built is left as a call with no receipt.
- The live receipts are names only; the numbers are reproduced by replay (pure, seeded).
