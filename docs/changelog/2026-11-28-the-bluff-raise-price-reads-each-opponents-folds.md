# The Bluff-Raise Price Reads Each Opponent's Folds

Date: 2026-11-28. Lane: HORSE DECISIONS. Option: `v78NoCommittingBluffRaiseIsPriced` (Hold'em, dark, default OFF, not switchable). Nothing live changes.

## What Was Wrong

The live rule `v78_no_committing_bluff_raise` refuses every Hold'em bluff raise that would put 40% or more of the Horse's stack in without being a jam. The dark option replaces that blanket refusal with a price: raise when the opponent folds often enough for the raise to earn more than calling or folding.

The honest grade of 2026-11-27 (18 cells, about 108,000 deals) found 0 divergent deals. The option made exactly the blanket rule's choices.

## Why

The price had one fold share for everybody. `HorseLogic` passed no opponent record to `priceCommittingBluffRaise`, because `HorseMind` kept no Hold'em count of what a player does when his bet is raised. Against the population's fold share a stack-committing bluff raise is never profitable, so the price always said no. That is the right answer for an unknown opponent and the wrong design for a price: it could not tell a player who folds nine times in ten from one who never folds.

## What Changed

1. **The count.** `HorseMind.observe` now counts, per player and per postflop street, the first answer of a player whose own bet or raise was raised: one answer, and one fold when he folded. It reads the public action stream the mind already receives, counts each action once, and counts Hold'em hands only. The rows live in their own map (`HorseMind.holdemFoldToRaise`, at most 4,000 players, least recently updated dropped first), in memory only. No table, no migration, no new field on any stored or journaled row.
2. **The estimate.** `committingBluffRaiseFoldBound` shrinks a player's count toward what people do, with 20 pseudo-answers, and takes the one-sided 95% lower bound of that estimate.
3. **The price.** `priceCommittingBluffRaise` uses the bettor's lower bound only from 10 answers on that street. Below that the price is exactly what it was. With it, the bettor's fold share is the smaller of the bound itself and the size-and-stack model shifted by how far the bound sits from people's rate. Other opponents in the pot still thin the fold share as before.
4. **The wiring.** `HorseLogic.v78CommitsWithoutJam` passes the read only inside the option's own branch and only when the decision uses the mind.

A committing bluff raise that is wrong costs a stack, which is why the price needs a minimum sample and uses the lower bound instead of the mean: ten folds in ten answers moves the fold share by about two points and changes nothing; ninety folds in a hundred allows the raise.

## The Prior, Measured

Read-only on production, 2026-11-28 about 1:25 AM Chicago time. Hands with at least one person, Hold'em, one board, no bomb pot, 2026-10-01 to 2026-11-28 1:00 AM Chicago time. People only. An answer is the first action of a player whose previous action on that street was a bet or full raise and who was raised in between.

| Street | People: folds / answers | Rate  | People | Without the top person | Rate  | Horses, same hands (scale only) |
| ------ | ----------------------- | ----- | ------ | ---------------------- | ----- | ------------------------------- |
| Flop   | 78 / 198                | 0.394 | 39     | 65 / 173               | 0.376 | 486 / 1,233 = 0.394             |
| Turn   | 67 / 167                | 0.401 | 45     | 57 / 148               | 0.385 | 292 / 790 = 0.370               |
| River  | 17 / 58                 | 0.293 | 26     | 14 / 51                | 0.275 | 86 / 227 = 0.379                |
| All    | 162 / 423               | 0.383 | 57     | 136 / 372              | 0.366 | 864 / 2,250 = 0.384             |

Pinned in `V78_FOLD_READ_PEOPLE_PRIOR` and `V78_FOLD_READ_EVIDENCE`. The river sample is thin (58 answers). People fold less on the river than the size-and-stack model's river base (0.537, measured mostly on Horses), which is one more reason the price never goes above the bettor's own lower bound.

## With The Option Off

Nothing changes. The option's branch is the only reader of the count. The count writes its own map and nothing else, so no other read, no decision, no stored row and no decision read frame differs. Proved by `HorseHoldemFoldToRaiseRead.test.ts` (same mind with and without the rows: identical decisions and receipts) and by the grade harness's no-op arm: 0 divergent deals in all 56 cells.

## The Grade

Bar declared before any run: `CRITERIA-V78READ-01Gw7aDq.md`, sha256 `77aa63a83dde5cbf0ae395baa39c0929c95834cedde94c528d4b8ef1c374f6b9`. Harness `server/scripts/horse-grade.ts`, unchanged. It keeps each world's Horse memory for the whole cell, so the read can learn inside a cell. Base options: all 80 live switch rows. 6,000 pairs or deals per cell, heads-up and 6-max, 100 bb and 40 bb.

All 56 cells finished: 0 illegal, 0 truncated, 0 no-op divergent deals in every cell (the no-op arm is the option off on both sides while the count collects).

| Opponent profile                                         | Cells | Deals or pairs | Divergent deals | ON minus no-op, bb/100 |
| -------------------------------------------------------- | ----- | -------------- | --------------- | ---------------------- |
| Mirror (Horses against Horses), seeds 1, 7, 42           | 12    | 72,000         | 0               | 0.00 ± 0.00            |
| Folder (over-folds turn and river), seeds 1, 7, 42       | 12    | 72,000         | 1               | -0.63 ± 0.63 (z -1.00) |
| Flop folder (over-folds the flop), seed 1                | 4     | 24,000         | 1               | +0.85 ± 0.85 (z +1.00) |
| Never folds postflop (bets, never folds), seeds 1, 7, 42 | 12    | 72,000         | 0               | 0.00 ± 0.00            |
| Caller (calls every bet, never bets), seed 1             | 4     | 24,000         | 0               | 0.00 ± 0.00            |
| Value only, seed 1                                       | 4     | 24,000         | 0               | 0.00 ± 0.00            |
| Balanced, seed 1                                         | 4     | 24,000         | 0               | 0.00 ± 0.00            |
| Over-bluffer, seed 1                                     | 4     | 24,000         | 0               | 0.00 ± 0.00            |
| **Pooled (the two cells that diverged)**                 | 56    | 336,000        | 2               | -0.11 ± 0.51 (z -0.21) |

The two cells that diverged are both heads-up at 100 bb, seed 1: folder -0.63 ± 0.63 and flop folder +0.85 ± 0.85, one deal each. Every 6-max cell and every 40 bb cell is 0.

**Verdict: FAIL.** Reach is met (the option now diverges, which it never did before), and nothing is harmed, but the value test is not met: pooled z is -0.21 against a bar of 2. The option stays OFF.

Why it fails, measured (a diagnostic run, not a graded cell: heads-up, 100 bb, 6,000 deals, seed 1, one ON world):

| Profile     | Times the option's spot came up | His answers on record at those times | His fold rate there    | Lower bound priced           |
| ----------- | ------------------------------- | ------------------------------------ | ---------------------- | ---------------------------- |
| Folder      | 5                               | 28, 35, 57, 92, 80                   | 0.76 to 0.89           | 0.56, 0.61, 0.69, 0.62, 0.71 |
| Flop folder | 4                               | 22, 23, 98, 56                       | 0.50, 0.52, 0.89, 0.55 | 0.33, 0.34, 0.74, 0.42       |
| Never folds | 1                               | 24                                   | 0.00                   | 0.09                         |

So the read works: it learns inside a cell (up to 98 answers), reads the folder as a folder and the player who never folds as one (lower bound 0.09, so the raise stays refused). What is missing is the spot. A legal non-jam bluff raise that adds 40% or more of the stack is proposed between one and five times in 6,000 heads-up deals. A price that is right about a spot that rare cannot move a win rate, with or without the read. That matches production, where the blanket rule fires about 250 times a day across the whole fleet.

## Known Limits

- The count is in memory only. It is not in the decision read frame, so a second look and an exact replay price the population (the veto). That must be closed, with a new frame version, before any switch-on.
- An engine restart empties it. It refills from the hands the engine observes afterwards.
- The option's spot is rare (see the grade). More reach would need the price to cover more than the blanket rule's own spot, which is a different option.
- The Horse SWITCH lane's lifetime Hold'em HUD holds a durable fold-to-raise count. This change does not read it.

## Tests

`server/src/engine/HorseHoldemFoldToRaiseRead.test.ts`, 17 tests. On the old code 15 fail (the count, the bound and the read do not exist; the price ignores the record). The option's law test, the HorseMind tests and the read-frame, replay and worker tests that touch the mind's sandbox: 94 files, 2,418 tests, all pass.
