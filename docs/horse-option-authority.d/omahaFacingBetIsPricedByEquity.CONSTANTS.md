# omahaFacingBetIsPricedByEquity: Constants

Dataset: AUDIT-48 shared dataset (hands created Nov 17 6:44 PM to Nov 19 6:49 PM Chicago), PLO4/PLO5 cash, table and Lightning, single board, no bomb pot, every Horse postflop decision facing a bet or a raise whose last aggressor is a person: 1,701 decisions (flop 942, turn 537, river 222); real hole cards of every live opponent (ca_hand_facts) for 1,655. Fit set: Nov 18 Chicago (before 2026-11-19 06:00 UTC), 1,237 decisions. Held-out set: Nov 19 Chicago, 418 decisions. Only hand ids appear in evidence files outside the private folders.

## Calibration (OMAHA_FACING_EQUITY_CALIBRATION)

Raw share (600-sample card-seeded Monte Carlo against random holdings, the code in this module) binned at 0, .15, .25, .35, .45, .55, .65, .80, 1; each knot is [mean raw, mean true] of a bin with at least 8 spots, where true is the exact all-in share against the opponents' real cards (every runout enumerated); adjacent violators pooled so the map is monotone. Bin standard errors 0.015 to 0.06 flop/turn, 0.07 to 0.12 river.

| Cell     | n (fit) | Knots raw -> true                                                    |
| -------- | ------- | -------------------------------------------------------------------- |
| flop HU  | 519     | .20->.19, .30->.25, .41->.31, .50->.40, .60->.49, .72->.59, .87->.78 |
| flop MW  | 174     | .11->.09, .20->.17, .30->.25, .40->.29, .50->.38, .60->.52, .99->.98 |
| turn HU  | 298     | .21->.09, .30->.29, .40->.32, .50->.38, .60->.49, .71->.61, .86->.66 |
| turn MW  | 86      | .09->.05, .20->.18, .29->.23, .39->.35, 1.0->1.0                     |
| river HU | 142     | .06->0, .26->.10, .41->.18, .49->.29, .60->.41, .74->.42, .88->.57   |
| river MW | 18      | too few: no verdict                                                  |

The river cell shows why persons' river bets are value-heavy: a raw share of .49 is worth .29 against their real cards.

## Realization (OMAHA_FACING_EQUITY_REALIZATION)

Horse calls in the fit set: (net + chips invested before the decision + chips of the call) summed, over (true share x (pot + call)) summed. Flop 0.463 (220 calls), turn 0.541 (103 calls). Whole set by cell: flop HU 0.44 (236; the actual EV of a flop call -8.7 bb, SE 8.4, against +21.5 bb all-in), flop MW 0.63 (62), turn HU 0.62 (114), turn MW 0.37 (21), river HU 0.98 (32: no later street, the method's check). River uses 1.

## Margin (OMAHA_FACING_EQUITY_MARGIN)

Flop 0.02, turn 0.04, river 0.08: about one standard error of the calibration knots in the price range of each street.

## Result Of The Rule On The Dataset (calls -> folds: 0 by construction)

| Street | Set             | Decisions | Fold rate base -> ON | Flips | EV per flip vs real cards (realized), bb, mean (SE) |
| ------ | --------------- | --------- | -------------------- | ----- | --------------------------------------------------- |
| flop   | all             | 942       | 58.8% -> 58.2%       | 6     | +26.3 (10.4)                                        |
| turn   | all             | 537       | 60.5% -> 58.8%       | 9     | +16.5 (13.3)                                        |
| river  | all             | 222       | 74.3% -> 44.1%       | 67    | +56.1 (22.1)                                        |
| river  | held-out Nov 19 | 62        | 64.5% -> 41.9%       | 14    | +48.3 (40.8)                                        |

On the river 36 of the 67 flips lose against the real cards (aggregate EV positive).
