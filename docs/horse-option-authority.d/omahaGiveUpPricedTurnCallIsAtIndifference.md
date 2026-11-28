# omahaGiveUpPricedTurnCallIsAtIndifference: Authority For The Live Switch

Built 2026-11-27 by lead-9 worker HU2 (session 01UxDLnJ) on Dan's order of 2026-11-27 4:48 PM ("#1 priority ... are the over folding bugs ... not just multiway, but also heads up"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaGiveUpPricedTurnCallIsAtIndifference`; compiled scope 0 = PLO4 and PLO5; the cells it was built for are PLO4's). It acts only with `omahaHiddenBetsArePricedAsGiveUps` on (and that one only inside `omahaPeoplePriorCountsHiddenBets`). **Evidence NOT MET**: the fixed-harness grades are in `plo-lead7-01TLQer8/l9-huresid2/BUILD.md` and the PR body; this file does not authorize switching the option on.

## The Defect It Answers

With `omahaHiddenBetsArePricedAsGiveUps` on, the real-node replay of recorded Horse decisions facing a PERSON's first turn bet heads-up (Oct 27 to Nov 27, the deciding Horse's own cards only, seeds 1/7/42) leaves two PLO4 sub-cells of the checked-flop line a hair over the bar: a 0.7-1.1 pot turn bet in a limped pot (68% fold, +0.86 +/- 0.32 bb per zero-equity bet, n 69) and in a single-raised pot out of position (59%, +2.48 +/- 1.19, n 78).

