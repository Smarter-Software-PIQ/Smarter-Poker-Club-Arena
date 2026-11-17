# 2026-11-17: the re-raised-pot preflop call cell is priced, not folded by class

Owner, 2026-11-17 15:30 Chicago (verbatim): "DONT' MAKE ANY BLANKET RULES, EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND
DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS". Ownership of these functions: owner ruling 2026-11-17 15:17 Chicago
(PLO5 audit owner session).

Scope correction of the ON option `omahaOopReraisedPotStrongRange` (no new option; option off is unchanged because the cell
is not reached). In PLO4/PLO5 cash, for every preflop call of a 3-bet or more the cell examines (the scope is unchanged), the
categorical folds (hand not coordinated, non-aces pair facing a 4-bet out of position at a ratio of 2.5 or less) and the
categorical keeps (suited aces unexamined, margins by flag) are replaced by one priced test: the call becomes a fold only
when EV(call) = realization x equity x (pot after the call) x (1 - rake) - call is below 0. Equity is against the re-raiser's
range, its width from his measured re-raise rate (posterior mean with opportunity denominators, the game's population mean
when nothing is known), narrowed for a 4-bet by the engine's line rule. Realization comes from the position actually held
after the call (after the re-raiser and every player already in for the price; players still to act who have not raised
are not counted), the stack-to-pot ratio after the call and the other players in. Constants: the PLO Strategy lane's
measurements (2,023 recorded calls; 3-bet holdings fit), cited in HorseOmahaOopReraisedPot.ts. Whether the Horse raised
earlier enters only as a receipt; what it already put in is in the pot.

Receipts: omaha_reraised_call_priced_call / \_fold, and \_call_after_own_raise / \_fold_after_own_raise. The calling rule that
omahaReraiseRangeOutOfPosition / EarlyPosition hand their downgraded 4-bets to is the same cell, so its folds are priced too.
PLO6 keeps its six-card cell (PLO6 lane, behind omahaStrategyInPlo6).

Rollback: `fn_ca_horse_option_switch_set('omahaOopReraisedPotStrongRange', 'off', ...)` turns the whole cell off (the
pre-2026-11-16 behaviour); there is no switch for the old class rule.
