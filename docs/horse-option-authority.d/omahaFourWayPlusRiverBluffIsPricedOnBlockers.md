# omahaFourWayPlusRiverBluffIsPricedOnBlockers: Authority For The Live Switch

**Evidence NOT MET: on the fixed harness it changed no deal on any card (0 changed deals on 6 runs), so nothing is measured about it acting.** Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaFourWayPlusRiverBluffIsPricedOnBlockers`). Built 2026-11-27 by PLO-OWNER lead-9 worker UB (lane l9-underbluff) on Dan's orders (under-bluffing is priority one with over-folding; late-street bluffs are "MATH DEPENDANT, AND BLOCKER DEPENDANT, OR HAVE THE RANGE ADVANTAGE"; "the stats need to be used against human players, not horses"). This file does not authorize switching the option on: switches are made only through the shadow stage and the live-switch procedure.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, on the river with three or more opponents live (four-way and wider) (none all in), nothing to call and no river wager yet: a final CHECK becomes the best-priced bet only when BOTH hold. The math: the bet, scored as lost every time anybody continues (a raise costs the same), is worth more than the check by more than the binomial error of the opponents' fold rates. The blockers: the Horse's cards take more of the opponents' continuing hands than of their folding hands (the share of the field that folds given the Horse's cards is above the share without them). And it must be a BLUFF: the Horse beats less than half of the hands each opponent folds to that size, so the folds it buys are of better hands; a bet that mostly folds out worse hands is value or protection and is left to the engine (lead-9 ruling 2026-11-27 on a replay of the first build over 823 real multiway river nodes, which moved 77 medium and 25 value-class checks: those are excluded, not justified). It changes only a check into a bet, never a raise or a fold (owner rule: a hand that is not nut class never raises the turn or river). Heads-up spots, PLO6, hold'em and tournaments are untouched (`server/src/engine/HorseOmahaMultiwayRiverBluff.ts`; law `anOmahaMultiwayRiverBluffIsPriced.law.test.ts`; cost law `anOmahaMultiwayRiverBluffIsFast.law.test.ts`).

Each opponent's fold is one estimate, the same function for every opponent: his own lifetime public multiway river fold record, then people's multiway population, then the multiway equilibrium, each shrunk to the next by k = 75.9 river answers. Nothing is keyed on an account, a name or a person/Horse flag. The folds are multiplied (taken as independent). His range is the measured people-only river range of a player who checked, or who has not acted (`HorseOmahaRiverOpeningRangeTables.json`), with exact card removal; it was measured heads-up, and a multiway river range is no weaker, so the check is never under-valued by it.

## Why (The Measured Node)

Lane node map (`plo-lead7-01TLQer8/l9-underbluff/NODES.md`): 25,944 PLO4/PLO5 cash hands with a person and a Horse, 2026-10-28 to 2026-11-27, public actions only. On a multiway river after a checked-through turn Horses bet 10.9% of the time in PLO5 against people's 15.9% (z -3.2) and 12.5% against 18.9% in PLO4 (z -2.2); people folded 92% of 158 answers (PLO5) and 90% of 59 (PLO4) to those Horse bets; a zero-equity bet there was worth +20.2 +/- 5.0 bb (PLO5, 171 bets) and +8.1 +/- 3.4 bb (PLO4, 59 bets) against the field (people and Horses). The priced river bluffs (omahaRiverBluffIsPricedOnBlockers, omahaRiverBluffIsPricedOnRangeAdvantage) are heads-up and omahaMultiwayCheckedToBetIsPriced prices the flop and turn only; the one thing that bluffs a multiway river today is the baseline riverBluffMultiway of 2026-11-06 (`HorseMultiwayRiverBluff.ts`: a nut blocker, a capped line and a frequency draw, not a price on anybody's fold), and the gap above was measured with it on. This option runs after it and prices the checks it leaves. Limits of that measurement: the field's fold-through includes Horse opponents; in PLO5 one person gave 67% of the people answers.

## The Two Fields

The rule is switched by field (lead-9 ruling 2026-11-27: three-way first): `omahaMultiwayRiverBluffIsPricedOnBlockers` acts with exactly two opponents (three-way), `omahaFourWayPlusRiverBluffIsPricedOnBlockers` with three or more. People's cells are measured by field (`w3`, `w4`); each size cell shrinks to the equilibrium anchor by k = 75.9 answers, so a thin four-way cell (PLO4 four-way: 5 and 7 answers) stays at the anchor, where a bet scored as lost when continued is never worth more than the check.

## Rollback Trigger

Switch this option off (row off; nothing else to undo) when, counted on its own receipt against people only (a bet whose every opponent is a person, or the people answers of mixed pots): after 30 bets the realised all-fold share is below the break-even B / (P + B) of those bets by 2 standard errors, OR the realised chips of those bets are below zero by 2 standard errors. Also off on any decision over 50 ms or any horse_error_log row naming its receipt.

## Dependency

Each opponent's own record moves his fold only at k = 75.9 answers: too slow to notice a person who starts calling. Worker RV (lane `l9-river`) is building a faster public-evidence record; once it exists this option's `recordOf` reads it, and until then the rollback trigger above is the guard.

## Grades (2026-11-27, head 3d86c8545b3f)

Fixed harness (`server/scripts/horse-grade.ts`), base = the live switch rows of 2026-11-27 (flop cap and both river bluffs on), 100 bb, every figure ON minus the same-seed no-op in bb/100 pooled over two seeds; the no-op arm read 0.00 with 0 divergent deals on every run. Bars were written in the lane's BUILD.md before the runs: people responder and mirrors not below -1 SE, station / over-folder / balanced not below -2 SE, at least 30 changed deals over the people card and mirrors, people point estimate not negative, flag-off 0 differences, cost law.

| game | card                        | seats | seeds | ON minus same-seed no-op, bb/100 | SE units | changed deals | floor | result          |
| ---- | --------------------------- | ----- | ----- | -------------------------------- | -------- | ------------- | ----- | --------------- |
| PLO4 | mirror (all Horses)         | 6     | 1     | +0.00 +/- 0.00                   | +0.0     | 0             | -1 SE | PASS (one seed) |
| PLO4 | calling station             | 6     | 1     | +0.00 +/- 0.00                   | +0.0     | 0             | -2 SE | PASS (one seed) |
| PLO4 | people-calibrated responder | 6     | 1     | +0.00 +/- 0.00                   | +0.0     | 0             | -1 SE | PASS (one seed) |
| PLO5 | mirror (all Horses)         | 6     | 1     | +0.00 +/- 0.00                   | +0.0     | 0             | -1 SE | PASS (one seed) |
| PLO5 | calling station             | 6     | 1     | +0.00 +/- 0.00                   | +0.0     | 0             | -2 SE | PASS (one seed) |
| PLO5 | people-calibrated responder | 6     | 1     | +0.00 +/- 0.00                   | +0.0     | 0             | -1 SE | PASS (one seed) |

- It changed no deal on any card run (one seed per card; the second seed and the over-folder and balanced cards were stopped as nothing was being measured): with three or more opponents the product of the folds does not clear the price in the harness, and the thin four-way cells sit at the anchor by design. No harm shown, no evidence of acting.
- Flag-off: 0 differences in 28,000 decisions (head 3d86c8545b3f against main aa0d211cb689). Cost: the same law as the three-way option (ratio 1.03, limit 3).
- Audited replay: 0 of 869 and 0 of 2,697 audited decisions change (rows below).

## Prior anchor

- Baseline: the multiway equilibrium. The bettor is indifferent when all N opponents fold B / (P + B) of the time, so one opponent of N folds (B / (P + B)) ^ (1 / N); a thin people cell reads it, and at the anchor a bet scored as lost when called is never worth more than a check.
- Population weight: the PEOPLE-ONLY multiway river fold multiplier for the game, the turn line and the size (`HorseOmahaMultiwayRiverFoldTables.json` v1-2026-11-27-people, fit by `scripts/ops/omaha-multiway-river-fold-fit.mjs` on 26,399 hands of 2026-10-28 to 2026-11-27: answers by people only to a river first wager made with two or more opponents live; a Horse's answer never enters a cell; no HUD population rows), the size cell shrunk to equilibrium and the line cell to the size cell by k = 75.9 answers.
- Own record: the opponent's own lifetime public multiway river fold record (OPPONENT-HUD first-wager fold record, `HorseMind.omahaStrongHandCheckRecordsOf` with the number of opponents) shrunk to the people multiplier by the same k, so his own record dominates as it grows; opponents who never fold are never bluffed (law item 3).
- No unshown cards: the fold table is fitted on public actions only (the pull has no hole-card column); his range is the people-only river range table fitted on hands shown at showdown; at decision time the option reads the public table state, the deciding Horse's own cards and the opponents' public records.

## Replay

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm M4 vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2697; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm M4 vs off; replayed 2697 of 2697
