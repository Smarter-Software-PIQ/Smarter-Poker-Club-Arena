# Strong Omaha draws retain their semi-bluff pressure mix

A PLO5 nut flush draw with six nut straight outs could fall between two
classification metrics. Its raw sampled equity exceeded the semi-bluff band's
upper bound, while V40's weak-made-hand pressure cap put its value-raise equity
below the value threshold. The draw therefore could not enter either raise
branch, even against a measured aggressive bettor.

The existing bounded semi-bluff mix now also considers that physically strong
draw using the capped upper-band classification. The cap remains intact.
The added route requires one opponent, measured aggression, ordinary single-board
Omaha-high cash play, and no raise of hero's own wager. Existing legal sizing,
frequency, continuation-plan, commitment and paired-board protections still apply.
Hi-lo retains its existing policy; no experimental feature flag is enabled.

The PLO5 seed41 regression fails as a call before the fix and makes a legal raise
afterward. A fixed128-seed probe raises17 times, preserving a mixed strategy.
Matched public states across NLH, PLO4/5/6 and PLO8 choose identical actions at
proportionally scaled stakes. The control uses1/2 and2.5/5: actual2/5 has a
different small-blind ratio, so its forced-money changes are a separate input.

These are local behavior checks. Protected publication and live adoption remain
separate requirements; they do not establish profitability or fleet-wide use.
