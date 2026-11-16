# The tournament utility's margin is scaled to the stack (default OFF)

Hand 59441335 showed that the payout check can never overrule a short stack: its equity-uncertainty margin was measured against the whole payout pool, which is larger than a short stack's whole tournament equity.

New option `tournamentUtilityStackScaledMargin`, OFF by default. With it on, the margin for a candidate is the equity standard error times that candidate's own utility sensitivity to the Horse's showdown share, never wider than before.

What changes on fixed hands with it on: the worst hands jam less often from a 2.1 big blind stack (seven-deuce, three-deuce offsuit), and J-T suited calls a bubble jam less often. Pairs, aces, K-Q and the committed-stack calls are unchanged. A 25 big blind stack still calls a 2.5 big blind jam with almost anything, and nothing open-shoves under the gun at 20 or 35 big blinds.

An earlier version of this change turned required bubble folds into calls with A-7 and seven-deuce. That was before a bust in a paid place was valued at its place; with the margin also capped at the old figure, those folds stay folds (tested on all six committed-stack law nodes).

Not measured for value. The option ships off and needs a payout-scored evaluation before it is switched on.
