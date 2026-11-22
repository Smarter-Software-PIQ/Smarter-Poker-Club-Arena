# omahaAcesReraiseIsMeasured: Authority For The Live Switch

Built 2026-11-20 by EMERG lane PREFLOP-2 on the owner's orders of 2026-11-19 7:38 PM Chicago ("ITS MATH FIRST ... based on real decisions, math and all the data and statistics they have") and 2026-11-20 12:01 AM Chicago ("EVERYTHING DEPENDS ON THE MATH AND THE CONCLUSIONS YOU COME UP WITH"), graded on the lead's metric of 2026-11-20 1:42 AM (real chips). This file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

PLO4/PLO5 cash (tables and the Lightning pools), high only, one board, no bomb pot, preflop (`server/src/engine/HorseOmahaReraiseMeasured.ts`). The wager_rules node's final answer is a call or a fold of a pair of aces facing two raises (a 3-bet), the Horse's stack is 250 big blinds or less, the engine offers a raise, and the decision is not one that `omahaPreflopJamFacingReraiseIsPriced` priced (its receipt on the decision: one owner per cell). It becomes the pot-size re-raise (the all-in when the pot raise is the whole stack). Every other decision with aces stands.

Inputs are public information only: the Horse's own hole cards, the public action history, the chips and the seats. The same rule against every opponent, a person or a Horse. No opponent memory, no draw from the brain's random stream. PLO6, PLO8, hold'em and tournaments are byte-identical with the option on (law `HorseOmahaReraiseMeasured.law.test.ts`).

Receipt: `omaha_aces_measured_reraise` (noteFire and the decision rule receipt, before call or fold, after raise). The response validator admits a raise from the wager_rules node as it does for every rule that adds aggression.

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only.

## What Was Measured

Every Horse preflop decision in PLO4/PLO5 cash hands with a person at the table, 2026-10-15 to 2026-11-19 (115,417 decisions, 23,238 hands). REAL chips of a decision = the part of the Horse's hand result that went to or came from persons (a loss is split pro rata over the hand's winners and deductions, a win over its losers), plus 1.9% of the deductions, all-in adjusted where the sign holds, plus the same share of the chips already in before the decision; rake and chips between Horses are internal and count as nothing. NET = the all-in-adjusted hand result from the decision on. The re-raise is compared with the call inside the same spot, strata weighted by their harmonic size; fit = before 2026-11-15, held out = 2026-11-15 to 2026-11-19. PASS = fit and held out both positive in real chips by more than one standard error. The hands that took each action were chosen by the brain, so these comparisons are weaker than a fold comparison; that is the stated limit of the instrument. No rule reads whether an opponent is a person or a Horse: the accounting is for grading only.

Aces facing a raise were flat-called 677 times with a raise legal, re-raised 1,648 times and folded 102 times. Re-raise minus call, bb a decision:

| Cell                                               | Real Fit         | Real Held Out    | Net Fit          | Net Held Out     | Verdict           |
| -------------------------------------------------- | ---------------- | ---------------- | ---------------- | ---------------- | ----------------- |
| A 3-bet, stack 250 bb or less (81 / 47 calls)      | +13.06 +/- 9.11  | +37.03 +/- 11.67 | +37.89 +/- 10.13 | +45.34 +/- 12.71 | PASS, in the rule |
| One raise, two or more live, above 100 bb (56/122) | +5.92 +/- 2.84   | -1.52 +/- 4.76   | +14.29 +/- 4.06  | +7.96 +/- 6.52   | FAIL on real      |
| One raise, heads-up (the big blind closing)        | +7.44 +/- 5.50   | -24.81 +/- 12.81 | +7.95 +/- 7.80   | -25.30 +/- 13.30 | FAIL              |
| One raise, two or more live, 100 bb or less        | -7.72 +/- 5.20   | no sample        | -3.14 +/- 8.25   | no sample        | not in the rule   |
| A 3-bet, stack above 250 bb                        | +8.13 +/- 16.94  | +7.67 +/- 20.66  | +5.04 +/- 18.22  | +22.62 +/- 20.55 | INSUFFICIENT      |
| The 3-bettor facing a 4-bet                        | +28.82 +/- 23.62 | -44.81 +/- 29.54 | -9.57 +/- 38.97  | -9.58 +/- 40.57  | FAIL              |

The cell facing one raise passes on net and fails on real chips: what the 3-bet of aces gained over the flat there was rake and other Horses' chips, so it is not in the rule. Inside the cell in the rule, real chips: in position fit +8.73 +/- 14.77 and held out +83.21 +/- 23.43; out of position +15.57 +/- 12.19 and +18.28 +/- 13.04; tables +7.40 +/- 9.82 and +35.40 +/- 13.10; Lightning +19.81 +/- 21.38 and +43.44 +/- 21.08; PLO5 +16.51 +/- 10.09 and +39.03 +/- 12.43. Weak slices, stated: PLO4 fit -10.54 +/- 20.53 (14 calls); heads-up held out -1.94 +/- 15.64 after +21.22 +/- 12.72 fit; 100 bb or less +1.69 +/- 8.01 fit.

The fold: aces were folded facing a 3-bet at 250 bb or less 22 times (16 fit, 6 held out). The recorded re-raises in that cell earned, against folding, real +15.11 +/- 6.33 bb (fit) and +28.40 +/- 10.25 (held out); the call earned real +2.58 +/- 6.24 and -5.87 +/- 5.10. PASS for the re-raise, so that fold becomes the re-raise.

Size of the change: 58 decisions in the held-out five days (52 calls, 6 folds), 22 in the last 48 hours. At the measured difference: about +1,058 +/- 738 bb real over the fit calls and +1,740 +/- 548 bb real over the held-out calls. Horse VPIP and flop seen do not change; PFR +0.1 point.

Evidence NOT MET for a default-on; a lead switch decision only.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (the audited-decision scorer judges recorded complaints; this option was graded on the realised results, in real chips and net, of 2,427 recorded decisions with aces facing a raise, fit and held out, see above)
