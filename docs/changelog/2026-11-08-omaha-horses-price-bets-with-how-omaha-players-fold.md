# Omaha horses price their bets with how Omaha players really fold (2026-11-08)

## In plain English

When a horse bets at a Pot-Limit Omaha cash table (PLO4, PLO5, PLO6) with a
hand that is not strong, it decides by asking "how often will this player
fold?" The answer it used came from a read built for Hold'em. That read counts
preflop calls, and Omaha players call preflop raises all the time, so it filed
most Omaha players as people who never fold: 85% of the real people's Omaha
spots. Those players actually folded about 40% of the time to a bet.

So the horses expected far fewer folds than they got. Over the real Omaha
hands, the horses' bet math expected 38% folds to a flop or turn bet; players
folded 52%. Against people it expected 21% and people folded 36%.

The fix (switch `omahaEvFoldModel`, **on by default**) replaces that guess at
Omaha cash tables with the fold rate actually measured in each Omaha game,
adjusted for each player by how often that player has folded to bets after the
flop. Preflop calls no longer count. Nothing else changes: Hold'em, other
games, tournaments, and every other place the old read is used play exactly as
before.

In the league it won clearly in PLO4 against horses (three seeds, all
significant), won once against the human-style PLO6 field, and lost nothing
significant anywhere, including against the exploiters. That passes the owner
rule, so it ships on. Turning it off is `omahaEvFoldModel: false`.

## What was measured

Data: the same 41,013 real hands the read calibration replayed
(2026-07-22 .. 2026-11-07), 13,667 of them PLO4/5/6. The walk-forward replay
(`server/src/scripts/horseReadCalibration.ts`) was run again with every Omaha
player, horse or person, as a target, so every read is the one a horse had
before the hand. Labels only split the report; no fitted number uses them.
Scoring is out of sample: constants fit on the first half of the timeline,
scored on the second.

### The Omaha thresholds checked (second half, out of sample)

| Read a horse uses in Omaha                                    | Who      | Spots | Predicted | Actual | Verdict                                         |
| ------------------------------------------------------------- | -------- | ----- | --------- | ------ | ----------------------------------------------- |
| Bet engine fold model (MDF x bluff multiplier), flop and turn | everyone | 9,268 | 37.8%     | 52.0%  | **badly low** (Brier 0.2471; fixed 0.2218)      |
| same                                                          | people   | 2,873 | 20.9%     | 35.7%  | **badly low**                                   |
| same                                                          | horses   | 6,395 | 45.3%     | 59.3%  | **badly low**                                   |
| Fold vs aggression as used postflop (x1.45 / x0.55 lines)     | people   | 3,842 | 27.5%     | 41.5%  | low; 85% labelled "station", those folded 40.7% |
| Shared-memory fold to a 3-bet                                 | people   | 479   | 19.4%     | 2.3%   | high (see below)                                |
| Shared-memory fold to a postflop bet                          | people   | 3,953 | 40.1%     | 40.5%  | calibrated                                      |
| Shared-memory river call                                      | people   | 708   | 36.2%     | 35.5%  | calibrated                                      |
| River fold (legacy, gate 8)                                   | people   | 606   | 69.1%     | 69.1%  | calibrated                                      |

Fold to a 3-bet is far off for people (they almost never fold to an Omaha
3-bet; the prior starts from the horse population, 35-42%), but it only
engages to switch 3-bet bluffs off, and the PLO presumption (every unknown
Omaha opponent is read as an aggressive raiser; kept unchanged) already turns
them off. The horses continue 87-97% of their opens against a person's 3-bet,
and those calls are not losing (PLO5 +11.1 +/- 9.2 bb per call, PLO4 +7.0 +/-
11.6). So it was not the worst one to fix.

Calling down a barreller: horses that call a person's first turn or river bet
are not losing (turn small +16.2 +/- 6.1 bb per call, turn pot-sized +17.3 +/-
8.3, river pot-sized +8.7 +/- 8.9). The call-down thresholds are not the leak.

### Fold share over MDF, all seats pooled

| Game             | Flop/turn responses | Fold share | Mean MDF of the sizes faced | Fold over MDF |
| ---------------- | ------------------- | ---------- | --------------------------- | ------------- |
| PLO4 cash        | 5,125               | 47.6%      | 36.9%                       | 1.289         |
| PLO5 cash        | 12,104              | 54.1%      | 37.1%                       | 1.458         |
| PLO6 cash        | 1,031               | 49.6%      | 35.2%                       | 1.409         |
| PLO4 tournaments | 375                 | 39.5%      | 36.1%                       | 1.093         |
| PLO5 tournaments | 177                 | 37.3%      | 35.8%                       | 1.041         |
| PLO6 tournaments | 141                 | 36.9%      | 35.2%                       | 1.047         |

