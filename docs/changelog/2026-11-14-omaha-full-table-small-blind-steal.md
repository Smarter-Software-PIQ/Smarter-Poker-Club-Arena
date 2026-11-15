# Omaha Tournaments, Four To Eight Dealt: The Small Blind Folded To Plays Its Top 40 Percent (2026-11-14)

## Change

`HorseOmahaTournamentFirstIn.ts` gains `fullTableSbStealShare` (0.4) and `fullTableSbStealMaxStackBB` (20). In PLO4 and PLO5 tournaments with four to eight players dealt, when the hand is folded to the small blind and only the big blind is left, at an effective stack of 20 BB or less, a Horse small blind whose hand is at or above the 0.60 percentile among Omaha hands of its size now makes the pot-limit raise (or all-in) where the preflop engine chose to fold. Only a fold changes: every hand the engine already limped or raised is untouched, and the big blind's decision is never touched. The share is flat (the tournament risk premium does not narrow it). The tournament utility arbiter still owns the final action.

It stands aside on the money bubble (the feed's near-bubble line, players left above the paid places and within one place or 15 percent of them, and the feed's `nearBubble` flag), hand-for-hand (on or expected), in any satellite, for a locked satellite seat, at All-In-Or-Fold tables, when players left or the payout is unknown or untrusted, in PLO6, Hi-Lo, cash, at three or fewer dealt (the existing short-handed rule) and at nine or more dealt. The bubble, hand-for-hand and satellite flags come from the trusted tournament context (`omahaFirstInStage` in `HorseLogic.ts`). Setting the share to 0 restores the previous behaviour; league arms may pass it as a partial parameter. The option is the existing `omahaTournamentFirstIn` (on by default since 2026-11-13).

A new receipt, `omaha_full_table_sb_steal`, fires whenever this rule replaces a fold (registered in `HorseDataLedger.ts`); the short-handed rule keeps `omaha_tournament_first_in`.

## Evaluation

Declared in `ITEM4-PROTOCOL.md` section B (frozen 2026-11-14T17:55Z) and fixed in a run file written before any real run (agent-evidence `plo-handoff-review-01a1cbbd/evals-wave3-01UxDLnH/sb-steal/`: RESULTS.md, frozen-run/RUN-FILE.md, frozen-run/analysis-output.txt). One candidate (sb40), evaluated exactly as built here apart from the stage flags, which the harness does not carry. Offline tournament league, PLO4 and PLO5, 6 and 8 handed, 10/14/18 BB, eighteen or twenty-four players left with three paid (50/30/20), fresh seed per cell, 4,000 deal groups per cell, conserved Malmuth-Harville prize equity, paired difference against the shipped engine. Opponents: the baseline Horse field (old), the adaptive field (big blind re-shoves its top 50 percent against one raise) and a counter-exploitation field (callwide50: big blind calls its top 50 percent). Verdict PASS on all four parts of the declared bar.

Percent of the prize pool per hand, sb40 minus shipped (standard error):

| Field                     | Pooled                        | 10 BB / 14 BB / 18 BB cells                                                  |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| Old                       | +0.002218 (0.000144)          | every 10 and 14 BB cell above zero; 18 BB exactly 0                          |
| Adaptive                  | +0.001233 (0.000257)          | lowest acting cell PLO5 8-handed 14 BB +0.000189 (0.000748); 18 BB exactly 0 |
| Callwide50                | +0.001297 (0.000217)          | no cell below zero                                                           |
| Old + adaptive (24 cells) | +0.001725 (0.000147), z +11.7 | no cell below -1 SE                                                          |

Controls: in the money with pay jumps (6 left, all paid) +0.012205 (PLO4) and +0.013176 (PLO5); on the stone bubble (6 left, 5 paid) the arms differ in 0 of 4,000 groups.

## Limits

At 18 BB the candidate never acted against the old and adaptive fields (0 of 4,000 groups in all eight cells) and once in each 6-handed callwide50 cell, so the value comes from 10 and 14 BB; the 14-20 BB band is effectively untested. The harness carries no hand-for-hand, near-bubble or satellite flag: those gates are tested here as code but were not in the evaluation. Opponents are Horse fields only (no human-like opponent). Stacks were reset every hand; one payout ladder (50/30/20) in the main grid. Simulated prize-equity gains are not production gains.

## 2026-11-15: opt-in in source

In the PLO strategy head the full-table small blind rule has its own option, `omahaSmallBlindSteal`, read `=== true`: off in source, so unset the full-table share is zero and the tournament first-in rule is the short-handed one only. It is switched on live by the option switch, not by a source default. Unmeasured; no evaluation was run.
