# omahaRundownReraiseRangeTrial: Authority For The Live Switch

Built 2026-11-20 by EMERG lane RUNDOWNS on the owner's orders of 2026-11-20 1:50 AM Chicago ("Don't forget to add in the rundown 3-bet / 4-bet ranges as well"; earlier: rundowns are better re-raising hands than AKQQ-type, players re-raise in position to build pots and get information) and 12:01 AM Chicago ("EVERYTHING DEPENDS ON THE MATH AND THE CONCLUSIONS YOU COME UP WITH"). This file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured. THIS OPTION IS A TRIAL: its cells are not proven by the Horses' own record.

## What It Does

PLO4/PLO5 cash (tables and the Lightning pools), high only, one board, no bomb pot, preflop, three or more dealt in (`server/src/engine/HorseOmahaRundownReraiseMeasured.ts`). The wager_rules node's final answer is a call, the engine offers a raise, the call is not one that `omahaPreflopJamFacingReraiseIsPriced` priced, and the hand and spot are one of the trial cells:

1. The 3-bet in position: the Horse faces one raise that nobody has called, has not acted, and acts after the raiser on later streets. The hand is a rundown with no gap, double suited, no pair, the top card seven or higher, and in PLO5 the fifth card inside the run.
2. The 4-bet in position, PLO5: the Horse opened, faces a 3-bet, and acts after the 3-bettor on later streets. The hand is five connected cards (the fifth card inside the run), no gap or one gap, no pair, and a suited ace or a top card ten or higher.
3. Depth, in position with an own stack of 250 big blinds or less, a tier A or B rundown (A = double suited, no gap or one gap, top card ten or higher; B = single suited with no gap or one gap and a top card ten or higher, or double suited with two gaps or a pair inside and a top card ten or higher, or double suited with no gap or one gap and a top card 7 to 9; never a low or rainbow rundown): (a) the squeeze (one raise and a caller or more, the Horse has not acted) and the 4-bet as the opener facing a 3-bet; (b) the 3-bet facing an open nobody has called.

The call becomes the pot-size re-raise (the all-in when the pot raise is the whole stack). A raise and a fold are never touched; the range is the same against every opponent. Inputs are public information only: the Horse's own hole cards, the public action history, the chips and the seats. PLO6, PLO8, hold'em and tournaments are byte-identical with the option on (law `HorseOmahaRundownReraiseMeasured.law.test.ts`).

Receipt: `omaha_rundown_trial_reraise` (noteFire and the decision rule receipt, before call, after raise).

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only.

## What Was Measured

The classes, spots, grade and the trial rule were declared before any result by structure was read (archive `repairs/EMERG/CRITERIA-RUNDOWNS.md`, sha256 eeb36ba851aafdf10c07edbe7460bfe4609abfa965a1139ed7c04e0df192c741). Data and the real-chip value: as in `omahaRundownReraiseRangeIsMeasured.md`. A trial cell is one the Horses' own record cannot decide (NO DATA or INSUFFICIENT, not FAIL), where (a) persons' own shown hands of the class in the spot have the re-raise ahead of the call and above zero by more than one standard error, and (b) the equity, position and initiative pricing (PREFLOP-EV realization: last raiser in position 1.153, out of position 0.912, caller 0.940 and 0.925) has the re-raise ahead; every finer cell that fails on the Horses' record is carved out.

| Cell                                                        | Horses, Re-Raises / Calls | Real Fit         | Real Held Out    | Persons' Shown Re-Raises (a) | Pricing (b), Re-Raise Minus Call |
| ----------------------------------------------------------- | ------------------------- | ---------------- | ---------------- | ---------------------------- | -------------------------------- |
| 3-bet in position, no-gap rundown (declared cell)           | 73 / 229                  | +4.54 +/- 18.48  | +15.28 +/- 11.76 | +36.9 +/- 36.8 (17)          | +2.40 +/- 0.06                   |
| its remainder as built (double suited, no pair, not low)    | 18 / 46                   | -13.57 +/- 27.12 | +37.67 +/- 20.89 | 3 shown                      |                                  |
| 4-bet in position, every rundown (declared cell)            | 109 / 385                 | +4.95 +/- 15.61  | -16.37 +/- 25.64 | +35.9 +/- 24.9 (36)          | +4.75 +/- 0.19                   |
| its remainder as built (PLO5, five connected, nut, no pair) | 11 / 35                   | +59.98 +/- 25.78 | +94.62 +/- 84.54 | +79.6 +/- 42.1 (9)           |                                  |

Cell 3, the depth cells. The Horses' own record, re-raise minus call in real chips (and net), own stack 250 bb or less, tier A or B, in position:

