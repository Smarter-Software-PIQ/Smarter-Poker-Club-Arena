# commitUnderPot only removes a fold the price supports (HU-NLH-016)

Date: 2026-11-13

The flag `commitUnderPot` is default OFF and stays OFF. No live behaviour changes. This corrects the rule for
whoever turns it on, the two nightly league cards that deal it included.

## Why

`commitUnderPotCall` (server/src/engine/HorseLogic.ts) turned a heads-up flop or turn fold into a call whenever
the stack was smaller than the pot. The pot it compared already held the bet being faced, so every covering shove
passed the test whatever its size: with the flag on, a fold became a 38bb call into a 4bb pot with any hand (the
call needs 47.5%). The heads-up audit measured it: a player who over-shoves for value won 117.8 +/- 4.5 bb/100 at
40bb and 355.4 +/- 10.8 at 80bb against horses with the flag on, against -2.6 +/- 2.2 and +1.3 +/- 4.5 with it
off, and the horse mirror lost 2.00 +/- 0.31 bb/100 with the flag on (HU-EVAL-013).

## What

The fold is removed only when the call is priced in. What the horse puts in (the call, or its whole stack when
the call is all in for less than the bet) against the pot those chips win (the bet included, less the part of the
bet a short stack cannot match) may need no more than `COMMIT_UNDER_POT_MAX_PRICE`, a quarter: the pot lays three
to one or better, which is a bet of half the pot or less. The brain's own equity for the hand does not reach this
rule (a decision carries no equity and the rule also runs outside the brain), so the bound is a price alone and
needs no read of the hand. A call larger than what the pot lays is never made by this rule.

Unchanged: the scope (two players left in the hand and no all-in third player, no-limit hold'em, flop or turn,
one board, no bomb pot), the stack-under-the-pot test, the legal-action handling, the receipt `commit_under_pot`,
the league cards `hu_commit_under_pot` and `human_hu_commit_under_pot`, and the default.

## Tests

- New law `server/src/engine/HorseCommitUnderPotPrice.law.test.ts` (failing before on four of five, passing
  after): a covering shove of many times the pot stays folded; a pot-sized shove and a three-quarter-pot bet stay
  folded; a call at three to one or better is still made; a call for less than the bet is priced on what it can
  win; over a grid of 1,440 pots, bets and stacks the fold is removed exactly when the stack is under the pot and
  the price is a quarter or less.
- The existing commitUnderPot tests (HorseLimpReraiseRead.test.ts, HorseHeadsUpRuleScope.law.test.ts) pass
  unchanged, and both league cards still diverge.

## Evaluation

Declared before any result: 14 heads-up cells (25bb and 40bb; the horse mirror and the six human-field
opponents), 100,000 hands each, the new rule on against the flag off. The declaration and the results are in the
heads-up audit evidence folder (evaluation/DECLARATION-HU-NLH-016.md, evaluation/RESULTS-HU-NLH-016.md). The
default does not depend on the result.
