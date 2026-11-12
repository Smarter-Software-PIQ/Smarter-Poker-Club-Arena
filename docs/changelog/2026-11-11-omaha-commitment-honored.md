# A Horse that committed its stack does not fold a blank

Hand 58656644 (PLO5 1/2, 2026-11-11 22:39 UTC): turnbear42 four-bet A♠A♣J♣6♦4♦, bet a J-3-2 rainbow flop, called a check-raise that left 936 behind a 1,212 pot, then folded to a pot-sized bet on a 7♦ that completed nothing and gave it a flush draw. It lost 586 without seeing a river.

Both decisions came from the low-SPR commitment branch of `HorseLogic`. The flop call was priced there because the post-call SPR was under 1. The turn fold was priced there too: the Omaha pressure cap held a one-pair hand at 0.32 equity against a 0.3235 call bar, while the uncapped range equity read about 0.62 on both streets. Replaying the exact public state on protected main reproduced call then fold in 60 of 60 seeded runs.

A call that leaves less than a pot behind is the stack decision. `v88CommitmentHonored` (default on, explicit off arm) now makes the next street consistent with it: in cash Omaha high on a single board, a made hand (one pair or better) that called a wager on the previous street and now needs its whole stack at 0.345 of the final pot or better calls when the new card neither completes a flush or straight it does not beat nor pairs the board under trips, and its uncapped range equity still clears the price. The fire `v88_commitment_honored` records each use.

It applies heads-up, to a bet the Horse did not raise into. Unchanged: the flop decision itself, scare cards, a paired board under trips, non-nut straights and flushes, board-dominated hands, a raise over the Horse's own wager, pots with more than one opponent, tournaments, Hi-Lo, bomb pots, multiple boards, Hold'em, hands with no pair, and any call that already cleared its bar. The first version of the rule lacked the non-nut, dominated, raised and multiway exclusions; the pre-push suite refused it on nine existing dominated-flush and raised-river regressions, which now pass unchanged. This is one consistency rule. It does not retune the Omaha caps and it is not a claim about profitability.

Regression: `server/src/engine/HorseOmahaCommitmentHonored.test.ts` holds the exact hand (fold with the rule off, call with it on) and the exclusions.