Tournament players fold about MDF, so the model is cash only. A first version
priced tournaments with the cash ratio and lost the PLO4 40bb tournament
mirror (-3.25 +/- 1.16 and -5.26 +/- 1.18 bb/100); the shipped version leaves
tournaments alone (0 of 12,000 tournament pairs diverge).

## The change

`HorseMind.evFoldMul(opponent)` is what the EV bet engine
(`HorseEvEngine.mdfFold`) reads at its three Omaha call sites in
`HorseLogic.decidePostflop` (flop remainder pricing, the solverless bet
engine, the combo-draw raise). Off, or anywhere but a PLO4/5/6 cash table, it
is `HorseMind.exploit(opponent).bluffMod`, exactly as before. On:

    foldMul = foldOverMdf[game] x shrunk(fold to a postflop bet) / population[game]

`shrunk` is the opponent's postflop fold-to-bet exploit counter with 16
pseudo-observations of the game's population rate (PLO4 0.490, PLO5 0.536,
PLO6 0.497), so a stranger is priced at the game's measured rate and a long
sample speaks for itself. A proven winner still gets fewer bluffs (x0.6); the
V53 pressure floor still applies on top; `mdfFold` still clamps 0.4 .. 1.8.
Constants: `OMAHA_EV_FOLD_MODEL` in `server/src/engine/HorseMind.ts`. Labels
never select anything: horses and people get the same model.

## League A/B (arm A = on, arm B = off; owner rule: |bb/100| > 2 x stderr)

Mirror = HorseLeague runMatchup, six horses. Human field = one hero horse
against the human-calibrated Omaha development population
(`HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID`; a development field, not a
promotion field). Cells = RiverBluffBaselineLeague, one hero horse.

| Card                                                                | Game            | Seed        | Pairs  | bb/100 | stderr | Divergent pairs | Verdict           |
| ------------------------------------------------------------------- | --------------- | ----------- | ------ | ------ | ------ | --------------- | ----------------- |
| Mirror (all horses)                                                 | PLO4 6-max cash | 20261112    | 6,000  | +3.74  | 1.63   | 634             | **positive**      |
| Mirror (all horses)                                                 | PLO4 6-max cash | 20261113    | 6,000  | +4.29  | 1.48   | 683             | **positive**      |
| Mirror (all horses)                                                 | PLO4 6-max cash | 20261114    | 6,000  | +3.05  | 1.46   | 664             | **positive**      |
| Mirror (all horses)                                                 | PLO5 6-max cash | 20261112    | 6,000  | +4.46  | 2.31   | 889             | inside 2 se       |
| Mirror (all horses)                                                 | PLO5 6-max cash | 20261113    | 6,000  | +1.46  | 2.18   | 858             | inside 2 se       |
| Mirror (all horses)                                                 | PLO5 6-max cash | 20261114    | 6,000  | -1.13  | 2.27   | 917             | inside 2 se       |
| Mirror (all horses)                                                 | PLO6 6-max cash | 20261112    | 6,000  | +4.86  | 2.51   | 746             | inside 2 se       |
| Mirror (all horses)                                                 | PLO6 6-max cash | 20261113    | 6,000  | -1.44  | 2.00   | 659             | inside 2 se       |
| Mirror (all horses)                                                 | PLO6 6-max cash | 20261114    | 6,000  | -2.30  | 2.17   | 697             | inside 2 se       |
| Human-calibrated Omaha field                                        | PLO4 6-max cash | 20261112    | 12,000 | +2.72  | 6.23   | 221             | inside 2 se       |
| Human-calibrated Omaha field                                        | PLO4 6-max cash | 20261113    | 12,000 | +3.02  | 3.77   | 190             | inside 2 se       |
| Human-calibrated Omaha field                                        | PLO4 6-max cash | 20261114    | 12,000 | -5.93  | 6.74   | 206             | inside 2 se       |
| Human-calibrated Omaha field                                        | PLO5 6-max cash | 20261112    | 12,000 | -6.30  | 8.99   | 359             | inside 2 se       |
| Human-calibrated Omaha field                                        | PLO5 6-max cash | 20261113    | 12,000 | +2.99  | 7.80   | 367             | inside 2 se       |
| Human-calibrated Omaha field                                        | PLO6 6-max cash | 20261112    | 12,000 | +19.77 | 8.10   | 338             | **positive**      |
| Human-calibrated Omaha field                                        | PLO6 6-max cash | 20261113    | 12,000 | -0.91  | 7.76   | 345             | inside 2 se       |
| Cell, mixed field (horses, calibrated humans, station, over-folder) | PLO4 cash       | 20261112    | 8,000  | -4.77  | 8.39   | 155             | inside 2 se       |
| Cell, mixed field                                                   | PLO5 cash       | 20261112    | 8,000  | +9.27  | 5.58   | 215             | inside 2 se       |
| Cell, mixed field                                                   | PLO6 cash       | 20261112    | 8,000  | +0.93  | 4.37   | 164             | inside 2 se       |
| Cell, standard field (horses)                                       | PLO4 cash       | 20261112    | 8,000  | +2.21  | 2.20   | 180             | inside 2 se       |
| Cell, standard field                                                | PLO5 cash       | 20261112    | 8,000  | -1.59  | 4.34   | 242             | inside 2 se       |
| Cell, standard field                                                | PLO6 cash       | 20261112    | 8,000  | +3.55  | 4.29   | 233             | inside 2 se       |
| Cell, station field                                                 | PLO4 cash       | 20261112    | 8,000  | -0.32  | 0.58   | 26              | inside 2 se       |
| Cell, station field                                                 | PLO5 cash       | 20261112    | 8,000  | +1.75  | 1.07   | 23              | inside 2 se       |
| Cell, station field                                                 | PLO6 cash       | 20261112    | 8,000  | +1.02  | 3.55   | 63              | inside 2 se       |
| Mirror, 40bb tournament                                             | PLO4            | 20261112/13 | 6,000  | +0.00  | 0.00   | 0               | inert (cash only) |

