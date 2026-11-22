# omahaRundownReraiseRangeIsMeasured: Authority For The Live Switch

Built 2026-11-20 by EMERG lane RUNDOWNS on the owner's orders of 2026-11-20 1:50 AM Chicago ("Don't forget to add in the rundown 3-bet / 4-bet ranges as well") and 12:01 AM Chicago ("EVERYTHING DEPENDS ON THE MATH AND THE CONCLUSIONS YOU COME UP WITH"), graded on the lead's metric of 2026-11-20 1:42 AM (real chips). This file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

PLO4/PLO5 cash (tables and the Lightning pools), high only, one board, no bomb pot, preflop, three or more dealt in (`server/src/engine/HorseOmahaRundownReraiseMeasured.ts`). The measured rundown re-raise range, cell by cell. Today the measured set holds one cell: the Horse is in a blind, faces one raise that one player or more has called, has not acted, acts before the raiser on later streets (a squeeze out of position), holds a high rundown (the top card of its connected four is ten or higher) and has an own stack above 250 big blinds. There a re-raise that the wager_rules node entered with becomes the call. A call, a fold and every other re-raise are untouched; no call becomes a re-raise under this option (no such cell passed). The range is the same against every opponent.

Inputs are public information only: the Horse's own hole cards, the public action history, the chips and the seats. No opponent memory, no draw from the brain's random stream. The response validator re-runs the cell on the request and admits the raise to call only there, for the exact chips of the call. PLO6, PLO8, hold'em and tournaments are byte-identical with the option on (law `HorseOmahaRundownReraiseMeasured.law.test.ts`).

Receipt: `omaha_rundown_measured_call` (noteFire and the decision rule receipt, before raise, after call).

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only.

## What Was Measured

Rundowns were classified by structure from the Horse's own cards only (connectedness and where the gap is, height, suits, pairs inside, the fifth card in PLO5, nut potential). The classes, spots, grade and pass rule were declared before any result by structure was read (archive `repairs/EMERG/CRITERIA-RUNDOWNS.md`, sha256 eeb36ba851aafdf10c07edbe7460bfe4609abfa965a1139ed7c04e0df192c741).

Data: every Horse preflop decision facing a raise in PLO4/PLO5 cash hands with a person at the table, 2026-10-15 to 2026-11-19 (43,400 decisions with cards in a re-raise spot; 11,620 rundowns). REAL chips of a decision = the part of the Horse's hand result that went to or came from persons (a loss split pro rata over the hand's winners and deductions, a win over its losers), plus 1.9% of the deductions, all-in adjusted where the sign holds, plus the same share of the chips already in; rake and chips between Horses count as nothing. NET = the all-in-adjusted hand result from the decision on. The re-raise is compared with the call inside the same spot, strata (stack band, game, table or Lightning) weighted by harmonic size; fit = before 2026-11-15, held out = 2026-11-15 to 2026-11-19. The hands that took each action were chosen by the brain; that is the stated limit of the instrument.

290 class-by-spot cells were graded. Re-raise minus call, real chips, bb a decision:

