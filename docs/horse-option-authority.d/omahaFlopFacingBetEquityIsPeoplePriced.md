# omahaFlopFacingBetEquityIsPeoplePriced: Authority For The Live Switch

**State: OFF** (registered by migration `20261128123653_horse_option_register_flop_facing_bet_equity_is_people_price`, no switch row in production; default OFF, read `=== true`; switchable `off / shadow / on_shadow / on`; scopable per game with `horse.omahaGameScope.omahaFlopFacingBetEquityIsPeoplePriced`, compiled scope 0 = PLO4 and PLO5).

**Evidence MET for PLO5; Evidence NOT MET for PLO4 (too few hands: the real added calls are 3 hands).** Switch it on only after the game scope `horse.omahaGameScope.omahaFlopFacingBetEquityIsPeoplePriced` = 5 (PLO5 only) is published, so that a switch-on acts in PLO5 and nowhere else; then shadow, then on. This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

Built 2026-11-28 by PLO-OWNER lead-10 lanes PLX (diagnosis), PLX2 (option and replay) and PLX3 (harness, registration) (session 01Gw7aDr) on Dan's order of 2026-11-27 4:48 PM ("#1 priority ... are the over folding bugs ... not just multiway, but also heads up"). Lane records: `plo-lead7-01TLQer8/l10-plx/BUILD.md`, `l10-plx2/BUILD.md`, `l10-plx3/BUILD.md`.

## The Defect It Answers

Production-shaped real-node replay of recorded Horse decisions facing a PERSON's first flop bet (Oct 27 to Nov 27, 9,765 flop nodes, the deciding Horse's own cards only, seeds 1/7/42, majority; opponent memory ON as of the decision with the production bet-read learner; the serving switch rows plus the merged and queued over-fold stack): heads-up in a single-raised pot, facing the preflop raiser's 0.7-1.1 pot continuation bet, the Horse folds 65% in PLO4 against a 48% break-even (a zero-equity bluff wins +2.69 +/- 0.47 bb per bet, n 289) and 57% in PLO5 against 47% (+2.30 +/- 0.42, n 683). Without opponent memory the same cells are closed (PLO4 -0.61 +/- 0.48, PLO5 -0.20 +/- 0.43).

Which memory input: history only (the HorseMind record, no bet-read) reproduces the whole over-fold (PLO4 +2.69, PLO5 +2.22); the bettor's own c-bet record alone changes nothing (PLO4 -0.61, PLO5 -0.20). With history every bettor gets a PREFLOP range band from his counters, and the sampler's equity on the hands that flip from call to fold falls from 0.499 to 0.387 (1,714 heads-up single-raised pot-size c-bet nodes, 209 call-to-fold flips). The people-measured flop price (`omahaFlopPressureCapIsPriced`) was read as `min(sampler equity, people-priced equity)`: 0.464 without memory, 0.381 with it on the same flips. So the people price could only LOWER the equity: a preflop band from the bettor's counters overrode people's measured flop bets of this size, downward only. Two prices for one bet, and the one that is not people-measured won.

## What It Does

PLO4/PLO5 cash (tables and Lightning, one board, high only, no bomb pot), the flop, the deciding Horse heads-up, facing one bet (not a raise), a SINGLE-RAISED pot (exactly one preflop raise, `omahaPeoplePriorFlopPotOf`), the bet MADE heads-up (no player folded on the flop after the bet), and only inside the priced flop pressure cap's own spot (`omahaFlopPressureCapIsPriced` on, a weak made class under pressure, call vs fold):

