# omahaColdCallOutsideBigBlindIsMeasured: Authority For The Live Switch

Built 2026-11-20 by EMERG lane PREFLOP-AUDIT on the owner's orders of 2026-11-19 7:38 PM Chicago ("ITS MATH FIRST ... based on real decisions, math and all the data and statistics they have") and 2026-11-20 12:01 AM Chicago ("EVERYTHING DEPENDS ON THE MATH AND THE CONCLUSIONS YOU COME UP WITH"). This file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

PLO4/PLO5 cash tables (not the Lightning pools), high only, one board, no bomb pot, preflop (`server/src/engine/HorseOmahaColdCallMeasured.ts`). The Horse faces exactly one raise from a player who is not all in, has less than one big blind in front of it (nothing, or the small blind), has not acted voluntarily in the hand, and the wager_rules node's final answer is a call that leaves chips behind. The call becomes a fold when the measured value of that call for the hand's class is below zero by more than one standard error. A pair of aces, a pair of queens or jacks with three broadway cards, and three broadway cards keep the call. A raise, a fold, the big blind, a limper facing a raise and every other spot are untouched.

Inputs are public information only: the Horse's own hole cards, the public action history and the chips. The same rule against every opponent, a person or a Horse. No opponent memory, no draw from the brain's random stream. PLO6, PLO8, hold'em, tournaments and Lightning are byte-identical with the option on (law `HorseOmahaColdCallMeasured.law.test.ts`).

Receipt: `omaha_cold_call_measured_fold` (noteFire and the decision rule receipt, before call, after fold). The response validator admits the fold through the node's existing PLO call-to-fold admission.

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only.

## What Was Measured

Data: every Horse preflop decision in PLO4/PLO5 cash hands with a person at the table, 2026-10-15 to 2026-11-19 (23,238 hands, 115,417 Horse decisions; production hand_history and ca_hand_facts, read-only). Value of a decision = the Horse's all-in-adjusted hand result (ca_hand_facts.ev_net_bb) plus the chips it had in before the decision, in big blinds, so a fold is exactly 0. Standard errors are of the mean; totals are clustered per hand. Fit = hands before 2026-11-15, held out = 2026-11-15 to 2026-11-19. Hand classes and strength deciles are computed offline from the Horse's own cards.

Cold call of one open, tables, a seat that is not the big blind (the class this option acts on):

| Slice                            | Calls | Value Of The Call, bb (fold = 0)                                                          |
| -------------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| All                              | 9,236 | -2.17 +/- 0.40                                                                            |
| Fit (to 11-14)                   | 6,012 | -2.49 +/- 0.50                                                                            |
| Held out (11-15 to 11-19)        | 3,224 | -1.57 +/- 0.66                                                                            |
| PLO4                             | 1,815 | -1.81 +/- 0.73                                                                            |
| PLO5                             | 7,421 | -2.26 +/- 0.46                                                                            |
| Small blind                      | 3,485 | -2.32 +/- 0.59                                                                            |
| Button                           | 2,819 | -1.47 +/- 0.81                                                                            |
| Cutoff                           | 1,956 | -2.82 +/- 0.82                                                                            |
| Hijack                           | 976   | -2.35 +/- 1.21                                                                            |
| Opener a Horse                   | 5,291 | -1.96 +/- 0.53                                                                            |
| Opener a person                  | 3,945 | -2.45 +/- 0.59                                                                            |
| Own stack 100 bb or less         | 888   | -2.09 +/- 0.90                                                                            |
| Own stack 100 to 250 bb          | 4,001 | -2.17 +/- 0.54                                                                            |
| Own stack over 250 bb            | 4,347 | -2.19 +/- 0.65                                                                            |
| Strength decile, weakest to best |       | -3.23, -2.91, -5.12, -0.56, -2.54, -2.63, -0.76, -1.15, -2.05, -1.32 (each SE 0.9 to 1.7) |

Not acted on, measured the same way: the big blind's call of the same open +0.59 +/- 0.48 (n 5,405); Lightning, a seat that is not the big blind, -0.19 +/- 1.12 for folding (n 1,452).

By class (the table in the source, `OMAHA_COLD_CALL_CLASS_VALUE`): aces -3.59 +/- 3.63 (n 106; kept, their measured better play is the re-raise: +18.8 +/- 4.7 bb over the call across spots); kings -3.93 +/- 2.34 (265); queens or jacks with three broadway cards +2.08 +/- 2.18 (519; kept); double-suited rundown -2.90 +/- 1.89 (560); rundown -6.25 +/- 1.56 (554); double-suited -1.73 +/- 0.69 (3,644); three broadway cards -0.71 +/- 1.58 (723; kept); a lower pair -2.06 +/- 0.78 (1,345); the rest -3.32 +/- 0.67 (1,520).

The exact rule (the classes it folds), value of folding instead of calling:

| Set                       | Calls | Hands | Total, bb         | Per Call, bb   |
| ------------------------- | ----- | ----- | ----------------- | -------------- |
| Fit (to 11-14)            | 5,115 | 3,655 | +14,878 +/- 2,563 | +2.91 +/- 0.53 |
| Held out (11-15 to 11-19) | 2,722 | 1,847 | +5,354 +/- 1,667  | +1.97 +/- 0.66 |
| PLO4, held out            | 289   | 254   | +223 +/- 275      | +0.77 +/- 0.98 |
| PLO5, held out            | 2,433 | 1,593 | +5,131 +/- 1,644  | +2.11 +/- 0.72 |

Verdict by the lead's rule of evidence: PASS (fit and held out both positive beyond one standard error). The PLO4 held-out slice alone is inside one standard error (INSUFFICIENT alone, same sign). The calls it keeps (aces, queens or jacks with broadway, broadway) grade +0.04 +/- 1.23 bb for folding (n 1,333): no evidence, so they are not folded.

Why the call loses: once a flop is seen the pot pays the rake (10 percent, cap 2.5 bb at these tables) and the 0.6 bb jackpot fee, the flat call has no fold equity, and a seat that is not the big blind has no discount. Limits: the measurement is on hands with a person dealt in (Horse-only hands were not pulled); results are realised, not solver values; the effect on the Horses' voluntary-entry rate on tables is a fall of about 11 percent of first decisions (7,837 of 71,246).

Evidence NOT MET for a default-on; a lead switch decision only.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (the audited-decision scorer judges recorded complaints; this option was graded on realised all-in-adjusted results of 9,236 recorded calls, fit and held out, see above)
