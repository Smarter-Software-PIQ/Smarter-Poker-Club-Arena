# Omaha Tournament First-In: Winner-Take-All Spins Up To 30 BB (2026-11-14)

## Change

`HorseOmahaTournamentFirstIn.ts` gains `winnerTakeAllMaxStackBB` (30). At a three-handed table that pays one place (a winner-take-all spin, the only three-handed case the rule acts in), the rule now acts up to 30 BB effective instead of 20 BB: the small blind against the big blind alone pot-raises instead of folding, and the big blind closing the action against one raise calls its top 75 percent at a price of a half or better. Shares are unchanged. Heads-up keeps `maxStackBB` 20. Every existing exclusion stays: All-In-Or-Fold, a locked satellite seat, four or more players dealt, not the final table or players left unknown, three-handed with pay jumps, cash, Hold'em and Hi-Lo. In production the small blind still folded first in 50 percent of the time in three-handed spins deeper than 20 BB.

## Evaluation

Protocol declared before running (agent-evidence first-in-followups-01UxDLnH/PROTOCOL.md). Same harness, metric and pairing as eval2: every deal played from each seat, paired difference candidate (maxStackBB 30) minus the shipped rule on the same deals, big blinds per hand, standard error of the per-deal differences, 1,500 deal groups per cell, fresh seed 93002. Opponents run the shipped rule: old (style balanced), tight (tag), wide (lag), adaptive (its big blind re-shoves its top half against one raise). Acceptance: pooled PLO4+PLO5 95 percent interval above zero against at least three of four opponents at each depth, and no cell below zero.

Three-handed winner-take-all spin, pooled PLO4+PLO5 (3,000 groups each):

| Opponent | 22 BB        | 25 BB        | 30 BB        |
| -------- | ------------ | ------------ | ------------ |
| Old      | +0.22 (0.05) | +0.22 (0.05) | +0.16 (0.05) |
| Tight    | +0.21 (0.05) | +0.21 (0.05) | +0.15 (0.05) |
| Wide     | +0.18 (0.05) | +0.17 (0.05) | +0.16 (0.05) |
| Adaptive | +0.15 (0.05) | +0.15 (0.05) | +0.14 (0.05) |

No cell below zero (smallest single-variant cell PLO5 adaptive 22 BB +0.087 (0.074)). PASS.

Heads-up final table, same extension: +0.15 to +0.39 pooled against old, tight and wide at every depth, but the adaptive opponent at PLO5 30 BB was -0.172 (0.055), below zero. FAIL by the declared rule, so heads-up stays at 20 BB.

## Not Adopted (Same Protocol)

- A narrower small blind first-in share at 16 to 20 BB (0.85 or 0.70 instead of every hand), heads-up and spin, seed 93001: no arm passes. Heads-up, 0.70 loses 0.07 to 0.10 BB per hand pooled against old, tight and wide (eight single-variant cells below zero) and 0.85 loses 0.02 to 0.04 (no cell below zero); in spins both are within 0.01 of the shipped rule against old, tight and wide and gain about +0.02 to +0.03 against the adaptive opponent, which is not enough under the rule.
- A payout-aware three-handed version for final tables with pay jumps (small blind plays its top 60 percent narrowed by the risk premium, no big blind call), payouts 25/17/13 scored in ICM equity as in R4, seed 93003: below zero against the adaptive and call-heavy opponents (seven cells). Not built. The R4 scoring values a busted player at zero rather than its locked third prize, which biases that comparison against any wider candidate; this is noted, not corrected, in the evidence.

## Limits

Opponents are Horse-derived only (styles, a re-shove rule, a call rule); no human-derived opponent is qualified for Omaha. PLO6 was not run; the change applies to PLO6 as the existing rule does.