1. The call-or-fold check reads the Horse's equity against the bettor's people-priced flop range, the cap's own price, instead of `min(sampler equity, that price)`. The evidence order of that price: his own record of flop bets of this size (8 pseudo-bets at people's rate) -> people's measured heads-up flop bets of this size (people-only fit; the game x pot-type hidden-corrected cell with `omahaPeoplePriorCountsHiddenBets`, pooled with both games up to 30 bets) -> the equilibrium anchor (the balanced share for the price, 30 pseudo-bets behind the people cell). A thin cell shrinks continuously to the anchor: no threshold, no clamp.
2. Limped and re-raised pots, multiway decisions, and bets made into three or more players (measured in people's MULTIWAY flop cell, which this price does not read) keep the min exactly as before.
3. A draw the check prices as a raise keeps the capped equity: the option never adds a raise. Every change is a fold that becomes a call.

No identity input (person or Horse, name, account), no unshown card, no size rule. PLO6, tournaments, the turn, the river, raises and multiway pots are untouched. Receipts `omaha_flop_people_priced_equity` (the people price lifted the check equity above the sampler's) and `omaha_flop_people_priced_equity_call`. Staged for shadow re-decision on the flop (games 4 and 5).

## What Was Measured

Real-node replay (l10-plx2, replay O_F, the same 9,765 flop nodes, memory on; base = serving rows + the stack: A `omahaPeoplePriorCountsHiddenBets`, B `omahaTurnFacingBetPriorIsLineSplit`, `omahaHiddenBetsArePricedAsGiveUps`, `omahaMultiwayRiverBluffIsPricedOnBlockers`, `omahaMultiwayRiverBetPriorIsPeopleMeasured`, `omahaBareOverpairContinuationIsPeoplePriced`, `omahaGiveUpPricedTurnCallIsAtIndifference`, plus `omahaRiverBetPriorIsPotTypeSplit` for PLO5; arm = base + this option). Zero-equity bluff bb per bet; bar: not above zero by more than 2 SE:

| cell (heads-up, single-raised, c-bet 0.7-1.1 pot) | decisions | serving fold | stack fold | fold with option | break-even | bluff (stack)  | bluff with option               |
| ------------------------------------------------- | --------- | ------------ | ---------- | ---------------- | ---------- | -------------- | ------------------------------- |
| PLO4                                              | 289       | 67%          | 65%        | 46%              | 48%        | +2.69 +/- 0.47 | -0.35 +/- 0.48 (z -0.7)         |
| PLO4 in position / out of position                | 70 / 219  |              |            |                  |            |                | -0.74 +/- 0.95 / -0.22 +/- 0.56 |
| PLO5                                              | 683       | 59%          | 57%        | 48%              | 47%        | +2.30 +/- 0.42 | +0.34 +/- 0.43 (z +0.8)         |
| PLO5 in position / out of position                | 190 / 493 |              |            |                  |            |                | -1.03 +/- 0.83 / +0.87 +/- 0.50 |

All 9,765 flop nodes: 123 change, every one fold to call (PLO4 58: c-bet 56, donk 2; PLO5 65: 63, 2); 0 in limped pots, 0 in re-raised pots, 0 in bets made multiway, 0 into a raise. The receipt fired on 371 PLO4 and 614 PLO5 single-raised nodes. The option ALONE (arm minus the same stack without it) moves no flop cell outside its two targets (and their own roll-ups) by more than 2 SE.

Over-call (the lanes' bar, lead-10 ruling 2026-11-28 5:28 AM CST): (i) the target cells' fold rate is not below break-even by more than 2 SE: PLO4 46% vs 48% (z -0.7), PLO5 48% vs 47% (z +0.8): MET. (ii) fixed-harness value-only (never-bluffing) flop bettor, limit copied unchanged from `omahaFlopPressureCapIsPriced`'s evidence (pooled mean not below -1 pooled SE): PLO4 +0.15 +/- 0.40 bb/100 (+0.4 SE), PLO5 +0.15 +/- 0.61 (+0.2 SE): MET (both also inside the -4.0 bb/100 flop value-only line). (iii) real added calls (the stack folds, the option calls, at nodes the Horse really called; realised chips from the call on, the bettor's shown cards only): PLO5 -0.6 +/- 6.1 bb (n 10): MET; PLO4 -7.5 +/- 3.1 bb (n 3), 2.4 SE below zero on three hands: NOT MET for PLO4 on too few hands (not enlarged). Hence the PLO5-only scope.

Fixed harness (`server/scripts/horse-grade.ts`, ON minus the same-seed no-op; every no-op 0.00 with 0 divergent deals; base = serving rows + the stack above, the PLO5 base with `omahaRiverBetPriorIsPotTypeSplit`; probes 2 seats 100 bb, seeds 211/212 pooled; mirrors seeds 311/312 pooled; bots seed 601 heads-up 0.8 pot, ftk = c-bet flop and barrel the turn, give up the river; bp = barrel with the production muck rule):

| card                                                                           | game | pooled ON minus no-op (bb/100)                    | SE units | bar                          | result | per seed                                                            |
| ------------------------------------------------------------------------------ | ---- | ------------------------------------------------- | -------- | ---------------------------- | ------ | ------------------------------------------------------------------- |
| value-only flop bettor (never bluffs), 8,000 deals                             | PLO4 | +0.15 +/- 0.40                                    | +0.4     | >= -1 SE                     | PASS   | 211: +0.12 +/- 0.29 (ON div 6); 212: +0.17 +/- 0.74 (ON div 2)      |
| value-only flop bettor (never bluffs), 8,000 deals                             | PLO5 | +0.15 +/- 0.61                                    | +0.2     | >= -1 SE                     | PASS   | 211: -0.24 +/- 0.82 (ON div 11); 212: +0.54 +/- 0.89 (ON div 8)     |
| people-calibrated responder, 6,000 deals                                       | PLO4 | +0.47 +/- 0.33                                    | +1.4     | >= -1 SE                     | PASS   | 211: +0.53 +/- 0.49 (ON div 8); 212: +0.40 +/- 0.43 (ON div 4)      |
| people-calibrated responder, 6,000 deals                                       | PLO5 | -0.25 +/- 0.48                                    | -0.5     | >= -1 SE                     | PASS   | 211: -0.57 +/- 0.94 (ON div 7); 212: +0.07 +/- 0.21 (ON div 5)      |
| mirror heads-up, 5,000 pairs                                                   | PLO4 | +1.84 +/- 1.95                                    | +0.9     | >= -2 SE                     | PASS   | 311: +4.12 +/- 2.81 (ON div 235); 312: -0.44 +/- 2.71 (ON div 258)  |
| mirror heads-up, 5,000 pairs                                                   | PLO5 | +5.24 +/- 3.53                                    | +1.5     | >= -2 SE                     | PASS   | 311: -4.54 +/- 5.06 (ON div 539); 312: +15.02 +/- 4.92 (ON div 530) |
| mirror 6-max, 2,500 pairs                                                      | PLO4 | -0.18 +/- 0.91                                    | -0.2     | >= -2 SE                     | PASS   | 311: -0.55 +/- 1.25 (ON div 100); 312: +0.20 +/- 1.33 (ON div 98)   |
| mirror 6-max, 2,500 pairs                                                      | PLO5 | -0.86 +/- 1.13                                    | -0.8     | >= -2 SE                     | PASS   | 311: -1.74 +/- 1.60 (ON div 138); 312: +0.01 +/- 1.59 (ON div 114)  |
| bot ftk (c-bet flop, barrel turn, give up river), bluffer bb per flop-bet line | PLO4 | ON -4.66 +/- 0.37 (n 1304); change -0.29 +/- 0.53 | -0.5     | loses or ~0; change <= +2 SE | PASS   | base -4.37 +/- 0.37, seed 601                                       |
| bot ftk (c-bet flop, barrel turn, give up river), bluffer bb per flop-bet line | PLO5 | ON -4.32 +/- 0.46 (n 1211); change -0.40 +/- 0.64 | -0.6     | loses or ~0; change <= +2 SE | PASS   | base -3.92 +/- 0.45, seed 601                                       |
| bot bp (barrel, production muck rule), bluffer bb per flop-bet line            | PLO4 | ON -9.10 +/- 0.71 (n 1432); change -0.26 +/- 1.00 | -0.3     | loses or ~0; change <= +2 SE | PASS   | base -8.84 +/- 0.70, seed 601                                       |
| bot bp (barrel, production muck rule), bluffer bb per flop-bet line            | PLO5 | ON -8.01 +/- 0.80 (n 1338); change -0.10 +/- 1.13 | -0.1     | loses or ~0; change <= +2 SE | PASS   | base -7.91 +/- 0.80, seed 601                                       |

The value-only and people cards reach the option rarely (2 to 11 divergent deals in 6,000 to 8,000): heads-up self-play seldom produces the memory-driven sampler band this option answers; the mirrors reach it more (98 to 539 divergent deals).

Audit fixture (445 audited PLO4 heads-up flop decisions, memory off; base `omahaFlopPressureCapIsPriced` + `omahaPeoplePriorCountsHiddenBets`): the receipt fires on 20, 2 fold to call, 0 other changes, 0 in limped or re-raised pots. Speed (relative-cost law `anOmahaFlopPeoplePricedEquityIsFast`, the 20 lifted decisions): on 9.47 ms vs off 9.42 ms per decision telemetry off (ratio 1.00, limit 3), 9.43 vs 9.49 telemetry on (0.99). The option reads the number the cap has already computed; it adds one scope check and one scan of the flop actions. Flag-off: 0 differences in 28,000 decisions (`scripts/ops/horse-flag-off-check.sh`, set full, head cbeedca75104 against main 65a64d1f6206, 2026-11-28).

## Watch And Rollback

- PLO4 changes while the published scope is 5: any `omaha_flop_people_priced_equity*` receipt or changed shadow re-decision in a PLO4 hand = scope leak: roll back at once.
- Any change that is not fold to call, any change outside a heads-up single-raised flop with the bet made heads-up, any error, breaker trip or decision over 50 ms.
- Realised chips of the added calls against people below 0 by more than 2 SE after 30 such calls.

## Prior anchor

- Baseline: equilibrium. The balanced non-value share of a flop bet for the price (`omahaFlopBalancedShare`: 1 - (1 - b)^3 with the turn and river to come, b from `omahaEquilibriumAnchor`) weighs 30 pseudo-bets behind people's flop cell and is the whole share where a cell is unmeasured.
- Population weight: PEOPLE-ONLY heads-up flop cell (`HorseOmahaFacingBetPeoplePrior.data.ts`; with `omahaPeoplePriorCountsHiddenBets` the hidden-corrected cell per game and pot type, `HorseOmahaPeoplePriorHidden.data.ts`: flop|plo4|hu|big|single 31 shown + 11 hidden, people weight 72/102 = 71% after pooling; flop|plo5|hu|big|single 70 + 33, 133/163 = 82%), n / (n + 30).
- Own record: his own shown (and, with the hidden-bets prior, hidden) flop bets of that size move the share and narrow the value region (8 pseudo-bets), exactly as in the flop pressure cap's price.
- No unshown cards: the fit reads only cards people showed; a fold and a muck are public events; at decision time the option reads the public state and the deciding Horse's own cards.

## Replay

- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 868; unjudged 1; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer fb71286dad8; source placed verdict-only; arm O vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 2; unchanged 2695; unjudged 2; set PLO-hand-audit-2026-11-20-to-24; scorer fb71286dad8; source placed verdict-only; arm O vs off; replayed 2697 of 2697
- Note (2026-11-28): arm O = omahaPeoplePriorCountsHiddenBets + omahaTurnFacingBetPriorIsLineSplit + omahaHiddenBetsArePricedAsGiveUps + this option on the live switch rows of 2026-11-28 07:24Z (omahaFlopPressureCapIsPriced on), opponent memory off; the arm without this option (S) gives the same two rows, so the audited sets hold no decision this option changes with memory off: the bar (fixed >= 2 x newly wrong) is met trivially and says nothing. The leak is memory-driven; the evidence is the memory-on real-node replay and the fixed-harness grades above.
