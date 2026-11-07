# 2026-11-07: deep horse stack-offs measured by depth band; no rule admitted

## Why

A review of the 20 biggest horse losses of 2026-11-06 found deep all-ins with
weak hands, 16 of them in tournaments or lightning 0.5bb tables at 400-1200bb.
The proposal was a depth-aware cap for (a) NLH one pair continuing facing a
turn or river raise and (b) preflop stack-offs with KK/QQ (NLH) and AA
(PLO5/PLO6).

## What was measured

Decision EV of every such horse decision on two independent UTC days
(2026-11-05 and 2026-11-06), CIs clustered by hand, by effective-stack band
(<100, 100-200, 200-400, 400+ bb), with the admission rule of
`HorseOmahaBigBetCalls.ts`: below zero on both days and no format slice with
n >= 10 positive.

## Result

No cell passed, so no engine code changed. NLH one pair facing a raise is
not negative at any depth on both days (200-400bb: -17.2 / +23.5bb), and the
400+ band holds 5-11 decisions per day. The preflop premium cells at 400+
hold one to nine decisions per day. Two near misses are recorded for a
re-measure on fresh days: NLH QQ continuing facing a 4-bet at 200-400bb
(-66 / -148bb, CI below zero on day B and on a supplementary 2026-11-04) and
NLH two pair through a paired board continuing facing a turn/river raise at
200-400bb (-45.8 / -50.0bb, failed only on a +11.9 cash slice of n 10).

The four example hands were rebuilt from their recorded nodes and replayed
over 40 seeds; each decision's branch is named with its file and line in
`docs/horse-measure/2026-11-07/deep-stack-cells.md`. Two depth holes found
there are not admitted by this evidence and stay as they are: the final
premium layer jams AA/KK over a 4-bet at any cash depth
(`HorseHoldemPremiumAggression.ts:636`), and the V25 PLO commitment zone
reads one pot raise against hero's own stack, not the effective stack.

## Files

- `scripts/horse-measure/sql/deep-raise-continues.sql`,
  `scripts/horse-measure/sql/deep-preflop-premiums.sql`: the read-only
  measurements, registered in `horse-release-verify.py` as
  `sql deep-raise-continues` and `sql deep-preflop` and covered by
  `tests/the-horse-release-kit-only-reads.test.ts`.
- `docs/horse-measure/2026-11-07/deep-stack-cells.md`: every number.
- `scripts/horse-measure/README.md`: the baseline entry.