The inputs of the give-up price were checked against people's data and stand: the non-value share (0.59 to 0.61), the give-up share (0.29 to 0.31; PLO4 people 4 hidden of 12, both games 17 of 70, anchor one third), the shape of people's shown non-value bets (mean beat share 0.55 to 0.66, uniform over the region as the price assumes), and the realization (people's shown non-value turn bettors bet the river again 15% of the time, 17 of 116, but bets that won the river without a showdown are not in that sample: no measured case for a higher out-of-position realization). What is left is the verdict's safety margin: it calls only when the expected value exceeds 2% of the final pot, so every hand between zero and the margin folds. On an exact count against a measured range those are the hands a bluffer's price makes indifferent, and folding all of them is what a zero-equity bet is paid by: the two cells fold 6 and 8 points less without the margin.

The existing option `omahaFacingBetIndifferenceCalls` removes the margin on every turn and river verdict, heads-up and multiway, raises and re-raised pots included. Replayed on the same turn decisions it also adds calls in re-raised pots and in cells already far under break-even, and its added calls that were recorded calls read -9.9 +/- 18.0 bb (n 12; PLO5 -29.0 +/- 27.1, n 7). This option is the narrow form.

## What It Does

PLO4/PLO5 cash (tables and Lightning, one board, high only, no bomb pot), heads-up, the turn, a first bet (never a raise), only where `omahaHiddenBetsArePricedAsGiveUps` priced the give-up share, and never in a re-raised pot: the call is made when the expected value of the call is zero or more, instead of more than 2% of the final pot. The expected value itself (the people-measured non-value share, the give-up share, his own record, realization, rake) is unchanged and still computed per hand.

No clamp, no size rule, no identity input, no unshown card, no record of its own. It only turns a fold into a call, and only a call whose expected value lies between zero and the margin. PLO6, tournaments, the flop, the river, raises, re-raised pots and multiway pots are untouched. Receipts `omaha_give_up_indifference_priced`, `omaha_give_up_indifference_call`. Staged for shadow re-decision on the turn.

## What Was Measured

Real-node replay, same decisions, base = `omahaPeoplePriorCountsHiddenBets` + `omahaTurnFacingBetPriorIsLineSplit` + `omahaHiddenBetsArePricedAsGiveUps`, arm = base + this option (zero-equity bluff bb per bet; bar: not more than +2 SE above zero):

| cell (heads-up, flop checked through, turn bet)  | decisions | base fold | fold with option | bluff base     | bluff with option |
| ------------------------------------------------ | --------- | --------- | ---------------- | -------------- | ----------------- |
| PLO4 single-raised, out of position, 0.7-1.1 pot | 78        | 59%       | 51%              | +2.48 +/- 1.19 | +0.76 +/- 1.22    |
| PLO4 limped, 0.7-1.1 pot                         | 69        | 68%       | 62%              | +0.86 +/- 0.32 | +0.58 +/- 0.33    |
| PLO4 limped, every size                          | 102       | 61%       | 55%              | +0.70 +/- 0.24 | +0.45 +/- 0.24    |
| PLO4 single-raised, every size and position      | 244       | 45%       | 39%              | +0.80 +/- 0.58 | -0.44 +/- 0.58    |
| PLO5 single-raised, every size and position      | 399       | 43%       | 36%              | -1.51 +/- 0.82 | -3.49 +/- 0.80    |

No re-raised pot changes (0 added calls there). Chips of the calls the option adds where the recorded Horse called (natural experiment): -15.2 +/- 21.2 bb (n 9; PLO4 +0.9 +/- 6.4, n 4; PLO5 -28.2 +/- 38.8, n 5): not below -1 SE, thin. Speed (relative-cost law, 40 real turn decisions it decides): on 8.84 ms vs off 8.89 ms per decision telemetry off (ratio 0.99), 9.06 vs 9.01 telemetry on (1.00).

Fixed harness (ON-minus-same-seed-no-op, base = live rows + the three options above): value-only bettor PLO4 -0.46 +/- 0.56 (>= -3.0, PASS); value-only bettor PLO5 -0.40 +/- 0.68 (>= -4.0, PASS); people-calibrated responder PLO4 -1.09 +/- 1.10 (>= -1 SE, PASS); people-calibrated responder PLO5 +0.70 +/- 1.06 (>= -1 SE, PASS); bot ftk PLO4 bluffer -4.15 +/- 0.37 bb/line with the option (change -0.59 +/- 0.53; PASS); bot ftk PLO5 bluffer -4.17 +/- 0.45 bb/line with the option (change -0.66 +/- 0.64; PASS); bot bp PLO4 bluffer -8.54 +/- 0.70 bb/line with the option (change -0.13 +/- 0.98; PASS); bot bp PLO5 bluffer -7.94 +/- 0.80 bb/line with the option (change -0.76 +/- 1.12; PASS). Pooled over seeds 211/212 (bots: seed 601, heads-up, 0.8 pot, ftk = flop+turn barrel that gives up the river, bp = production muck rule). Evidence cards (mirrors 311/312 heads-up and 6-max, over-folder, balanced, calling station; bars: not below -2 SE, station >= -1 SE): INCOMPLETE.

| card         | game | pooled ON-minus-noop bb/100 | SE units | bar      | result        | per seed                                                           |
| ------------ | ---- | --------------------------- | -------- | -------- | ------------- | ------------------------------------------------------------------ |
| mirror HU    | PLO4 | -0.28 +/- 2.45              | -0.1     | >= -2 SE | PASS          | 311: +0.03 +/- 3.86 (ON div 319); 312: -0.59 +/- 3.02 (ON div 299) |
| mirror HU    | PLO5 | -2.04 +/- 3.72              | -0.5     | >= -2 SE | PASS          | 311: -1.26 +/- 5.14 (ON div 749); 312: -2.81 +/- 5.38 (ON div 565) |
| mirror 6-max | PLO4 | -0.99 +/- 1.13              | -0.9     | >= -2 SE | PASS (1 seed) | 311: -0.99 +/- 1.13 (ON div 79)                                    |
| mirror 6-max | PLO5 | +0.05 +/- 1.44              | +0.0     | >= -2 SE | PASS (1 seed) | 311: +0.05 +/- 1.44 (ON div 123)                                   |
| over-folder  | PLO4 | +1.55 +/- 1.31              | +1.2     | >= -2 SE | PASS (1 seed) | 211: +1.55 +/- 1.31 (ON div 35)                                    |
| over-folder  | PLO5 | +2.74 +/- 1.45              | +1.9     | >= -2 SE | PASS (1 seed) | 211: +2.74 +/- 1.45 (ON div 35)                                    |
| balanced     | PLO4 | +0.30 +/- 0.85              | +0.4     | >= -2 SE | PASS (1 seed) | 211: +0.30 +/- 0.85 (ON div 17)                                    |
| balanced     | PLO5 | -2.00 +/- 1.27              | -1.6     | >= -2 SE | PASS (1 seed) | 211: -2.00 +/- 1.27 (ON div 17)                                    |
| caller       | PLO4 | +0.00 +/- 0.00              | +0.0     | >= -1 SE | PASS (1 seed) | 211: +0.00 +/- 0.00 (ON div 0)                                     |
| caller       | PLO5 | +0.00 +/- 0.00              | +0.0     | >= -1 SE | PASS (1 seed) | 211: +0.00 +/- 0.00 (ON div 0)                                     |

## Watch And Rollback

- Roll back (switch off) if `omaha_give_up_indifference_call` calls against people lose by 2 SE after 40, or any breaker, error or decision over 50 ms appears in the shadow read.

## Prior anchor

- Baseline: indifference. A call is made at EV >= 0 on an exact count, not EV > 2% of the final pot; the price it sits on is `omahaHiddenBetsArePricedAsGiveUps`, whose prior is anchored in that option's doc (equilibrium anchor behind people's cells).
- Population weight: none of its own; it fits no population rate and only moves the call margin of the verdict it sits on.
- Own record: it reads no record; the verdict's own read (his shown and hidden turn bets) is used unchanged.
- No unshown cards: at decision time the option reads the verdict already computed from the public state and the deciding Horse's own cards.

## Replay

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm IX vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2696; unjudged 1; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm IX vs off; replayed 2697 of 2697
- Note (2026-11-27): arm IX = omahaPeoplePriorCountsHiddenBets + omahaTurnFacingBetPriorIsLineSplit + omahaHiddenBetsArePricedAsGiveUps + this option, opponent memory off; the arm without this option (GU) gives the same two rows, so the audited sets hold no decision this option changes: the bar (fixed >= 2 x newly wrong) is met trivially and says nothing. The evidence is the real-node replay above and the fixed-harness grades.