| Cell                                                      | Re-Raises / Calls | Real Fit         | Real Held Out    | Net Fit          | Net Held Out     | Verdict                |
| --------------------------------------------------------- | ----------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------------- |
| 3-bet in position facing an open, all rundowns            | 401 / 1,675       | +7.47 +/- 4.42   | -2.44 +/- 5.27   | +6.60 +/- 5.69   | +2.29 +/- 5.84   | INSUFFICIENT (level)   |
| Squeeze in position, all rundowns                         | 96 / 574          | +11.22 +/- 7.55  | +2.76 +/- 8.58   | +14.62 +/- 11.41 | +0.72 +/- 13.04  | INSUFFICIENT           |
| 4-bet in position as the opener, all rundowns             | 109 / 385         | +4.95 +/- 15.61  | -16.37 +/- 25.64 | -3.74 +/- 14.91  | +5.25 +/- 24.26  | INSUFFICIENT           |
| 3-bet from a blind out of position, all rundowns          | 194 / 971         | -1.86 +/- 3.60   | -17.81 +/- 11.69 | -0.02 +/- 3.83   | -15.17 +/- 12.31 | FAIL (stays out)       |
| Squeeze from a blind out of position, all rundowns        | 210 / 1,550       | -10.74 +/- 5.05  | -18.51 +/- 10.36 | +0.36 +/- 6.41   | -7.77 +/- 11.65  | The call passes        |
| the same, own stack above 250 bb, high rundown (THE CELL) | 92 / 394          | -27.35 +/- 11.40 | -34.99 +/- 16.58 | -19.08 +/- 12.06 | -22.55 +/- 17.99 | The call passes, built |
| the same squeeze, own stack 100 to 250 bb                 | 85 / 703          | +2.03 +/- 5.42   | +0.35 +/- 9.38   | +13.54 +/- 9.81  | +0.48 +/- 11.66  | level, not touched     |
| 4-bet out of position as the opener, all rundowns         | 30 / 314          | -1.79 +/- 17.82  | -7.91 +/- 79.26  | +23.12 +/- 25.37 | -2.88 +/- 83.11  | INSUFFICIENT           |
| Cold 4-bet, all rundowns                                  | 42 / 229          | -1.48 +/- 13.45  | -8.75 +/- 12.08  | -20.54 +/- 18.13 | -9.11 +/- 26.85  | NO DATA                |

No cell where the re-raise beats the call passes beyond chance: one of the 290 cells passed (the 4-bet in position with a one-gap-in-the-middle rundown, 17 re-raises, net fit -28.28 +/- 60.67), where about seven pass on noise alone; less the finer cells that fail inside it 7 re-raises are left, so it is not in the measured set. Inside the built cell (fit and held out): PLO5 -30.87 +/- 12.96 and -34.99 +/- 16.58, tables -24.19 +/- 11.38 and -40.39 +/- 17.82, double suited -24.37 +/- 12.87 and -40.34 +/- 16.98, the small blind -29.77 +/- 12.20 and -34.97 +/- 18.57, the big blind -23.49 +/- 17.79 and -38.81 +/- 29.03, every core card ten or higher -33.38 +/- 15.97 and -46.58 +/- 21.65, stack 250 to 400 bb -27.37 +/- 14.68 and -39.75 +/- 26.84, above 400 bb -15.04 +/- 15.93 and -30.99 +/- 20.98. Weak slices: PLO4 -1.91 +/- 3.78 on 8 re-raises (fit only), Lightning held out -6.78 +/- 44.49 on 8, single suited held out +68.88 +/- 51.10 on 2 re-raises. The recorded re-raises in the cell lost 28.66 +/- 9.62 real bb each against folding; the calls -0.23 +/- 1.28. Kings (+2.43 +/- 13.56, -7.12 +/- 10.90), queens or jacks with broadway (+18.30 +/- 15.07, +28.07 +/- 30.63) and double-suited hands that are not rundowns (-6.85 +/- 15.69, +26.84 +/- 14.79) squeezing from a blind above 250 bb do not lose, so the cell is the rundown's. Limits, stated: the stack bound and the height bound were set after the grade showed where the loss sits (the declared cell, every rundown at every stack, passes as well); the recorded re-raises were the ones the brain chose.

What it does to the Horses' numbers (2026-11-15 to 2026-11-19, hands with a person): 42 re-raises in five days become calls (34 on tables, 8 in Lightning). Table 3-bet share 8.97% to 8.61% (small blind 6.07% to 5.44%, big blind 7.64% to 6.87%), Lightning 9.47% to 9.29%; PFR 16.34% to 16.19% on tables and 17.50% to 17.44% in Lightning; VPIP and flops seen do not change (a re-raise becomes a call, never a fold). The aces share of 3-bets rises from 28.1% to 29.3% on tables and from 33.5% to 34.1% in Lightning: the cell removes rundown re-raises, and the measurement says those cost real chips.

Evidence NOT MET for a default-on; a lead switch decision only.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (the audited-decision scorer judges recorded complaints; this option was graded on the realised results, in real chips and net, of the recorded calls and re-raises of each rundown class by spot, fit and held out, see above)
