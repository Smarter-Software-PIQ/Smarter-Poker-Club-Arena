# omahaReraiseRangeIsMeasured: Authority For The Live Switch

Built 2026-11-20 by EMERG lane PREFLOP-2 on the owner's orders of 2026-11-19 7:38 PM Chicago ("ITS MATH FIRST ... based on real decisions, math and all the data and statistics they have") and 2026-11-20 12:01 AM Chicago ("EVERYTHING DEPENDS ON THE MATH AND THE CONCLUSIONS YOU COME UP WITH"), graded on the lead's metric of 2026-11-20 1:42 AM (real chips). This file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

PLO4/PLO5 cash (tables and the Lightning pools), high only, one board, no bomb pot, preflop (`server/src/engine/HorseOmahaReraiseMeasured.ts`). The wager_rules node's final answer is a call of a pair of kings (no pair of aces) facing two raises (a 3-bet), the Horse acts after the last raiser on later streets, the engine offers a raise, and the call is not one that `omahaPreflopJamFacingReraiseIsPriced` priced. The call becomes the pot-size 4-bet (the all-in when the pot raise is the whole stack). That is the whole measured re-raise range for hands that are not aces: every other class and position was measured and stays as it is. A raise and a fold are never touched; the range is the same against every opponent.

Inputs are public information only: the Horse's own hole cards, the public action history, the chips and the seats. No opponent memory, no draw from the brain's random stream. PLO6, PLO8, hold'em and tournaments are byte-identical with the option on (law `HorseOmahaReraiseMeasured.law.test.ts`).

Receipt: `omaha_range_measured_reraise` (noteFire and the decision rule receipt, before call, after raise).

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only.

## What Was Measured

Every Horse preflop decision in PLO4/PLO5 cash hands with a person at the table, 2026-10-15 to 2026-11-19 (115,417 decisions, 23,238 hands). REAL chips of a decision = the part of the Horse's hand result that went to or came from persons (a loss is split pro rata over the hand's winners and deductions, a win over its losers), plus 1.9% of the deductions, all-in adjusted where the sign holds, plus the same share of the chips already in before the decision; rake and chips between Horses are internal and count as nothing. NET = the all-in-adjusted hand result from the decision on. The re-raise is compared with the call inside the same spot, strata weighted by their harmonic size; fit = before 2026-11-15, held out = 2026-11-15 to 2026-11-19. PASS = fit and held out both positive in real chips by more than one standard error. The hands that took each action were chosen by the brain, so these comparisons are weaker than a fold comparison; that is the stated limit of the instrument. No rule reads whether an opponent is a person or a Horse: the accounting is for grading only.

Re-raise minus call by hand class and position, real chips, bb a decision (the 3-bet = facing one raise, the 4-bet = facing two):

| Cell                                             | Real Fit         | Real Held Out    | Net Fit          | Net Held Out      | Verdict         |
| ------------------------------------------------ | ---------------- | ---------------- | ---------------- | ----------------- | --------------- |
| Kings, 4-bet, in position (119 / 50 calls)       | +26.65 +/- 18.00 | +73.89 +/- 29.58 | +7.23 +/- 20.11  | +64.37 +/- 30.54  | PASS, the range |
| Kings, 4-bet, out of position                    | +21.55 +/- 51.66 | -56.84 +/- 32.68 | +64.33 +/- 59.65 | -110.07 +/- 45.37 | FAIL            |
| Kings, 4-bet, all positions                      | +31.94 +/- 19.29 | +38.13 +/- 25.98 | +25.55 +/- 19.87 | +32.52 +/- 26.27  | PASS pooled     |
| Kings, 3-bet, small blind                        | +3.53 +/- 5.09   | +9.42 +/- 9.95   | +7.39 +/- 6.50   | +16.61 +/- 11.03  | FAIL on real    |
| Kings, 3-bet, out of position                    | +0.82 +/- 3.82   | +6.54 +/- 6.30   | +7.03 +/- 4.81   | +9.33 +/- 7.44    | FAIL on real    |
| Double-suited top 20%, 4-bet, table, in position | -6.02 +/- 18.38  | +41.12 +/- 41.50 | +16.52 +/- 14.91 | +52.12 +/- 34.80  | FAIL on real    |
| Double-suited, 4-bet, tables                     | +7.26 +/- 7.79   | +33.50 +/- 32.47 | +17.03 +/- 8.93  | +55.48 +/- 26.66  | INSUFFICIENT    |
| Queens or jacks with broadway, 3-bet             | +0.31 +/- 3.05   | -9.30 +/- 5.66   | +2.52 +/- 4.10   | -9.18 +/- 6.38    | FAIL            |
| Queens or jacks with broadway, 4-bet             | -5.14 +/- 15.54  | -17.78 +/- 23.31 | -4.07 +/- 16.25  | -15.79 +/- 20.95  | FAIL            |
| Double-suited rundown, 4-bet                     | +25.73 +/- 14.33 | -47.58 +/- 47.64 | -1.01 +/- 13.83  | -14.44 +/- 41.46  | FAIL            |

Inside the kings 4-bet: as the opener who was 3-bet, real fit +42.57 +/- 24.48 and held out +38.12 +/- 26.06; cold (facing an open and a 3-bet) -16.59 +/- 26.97 and -37.33 +/- 27.91 (13 and 4 raises). Limits, stated: the cell in the range passes at 1.48 standard errors on the fit period; its net fit figure alone would not pass (+7.23 +/- 20.11); the recorded 4-bets were the ones the brain chose (38 fit, 23 held out) and the rule extends them to every such call (63 in the held-out five days).

What it does to the face-up range: aces were 63% of the Horses' 4-bets from 11-15 to 11-19 (84% in the last 48 hours of the record, with omahaPressureNeedsPostflopAggression still on). With this option on the same decisions give 53% (57% in the last 48 hours), kings rising from 11% to 26% (4% to 35%); with `omahaAcesReraiseIsMeasured` on as well 59% (64%), because that option adds aces 4-bets. Horse VPIP and flop seen do not change.

Evidence NOT MET for a default-on; a lead switch decision only.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (the audited-decision scorer judges recorded complaints; this option was graded on the realised results, in real chips and net, of the recorded calls and re-raises of each hand class by position, fit and held out, see above)
