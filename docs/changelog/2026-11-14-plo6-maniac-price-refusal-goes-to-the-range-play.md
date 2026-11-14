# PLO6: A Refused Price Against An Observed Maniac Goes To The Range Play (PLO6-AUDIT-013)

2026-11-14. Lane: PLO6.

## What Was Wrong

At a deep PLO6 cash four-bet node (production hand 58751512, decision 13) a Horse shoved 60 of 60 against an unknown or a proven tight four-bettor, and against an observed maniac called 42 and FOLDED 18. The maniac price arithmetic decides that spot before the range play; its fixed margins (0.08 domination, 0.03 realization) put the required equity at 0.346 against pot odds of 0.236, the sampled equity sat on the line, and a refusal was an outright fold. Every alternative to the fold is worth 28 to 137 big blinds at that node under random, top-quarter and aces-only ranges.

## What Changed

`plo6ManiacPriceRefusalToRangePlay`, on by default. PLO6 cash, the raiser faced is an observed maniac and not all in, the call is under 40% of the stack: when the arithmetic refuses, the decision falls through to the range play, which decides the same node against every other opponent. A call by the arithmetic is unchanged. Nothing else moves: other Omaha games, hold'em, tournaments, calls of 40% of the stack or more and all-in raisers keep the arithmetic's fold.

Receipt: `plo6_maniac_price_refusal_range_play_seen`.

## Evidence

`docs/horse-default-on.d/plo6ManiacPriceRefusalToRangePlay.md` (the eight rows). Matched cases in `server/src/engine/HorsePlo6OpponentReadMatrix.test.ts`: the three observed-raiser cells go from call and fold to call and shove with no fold; every other cell is unchanged; the option set to false reproduces the old cells; the same node dealt as PLO5 keeps the fold.

## Not Changed

No adjustment against a tight raiser. At this node the shove against aces only is within 6 big blinds of the call when the opener calls and 35 better when he folds, so a change there is not supported.
