# A Short Stack Keeps Its Priced-In Call Against A Big Bet (V81)

V81 folds a PLO4 or PLO5 call of a wager of 0.9 pot or more in the cells where those calls measurably lost. It measured the wager and never the price the Horse itself pays. A stack far shorter than the wager pays much less than a third of the final pot, and V81 folded it anyway.

Hand 58724590 (PLO5 cash, 2026-11-12, finding HVH2D-PLO-005): a Horse holding a ten-high straight on K-9-8-7-6 with no flush possible had 46 big blinds behind and faced a pot-sized river bet of 335 big blinds. Calling cost 0.065 of the final pot and one two-card holding beat it. The reference decision was a call; the V81 node replaced it with a fold. Replaying the retained original on main reproduces the fold in 10 of 10 runs with `v81_omaha_big_bet_call_fold`, and an all-in call in 10 of 10 with the rule off.

`V81_MIN_CALL_PRICE = 0.13`: V81 now folds only when the call the Horse can actually make, `min(toCall, stack) / (pot + min(toCall, stack))`, is 0.13 of the final pot or more. This is the price and the floor V84 already documents for the same reason: the evidence was measured on calls at about a third of the pot and says nothing about a call this cheap. V86's own floor is 0.16.

Unchanged: every measured cell at a price of 0.13 or more (the second V81 fold in the same study, at 0.168, still folds), the wager threshold, the 20 big blind effective-stack limit, the hand classes, V84, V86, the paired-board fold, PLO6, tournaments, Hi-Lo. No range, cap or threshold is retuned. One retained hand shows the defect; it is not evidence of how often it occurs or of profit.

Regression: `server/src/engine/HorseOmahaBigBetCalls.law.test.ts`. The cell test pins the floor (0.13 admitted, 0.129 and an unknown price refused). The end-to-end case builds the same shape (dead money in the pot, a pot-sized river bet, 22 big blinds behind, price 0.11): on the previous source V81 fires on 30 of 30 seeds; now the answer equals the rule-off answer and never folds, while the same pot with a stack paying 0.20 still folds.
