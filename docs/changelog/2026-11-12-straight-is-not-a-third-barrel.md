# A Straight Is Not A Third Barrel When A Flush Or A Full House Is Possible

Follow-up to the fix for hand 58796916 (PLO4, 2026-11-12), authorized by Dan the same afternoon. That fix made a Horse check a straight on a flush-possible river against two players who had each called two barrels. Probing the same river with one variable changed showed two neighbouring holes on the previous source, each a wager on 30 of 30 seeds:

- One of the two callers gone, so the Horse is heads-up against a player who called both barrels: it still bet its stack with the straight on the flush river.
- The river pairs the board where it completed the flush before: it bet its stack with the straight into both callers, and heads-up.

The rule now reads: on an Omaha high river, on one ordinary board, a straight checks when a flush is possible or the board is paired, against two or more opponents of whom two called both barrels, or against one opponent who called both. Receipt unchanged: `horse_continuation_omaha_called_through_straight_check`.

Checked and left alone because the probe showed no hole: a set and two pair on the flush river already check into two callers. Seen and deliberately not changed, because no hand shows it losing: a straight that is not the top straight, on a river with no flush and no pair, still bets; a third-nut flush still bets heads-up.

Unchanged: a straight on a river that completes nothing; a nut flush; lines where the callers called one barrel; facing a bet; Hold'em; Hi-Lo split low; multiple boards. No range, size or threshold is retuned. This closes holes shown by replaying one reported hand with one thing changed. It is not a measurement of frequency or profit.

Option `v40CalledThroughStraight`, default on. Two frozen historical corpora (the October opponent-read neutrality corpus and the pre-V53 tournament corpus) replay decisions this rule now changes; following the repository's convention they pass the explicit off arm and keep every recorded byte. Production has no opt-out configured.

Law: `server/src/engine/HorseOmahaCalledThroughStraight.test.ts` holds the rule in PLO4, PLO5 and PLO6, on the flush river and the paired river, against two callers and one. On the previous source the heads-up, paired-board and all-variant cases fail.
