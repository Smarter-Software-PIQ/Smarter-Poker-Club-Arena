# An aggression read needs bluffs behind it (V83)

Re-measured at 100,000 hands with the fixed evaluator, the R7 certification
league (dataset 187815b1, league/cash) lost -5.54 +/- 0.84 bb/100. R7's own decisions were about break
even; 83% of the loss sat in hands it never acted in. Turning horse memory
learning off turned the loss into a tie, so the loss came from how the brain
read its opponent, not from the playbook's cells.

## The defect (verified)

`HorseMind.legacyExploit` calls an opponent a maniac on one number: a
postflop aggression factor (bets and raises over calls) above 2.5 sets
`callDownMod` to 1.2. That does two things. It lowers the respect every bet
gets (`respect = 2 - callDownMod`), and every one-pair fold and shade layer
gated on `exploit.callDownMod <= 1` switches off at once: V61, V63, V65, V66,
V79 and V80.

Heads-up horse-vs-horse play sits at an aggression factor of about 2.43, just
under the line. R7 checks more than the brain does in the one cash spot it
plays, so its opponent was checked to more often, bet more, and read 2.66 in
one pass of the duplicate deal while the other pass stayed at 2.43. Yet 218 of
that opponent's 255 big river bets (85%) showed down strong. The R7 seat then
called those bets down with one pair. First diverging decision in 854 hands
without a playbook hit: the R7 seat decided first in 787, mostly calling
where the normal seat folded (turn 308, flop 289, river 148); the folding seat
fired v66_raise_stratum, v66_bet_raised_one_pair, v38_ev_fold,
v65_turn_one_pair_shade, v61_river_one_pair_shade and
v63_large_river_bet_shade, the calling seat fired none of them.

Offline reproduction (sealed R7 cash cell, the official seeds, mood clock
from the deal seed, EQUITY_GOVERNOR=off, 50,000 pairs):

| exploit read                                   | league/cash bb/100 |
| ---------------------------------------------- | ------------------ |
| ratio-only, line at 2.5 (today)                | -5.54 +/- 0.84     |
| line moved to 3.0                              | -0.50 +/- 0.28     |
| line moved to 2.0                              | -1.23 +/- 0.59     |
| V83 (value-backed aggressor keeps respect)     | -0.62 +/- 0.31     |

The 2.5 run reproduces the 10x diagnosis run bit for bit (the official
receipt was a 1x run at 5,000 pairs), so the line accounts for about 90% of
the loss; the remainder sits at the noise line.

## The change (`v83AggressionNeedsBluffs`, default on; explicit false is today)

Above an aggression factor of 2.5, the maniac read applies only when the
bettor's big river bets have not shown down mostly as value:
`HorseMind.aggressionShownAsValue` is true at 20+ big-bet showdowns
(`bigBetSD`, >= 20bb, called, shown) with 75%+ strong (`bigBetSDStrong`), and
then `callDownMod` stays 1 (receipt `v83_aggression_shown_as_value`).
Unchanged: an aggressor without that sample, one whose big bets show down
weak, the passive branch (AF < 0.7), bluffMod and valueThinMod, and the
credible opponent read (`callDownRespectShift`), which replaces the legacy
value whenever it engages. HorseLogic passes the flag at both callDownMod
consumers (`tableExploit` for the decision's exploit profile and the current
bettor's read in the call respect).

## League (duplicate-deal, mood clock from the deal seed, governor off; a = V83 on, b = off)

| card                         | field          | hands   | bb100           | divergent pairs |
| ---------------------------- | -------------- | ------- | --------------- | --------------- |
| nlh 100bb 6-max              | mirror         | 16,000  | 0 (inert)       | 0               |
| nlh 40bb 6-max               | mirror         | 16,000  | 0 (inert)       | 0               |
| mtt 40bb 6-max               | mirror         | 16,000  | 0 (inert)       | 0               |
| nlh 100bb / 40bb / mtt 40bb  | Hybrid mirror  | 16,000  | 0 (inert)       | 0               |
| nlh 100bb / 40bb / mtt 40bb  | human field    | 16,000  | 0 (inert)       | 0               |
| nlh heads-up 80bb            | mirror         | 100,000 | +2.23 +/- 0.69  | 575             |
| nlh heads-up 80bb            | Hybrid mirror  | 100,000 | 0 (inert)       | 0               |

No illegal actions or truncated streets. The human-calibrated field deals
six-max only (HorseLeague humanFieldTwin), so the heads-up card has no human
twin. The read only changes where an
opponent's postflop aggression factor exceeds 2.5 with a value-heavy
showdown record, which in the league means heads-up balanced horses; the
6-max cards and the production Hybrid style never reach it.

## Tests

`HorseMindAggressionNeedsBluffs.test.ts`: the sample and share thresholds;
the R7 league opponent's real counters keep neutral respect with V83 and read
1.2 with it off; a measured bluffer and a thin sample still read 1.2; the
passive branch, bluffMod and valueThinMod are identical either way; and in a
real decision (the V65 turn fixture) V83 on fires the receipt and the V65 one
pair shade, V83 off fires neither. Mutation-checked: disabling the gate fails
two tests, ignoring the flag fails one.

## Re-measure live

`horse_brain_telemetry` counts `v83_aggression_shown_as_value`. Expect it to
fire mostly at heads-up tables, and the V61/V63/V65/V66 receipts to rise
slightly there.
