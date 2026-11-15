# Omaha Tournament First-In: Three-Handed Final Tables With Pay Jumps (2026-11-14)

## Change

`HorseOmahaTournamentFirstIn.ts` gains `payJumpBlindVsBlindShare` (0.6). At a three-handed final table with pay jumps where every player left is paid (for example 25/17/13 with three left), the small blind against the big blind alone now pot-raises its top 60 percent of Omaha hands (narrowed by the engine's tournament risk premium, two points of range per point) instead of folding, at 20 BB or less. The big blind keeps the engine's fold there (no closing call). Before this change the rule stood aside at every three-handed table paying more than one place. Every other exclusion stays: a money bubble (three left, two paid) and an unknown payout, All-In-Or-Fold, a locked satellite seat, four or more players dealt, not the final table or players left unknown, cash, Hold'em and Hi-Lo. Heads-up and winner-take-all spins are unchanged. Setting the share to 0 restores the previous behaviour; league arms may pass it as a partial parameter.

## Why the earlier exclusion was wrong

The pay-jump exclusion came from evaluation R4 (2026-11-13) and was confirmed by the A3 follow-up (2026-11-14). Both scored a busted player at 0 percent of the prize pool instead of the third prize it had already locked (13 of 25/17/13), so ICM equity was not conserved and every extra bust was over-charged 13 points; the shipped rule playing itself scored -0.368 per hand where the correct value is exactly 0. The earlier R4 exclusion rested on that scoring error.

## Evaluation

Protocol declared before running (agent-evidence pay-jump-rescore-01UxDLnH/PROTOCOL.md). Three seated, three left, payouts 25/17/13, scored in conserved ICM equity (survivors share the remaining places by ICM; a busted player gets its finishing prize; equity sums to the remaining pool at every scoring point, asserted in the harness). Scoring validation: the shipped rule against itself scores exactly 0 in every variant and depth. PLO4 and PLO5, 8/12/20 BB, fresh seed 97003, 1,500 deal groups per cell (each deal played from every seat), paired difference against the rule off. Opponents run the shipped rule and are Horse-derived only: old (balanced), tight (tag), call-heavy (its big blind calls one raise whenever it would fold), adaptive (its big blind re-shoves its top half against one raise). Acceptance: pooled PLO4+PLO5 95 percent interval above zero against at least two of four opponents, and no cell below zero.

Percent of the prize pool per hand, pooled PLO4+PLO5 over 8/12/20 BB (9,000 groups each):

| Opponent   | Small blind top 60%, no BB call (built) | Shipped shares at pay jumps |
| ---------- | --------------------------------------- | --------------------------- |
| Old        | +0.021 (0.001)                          | +0.068 (0.004)              |
| Tight      | +0.023 (0.001)                          | +0.073 (0.004)              |
| Call-heavy | +0.009 (0.003)                          | +0.004 (0.007)              |
| Adaptive   | +0.008 (0.003)                          | -0.001 (0.006)              |

Both pass (the built arm against all four opponents, the shipped shares against old and tight; no cell below zero in either). By the declared tie-break, the larger pooled gain against the adaptive opponent, the narrowed version is built. Gains are small and shrink with depth (about zero at 20 BB).

## Limits

Opponents are Horse-derived only; no human-derived opponent is qualified for Omaha. Only the 25/17/13 ladder with three left was measured. PLO6 was not run; the change applies to PLO6 as the existing rule does.
