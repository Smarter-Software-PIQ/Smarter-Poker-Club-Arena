# A Straight Checks To Two Callers When The Flush Gets There

Hand 58796916 (PLO4 1/2 cash, 2026-11-12, reported by Dan): a Horse raised A-J-J-9, flopped the straight on 8-T-7 with two diamonds, bet 29 and then 89, and was called both times by the same two players. The river was the third diamond. The Horse held no diamond and moved all in for 225 into 397. One caller held a flush and won the pot.

Why it happened: the river value branches size a straight down on a board where a flush is possible, and nothing more. The only rule that checks to two players who each called two barrels (V40, `horse_continuation_omaha_called_through_flush_check`) applied to a third-nut-or-worse flush only. The Monte Carlo equity against unweighted hands still read the straight as a monster, so it bet its stack. Replaying the public state of that river on the previous source: a wager on 20 of 20 seeds.

The change: the same V40 condition (Omaha, river, one ordinary board, no split low, two or more opponents, two called barrels, at least two live opponents who each called two) now also checks a straight when a flush is possible on the board. New receipt: `horse_continuation_omaha_called_through_straight_check`.

Unchanged: a straight on a river with no flush possible still bets; a nut or second-nut flush still bets; heads-up pots, pots where a caller has folded, and lines where the callers called fewer than two barrels are untouched; facing a bet is a different branch and is untouched; Hold'em, Hi-Lo split boards and multiple-board hands are untouched. No range, sizing or threshold is retuned. One reported hand shows the defect; this is not a measurement of how often it occurs or what it costs.

Regression: `server/src/engine/HorseOmahaCalledThroughStraight.test.ts` builds the river of hand 58796916 from its public record. On the previous source the first two cases fail (the Horse wagers); the four controls pass on both.