Seeds pooled (inverse-variance; each seed is an independent deal set):

| Card        | Game            | Pooled bb/100 | stderr | Verdict      |
| ----------- | --------------- | ------------- | ------ | ------------ |
| Mirror      | PLO4 6-max cash | +3.68         | 0.88   | **positive** |
| Mirror      | PLO5 6-max cash | +1.56         | 1.30   | inside 2 se  |
| Mirror      | PLO6 6-max cash | -0.12         | 1.27   | inside 2 se  |
| Human field | PLO4 6-max cash | +1.29         | 2.91   | inside 2 se  |
| Human field | PLO5 6-max cash | -1.00         | 5.89   | inside 2 se  |
| Human field | PLO6 6-max cash | +8.99         | 5.60   | inside 2 se  |

### Exploiters, PLO4 6-max 100bb (exploiterLeague.ts, 3,000 pairs, seed 20261110, memory on)

Edge = what the exploiter earns over a production horse in its seat. On and
off play the same deals; the difference's stderr is the conservative
unpaired one.

| Exploiter        | Edge, off       | Edge, on        | On minus off  |
| ---------------- | --------------- | --------------- | ------------- |
| hx barrel air    | +20.2 +/- 8.6   | +19.0 +/- 9.2   | -1.2 +/- 12.6 |
| hx river overbet | +16.5 +/- 9.4   | +17.4 +/- 9.9   | +0.9 +/- 13.7 |
| hx station       | -252.6 +/- 35.8 | -251.5 +/- 36.1 | +1.1 +/- 50.8 |
| calling station  | -671.9 +/- 56.7 | -670.9 +/- 56.5 | +1.0 +/- 80.0 |
| river overbettor | -30.1 +/- 28.8  | -35.3 +/- 28.2  | -5.2 +/- 40.3 |

No exploiter earns significantly more with the switch on. The barrel-air leak
in PLO4 (+20 bb/100) is not closed by this change: it comes from the horses
folding to the exploiter's barrels on the turn and river, which is the
call-down side, and the replay above shows the horses' real call-downs are
not losing against people.

## Verdict

**Default ON.** Significantly positive: PLO4 mirror on all three seeds
(pooled +3.68 +/- 0.88 bb/100) and the PLO6 human field on one seed (+19.77
+/- 8.10). No card or exploiter cell is significantly negative.

## Files

- `server/src/engine/HorseMind.ts`: `OMAHA_EV_FOLD_MODEL`, `evFoldMul`,
  `omahaEvFoldMulOf`, `DecisionReadOptions.omahaEvFoldModel`.
- `server/src/engine/HorseLogic.ts`: the switch (default on) and the three EV
  engine call sites.
- `server/src/engine/HorseDataLedger.ts`: ledger entry.
- `server/src/benchmark/HorseLeague.ts`: cards `plo4/plo5/plo6_omaha_ev_fold`
  (both arms explicit).
- `server/src/scripts/readCalibrationLeague.ts`: `--flag=omahaEvFoldModel`.
- `server/src/engine/HorseMindOmahaEvFoldModel.test.ts`: focused tests.
- Frozen-corpus tests that pin older Omaha play (opponent-exploit neutrality
  corpus, the maniac recency pin, the continuation outlook audit) keep the
  switch off, the way they isolate every later layer.
- Evidence (scripts, outputs, every league JSON and log):
  `/Volumes/SmarterArchives/agent-evidence/omaha-thresholds-01Bb/`.
