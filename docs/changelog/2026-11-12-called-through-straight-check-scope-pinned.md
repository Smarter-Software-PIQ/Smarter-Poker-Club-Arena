# The Called-Through Straight Check Has Its Scope Pinned

Tests only. No engine behaviour changes.

The check merged for hand 58796916 (an Omaha straight checks the river to two players who each called two barrels when a flush is possible) now has its eligibility pinned in `server/src/engine/HorseOmahaCalledThroughStraight.test.ts`: it holds in PLO4, PLO5 and PLO6, in a tournament, and with a short stack; it does not apply heads-up, on a paired board with no flush possible, after one called barrel, in Hi-Lo when a low is possible, or when one of the callers is all in.

Why the heads-up and paired-board cases are pinned as NOT applying: both were built and measured on 2026-11-12 and withdrawn (PR #10642, closed). In 300,000 paired cash self-play hands (same seeds, rule on and off) the heads-up check cost the checking Horse 1.38 big blinds per fired hand (standard error 0.41; 1,947 hands), and the paired-board form showed no gain. Anyone extending the rule should measure first.

Not established either way: the merged two-caller rule itself fired in only 12 of those hands, too few to measure. It rests on the reported hand.
