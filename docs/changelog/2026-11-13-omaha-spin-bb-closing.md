# Omaha Spin Big Blind Closes The Action (2026-11-13)

## Change

`HorseOmahaTournamentFirstIn.ts`, new parameter `bigBlindClosingShare` (0.75). In a three-handed winner-take-all spin (Omaha high, 20 BB or less, the final table, one place paid), the big blind facing one raise after the third player folded, with no limper and no caller, at a price of a half or better, calls with its top 75 percent instead of the engine's fold. Everything else about the first-in rule (#10687) is unchanged. Option `omahaTournamentFirstIn` covers it; `{ bigBlindClosingShare: 0 }` is the first stage exactly.

## Evaluation

Declared before running (plo-handoff-review-01a1cbbd/plo-tournament/eval2/PROTOCOL.md, "Spin Big Blind Closing"): three seats, spin, payouts [100] (chip EV equals payout EV), fresh seed 90006, PLO4 and PLO6, 12/15/20 BB, 1,500 deal groups, opponents playing the production module; arm minus base in BB per hand, paired by deal group.

Pooled PLO4 and PLO6 (standard error): 12 BB +0.17 to +0.18 (0.04), 15 BB +0.18 to +0.19 (0.045), 20 BB +0.13 to +0.14 (0.05) against the old, tight, wide and re-shoving opponents; PASS at every declared depth, and no cell with its interval below zero (PLO4 at 15 and 20 BB is positive but within noise on its own). The re-shoving opponent equals the old one here: it changes only hands where it is the big blind.

## Limits

Every opponent is a Horse variant; the human-calibrated population is Hold'em only. Three-handed MTT final tables with pay jumps stay excluded (they lost in ICM equity, R4).
