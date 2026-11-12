# A Honored Commitment Answers One Wager, Not A Raised Street

`v88CommitmentHonored` (2026-11-11, hand 58656644) lets a cash Omaha made hand that called a wager on the previous street call its whole stack on a blank at 0.345 of the final pot or better, heads-up, against a bet it did not raise into. The independent verifier asked whether three places where the rule overrides the older pricing were intended. Each was reproduced on protected main before anything changed.

Intended, and now held by regression:

- **Uncapped equity.** The rule compares uncapped range equity with the price plus two points. That is the rule: the fold it replaces in hand 58656644 is the Omaha pressure cap holding a one-pair hand at 0.32 against a 0.3235 bar. Inside the gate the scare margin is already zero (a scare card excludes the rule) and every Hold'em and bet-then-raised shade is zero by construction, so the only other term it steps over is the all-in premium on the capped bar. The same wager made as an all-in is now a test case.
- **Weak made hand.** The capped weak made hand is the incident hand itself. The test now asserts that the fold being replaced carries `dominated_commitment_floor` and the pressure-cap fire.
- **River.** A called turn bet followed by a stack-sized bet on a blank river is honored on the same terms. Now a test case.

Not intended, corrected:

- **A raised street that became heads-up.** With one opponent left and the Horse not having bet, the multiway pressure read is above zero only when the pot was multiway as the money went in and a player folded since. Example reproduced: the villain bets, a third player raises, the Horse calls, the villain moves all in, the raiser folds. The first version called a one-pair stack off there and removed the `multiway_commitment_floor` fold, which contradicts its own stated limit of one bet and one opponent. The gate now requires the wager the Horse faces to be the street's only opponent aggression (`pressure20 === 0`). A raise over a bet the Horse had called, after the bettor folded, keeps the existing pricing for the same reason.

Unchanged: the price, the hand classes, the scare, pairing, domination and cold-flush exclusions, the flop decision, tournaments, Hi-Lo, bomb pots, multiple boards and Hold'em. A street on which a third player folded without raising is still honored, and is a test case. This narrows one rule to its written scope. It does not retune the Omaha caps and it is not a claim about profitability.

Regression: `server/src/engine/HorseOmahaCommitmentHonored.test.ts`, 17 cases. The two raised-street cases fail on the previous source and pass on this one. New unchanged cases also cover a turn card that completes a low or a high straight the hand does not hold.
