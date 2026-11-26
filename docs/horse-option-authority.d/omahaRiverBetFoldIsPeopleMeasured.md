# omahaRiverBetFoldIsPeopleMeasured: Authority For The Live Switch

**Evidence NOT MET: with the two river bet rules it serves, a calling station costs PLO5 -5.0 +/- 1.2 bb/100 even with his record read (PLO4 +0.4 +/- 0.4); the rest of the grade is strongly positive. Default OFF, not switched on.** Built 2026-11-26 by PLO-OWNER lead-7 (session 01TLQer8), personally, on Dan's order of 2026-11-26 ("the stats need to be used against human players, not horses"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game. This file does not authorize switching the option on.

## What It Does

It does nothing by itself. With omahaRiverFirstToActBetIsPriced or omahaRiverCheckedToBetIsMeasured on, the answer curve those rules price a heads-up river bet with (their own curve pools every player, Horses included: OFFENCE-BUILD fit before 2026-11-18) is re-measured on PEOPLE: at each point of the curve his fold is people's measured fold for the Horse's line and that size (`HorseOmahaPeopleFold.omahaPeopleRiverCurve`: answers by people only, `HorseOmahaPeopleFoldTables.json`, shrunk to equilibrium by k = 75.9 river answers); the raise share keeps its share of the continues. With omahaRiverBetFoldIsHisRecord on, his own lifetime record is shrunk to that people curve. PLO4/PLO5 cash, heads-up river; one formula for every opponent; never PLO6.

## What Was Measured

Everything in `plo-lead7-01TLQer8/plo-bluffs/` (harness and outputs in that folder). Base = the live switch rows.

- Flag-off check full set: 0 differences in 28,000 decisions.
- Scripted responders (Horses ON minus OFF, bb/100, 2 seats, 100 bb, 16,000 deals; the responder's public answers served as his lifetime record, as live):

| Set                                                                | Calling station PLO4 | Calling station PLO5 | Over-folder PLO4 | Over-folder PLO5 |
| ------------------------------------------------------------------ | -------------------- | -------------------- | ---------------- | ---------------- |
| the two river rules alone                                          | -29.9 +/- 2.6        | -49.9 +/- 4.2        | +17.0 +/- 2.7    | +23.0 +/- 4.2    |
| + omahaRiverBetFoldIsHisRecord                                     | +0.6 +/- 0.5         | -3.3 +/- 1.1         | +19.9 +/- 3.0    | +30.3 +/- 4.3    |
| + his record + this option                                         | +0.4 +/- 0.4         | -4.9 +/- 1.2         | +12.5 +/- 2.4    | +18.5 +/- 4.4    |
| that + the three bluff options                                     | +0.4 +/- 0.4         | -5.0 +/- 1.2         | +19.4 +/- 2.7    | +26.9 +/- 4.3    |
| that + all four bluff options, after the review fixes (t3, t4, t5) | +0.4 +/- 0.4         | -5.0 +/- 1.2         | +13.9 +/- 2.5    | +25.5 +/- 4.6    |

- League mirror, the last set (Horses ON against OFF, 12,000 hands): PLO4 +10.3 +/- 2.9, PLO5 +19.6 +/- 5.2.
- A winning PLO5 regular (a person; his recorded river checks of 7 days, opponent memory from his public hands), river checks that become bets scored against his own fold rates (woowoo/data/missed_bluffs.csv), the two rules without this option: omahaRiverFirstToActBetIsPriced 114 bets, +2,724 bb; omahaRiverCheckedToBetIsMeasured 79 bets, +1,861 bb.

Open before any shadow: the PLO5 station loss with the record read. The two rules' value and bluff sizes against a player who never folds need their own probe.

## Prior anchor

- Baseline: equilibrium, the fold a minimum-defence player gives a bet of B into P, B / (P + B).
- Population weight: people's measured fold multiplier for the game, the Horse's line and the size (answers by people only), shrunk to equilibrium by k = 75.9 river answers.
- Own record: with omahaRiverBetFoldIsHisRecord on, his lifetime public river fold record shrunk to the people curve by n / (n + k).
- No unshown cards: the table reads public answers only; the decision reads the public state and the Horse's own cards.

## Replay

- Replay: fixed 27; newlyWrong 2; changed 30; unchanged 839; unjudged 1; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm FTAP vs off; replayed 869 of 869
- Replay: fixed 65; newlyWrong 8; changed 81; unchanged 2616; unjudged 4; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm FTAP vs off; replayed 2697 of 2697
- Note (2026-11-26, after review t5: the people fold table refit on the engine's line, the last wager): arm FTAP is this option with omahaRiverFirstToActBetIsPriced, omahaRiverCheckedToBetIsMeasured and omahaRiverBetFoldIsHisRecord, not this option alone; before the refit the 2026-11-20..24 row was 65 fixed / 10 newly wrong (83 changed), the daily row the same. Evidence stays NOT MET on the PLO5 station probe.