| Spot                                                    | Re-Raises / Calls (Fit; Held Out) | Real Fit         | Real Held Out    | Net Fit          | Net Held Out     |
| ------------------------------------------------------- | --------------------------------- | ---------------- | ---------------- | ---------------- | ---------------- |
| The three spots together                                | 127 / 468; 90 / 190               | +7.83 +/- 5.26   | +8.51 +/- 7.88   | +8.92 +/- 6.86   | +7.22 +/- 8.34   |
| Squeeze in position                                     | 20 / 80; 13 / 24                  | +23.60 +/- 14.48 | +18.05 +/- 11.31 | +35.93 +/- 21.25 | +21.11 +/- 14.20 |
| 4-bet in position as the opener                         | 29 / 105; 11 / 44                 | +20.68 +/- 16.10 | +50.51 +/- 30.75 | +1.96 +/- 14.80  | +31.02 +/- 26.07 |
| 3-bet in position facing an open                        | 78 / 283; 66 / 122                | -0.14 +/- 5.23   | -1.87 +/- 8.29   | +5.06 +/- 8.17   | +0.11 +/- 9.65   |
| For comparison: in position above 250 bb, every rundown | 126 / 636; 192 / 670              | +8.55 +/- 7.85   | -8.92 +/- 7.54   | +4.14 +/- 9.02   | +0.40 +/- 8.13   |

Inside the three spots together: PLO5 +9.47 +/- 5.67 and +9.27 +/- 8.27, PLO4 -2.57 +/- 14.13 and -5.49 +/- 15.64 (29 re-raises); 100 to 250 bb +8.83 +/- 5.94 and +8.51 +/- 7.88; double suited +9.37 +/- 5.97 and +9.93 +/- 8.84; every core card ten or higher +25.91 +/- 9.19 and +11.22 +/- 19.93; tier A +22.44 +/- 13.25 and +0.44 +/- 13.87; tier B +6.38 +/- 6.05 and +12.80 +/- 9.79. Limits of cell 3: the pooling over the in-position spots, the pooling of tiers A and B and the 250 bb bound were made AFTER the per-spot grade (they are not among the declared levels), which is why the cell is trial and not measured even though the squeeze and the 4-bet parts clear the pass bar; the 3-bet part is level with the call (it is in the trial for the data and because the 3-bet range is where aces are 28% of table re-raises, not as a gain); the recorded re-raises were the hands the brain chose (25% of the cell) and the rule extends the re-raise to the other 75%; persons' shown hands in the cell do not decide it (19 re-raises +5.0 +/- 30.7 against 26 calls -8.5 +/- 18.4).

Limits of cells 1 and 2, stated plainly. (1) The Horses' own record does not prove either cell: 18 and 11 recorded re-raises. (2) The pricing estimate (b) did not validate against the cells that have data: its sign agreed with the realised difference in 14 of 26 class-by-spot cells and it is optimistic by 2 to 8 bb a decision, so it carries nothing alone. (3) Persons' shown hands are selected by reaching showdown and are few. (4) The trial rule's reading "the re-raise ahead of the call, and the re-raise itself above zero by more than one standard error" and its floor of ten shown re-raises were fixed while applying it; under the stricter reading (both beyond one standard error) only the second cell's broadway part remains. (5) Cold 4-bets passed the letter of the rule and were left out because the pricing estimate is contradicted there by the Horses' record (-18.65 +/- 15.78 net). The squeeze in position with a double-suited rundown is the nearest miss on the Horses' own record (+18.12 +/- 8.76 fit, +7.00 +/- 10.12 held out) and is NOT in the trial: persons' shown hands do not support it.

The option exists so the lead can switch the cells on as a watched live trial to GET the data. Volume, 2026-11-15 to 2026-11-19 (hands with a person): 208 calls in five days become re-raises (190 the depth cells, 18 cells 1 and 2; 133 on tables, 75 in Lightning), about 42 a day. Table 3-bet share 8.97% to 10.12% (hijack 6.61% to 8.82%, cutoff 11.49% to 13.83%, button 12.58% to 14.64%, big blind 7.64% to 7.92%), 4-bet share 4.32% to 4.80%; Lightning 9.47% to 10.43% and 5.86% to 7.38%. The aces share of 3-bets 28.1% to 24.9% on tables and 33.5% to 30.4% in Lightning; of 4-bets 54.8% to 49.3% and 75.8% to 60.3%. PFR 16.34% to 16.81% on tables and 17.50% to 17.88% in Lightning; VPIP and flops seen unchanged (a call becomes a re-raise, never a new entry). Rundowns are already 31% of the Horses' 3-bets and 21% of their 4-bets on tables in those five days.

Evidence NOT MET for a default-on; a lead switch decision only.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (the audited-decision scorer judges recorded complaints; the trial cells were chosen from the realised results of the Horses' and persons' recorded calls and re-raises by rundown class and spot, see above)
