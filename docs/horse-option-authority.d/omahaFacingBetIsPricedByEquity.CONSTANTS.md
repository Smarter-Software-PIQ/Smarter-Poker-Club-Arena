# omahaFacingBetIsPricedByEquity: Constants

Provenance (lead decision 2026-11-19, binding): every shipped constant is fitted on PUBLIC information only, meaning cards revealed at showdown, table results and the Horse's own cards. Hidden (never shown) hole cards were used only offline, to grade the finished rule on the held-out day. The code carries the same statement (`OMAHA_FACING_EQUITY_PROVENANCE`), and the law test pins it.

Dataset: AUDIT-48 shared dataset (hands created Nov 17 6:44 PM to Nov 19 6:49 PM Chicago), PLO4/PLO5 cash, table and Lightning, single board, no bomb pot, every Horse postflop decision facing a bet or a raise whose last aggressor is a person: 1,701 decisions (flop 942, turn 537, river 222). Fit set: Nov 18 Chicago (before 2026-11-19 06:00 UTC). Held-out set: Nov 19 Chicago. Only hand ids appear in evidence files outside the private folders.

## Calibration (OMAHA_FACING_EQUITY_CALIBRATION)

Raw share: 600-sample card-seeded Monte Carlo against random holdings (the code in this module).

- Flop and turn: decisions where every live opponent's cards were revealed at showdown (flop 148, turn 105 in the fit set), binned by raw share (0, .2, .35, .5, .65, .8, 1), each bin weighted by its public reveal rate, adjacent violators pooled. Knots flop .29->.17, .44->.34, .58->.46, .72->.56, .95->.90; turn .38->.24, .57->.36, .73->.59, .91->.78. Bin SE .02 to .06. Residual bias: persons who reach showdown are stronger than those who fold later, so the map leans against calling (conservative).
- River heads-up: the persons' river betting range as revealed at showdown (Horse-called heads-up river bets, 28 in the fit set; the caller's choice does not see the bettor's cards, so the revealed hands sample his betting range). Each revealed hand's percentile on its own board (raw share against one random holding); calibrated share = fraction of revealed percentiles below the Horse's raw share: .3->.21, .4->.25, .5->.29, .6->.36, .7->.46, .8->.61, .9->.68 (SE about .09).
- River multiway: too few revealed spots, no verdict.

## Realization (OMAHA_FACING_EQUITY_REALIZATION)

Horse calls in the fit set: (net + chips invested before the decision + chips of the call) summed over (calibrated public share x (pot + call)) summed. Flop 0.486 (220 calls), turn 0.640 (103 calls). River 1 (no later street).

## Margin (OMAHA_FACING_EQUITY_MARGIN)

Mean calibration knot SE per street: flop 0.031, turn 0.047; river the SE of the revealed-range share, 0.087.

## Result, Graded Offline Against The Real Cards (calls -> folds: 0 by construction)

| Street | Set             | Decisions | Fold rate base -> ON | Flips (Lightning / table) | EV per flip vs real cards, realized, bb mean (SE) |
| ------ | --------------- | --------- | -------------------- | ------------------------- | ------------------------------------------------- |
| flop   | held-out Nov 19 | 249       | 58.6% -> 57.8%       | 2 (2 / 0)                 | +26.5 (5.1)                                       |
| turn   | held-out Nov 19 | 153       | 66.0% -> 60.1%       | 9 (7 / 2)                 | +7.1 (13.3)                                       |
| river  | held-out Nov 19 | 62        | 64.5% -> 45.2%       | 12 (10 / 2)               | +60.4 (47.6)                                      |
| flop   | all             | 942       | 58.8% -> 58.2%       | 6 (3 / 3)                 | +30.1 (11.8)                                      |
| turn   | all             | 537       | 60.5% -> 57.9%       | 14 (10 / 4)               | +10.7 (11.3)                                      |
| river  | all             | 222       | 74.3% -> 49.5%       | 55 (39 / 16)              | +65.2 (26.2), total +3,523 bb                     |

On the river 29 of the 55 flips lose against the real cards; the aggregate EV is positive.
