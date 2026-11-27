# omahaMultiwayRiverBluffIsPricedOnBlockers: Authority For The Live Switch

**Evidence NOT MET: grades pending (bars and results below are filled in by the lane before any switch).** Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaMultiwayRiverBluffIsPricedOnBlockers`). Built 2026-11-27 by PLO-OWNER lead-9 worker UB (lane l9-underbluff) on Dan's orders (under-bluffing is priority one with over-folding; late-street bluffs are "MATH DEPENDANT, AND BLOCKER DEPENDANT, OR HAVE THE RANGE ADVANTAGE"; "the stats need to be used against human players, not horses"). This file does not authorize switching the option on: switches are made only through the shadow stage and the live-switch procedure.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, on the river with two or more opponents live (none all in), nothing to call and no river wager yet: a final CHECK becomes the best-priced bet only when BOTH hold. The math: the bet, scored as lost every time anybody continues (a raise costs the same), is worth more than the check by more than the binomial error of the opponents' fold rates. The blockers: the Horse's cards take more of the opponents' continuing hands than of their folding hands (the share of the field that folds given the Horse's cards is above the share without them). A hand that beats more than half of every opponent's continuing hands is a value bet and is left to the engine. It changes only a check into a bet, never a raise or a fold (owner rule: a hand that is not nut class never raises the turn or river). Heads-up spots, PLO6, hold'em and tournaments are untouched (`server/src/engine/HorseOmahaMultiwayRiverBluff.ts`; law `anOmahaMultiwayRiverBluffIsPriced.law.test.ts`; cost law `anOmahaMultiwayRiverBluffIsFast.law.test.ts`).

Each opponent's fold is one estimate, the same function for every opponent: his own lifetime public multiway river fold record, then people's multiway population, then the multiway equilibrium, each shrunk to the next by k = 75.9 river answers. Nothing is keyed on an account, a name or a person/Horse flag. The folds are multiplied (taken as independent). His range is the measured people-only river range of a player who checked, or who has not acted (`HorseOmahaRiverOpeningRangeTables.json`), with exact card removal; it was measured heads-up, and a multiway river range is no weaker, so the check is never under-valued by it.

## Why (The Measured Node)

Lane node map (`plo-lead7-01TLQer8/l9-underbluff/NODES.md`): 25,944 PLO4/PLO5 cash hands with a person and a Horse, 2026-10-28 to 2026-11-27, public actions only. On a multiway river after a checked-through turn Horses bet 10.9% of the time in PLO5 against people's 15.9% (z -3.2) and 12.5% against 18.9% in PLO4 (z -2.2); people folded 92% of 158 answers (PLO5) and 90% of 59 (PLO4) to those Horse bets; a zero-equity bet there was worth +20.2 +/- 5.0 bb (PLO5, 171 bets) and +8.1 +/- 3.4 bb (PLO4, 59 bets) against the field (people and Horses). No other option acts on a multiway river: the river bluffs are heads-up, and omahaMultiwayCheckedToBetIsPriced prices the flop and turn only. Limits of that measurement: the field's fold-through includes Horse opponents; in PLO5 one person gave 67% of the people answers.

## What Was Measured

Bars were written in the lane's BUILD.md before any grade. Results: see the Grades section the lane fills in below.

## Prior anchor

- Baseline: the multiway equilibrium. The bettor is indifferent when all N opponents fold B / (P + B) of the time, so one opponent of N folds (B / (P + B)) ^ (1 / N); a thin people cell reads it, and at the anchor a bet scored as lost when called is never worth more than a check.
- Population weight: the PEOPLE-ONLY multiway river fold multiplier for the game, the turn line and the size (`HorseOmahaMultiwayRiverFoldTables.json` v1-2026-11-27-people, fit by `scripts/ops/omaha-multiway-river-fold-fit.mjs` on 26,399 hands of 2026-10-28 to 2026-11-27: answers by people only to a river first wager made with two or more opponents live; a Horse's answer never enters a cell; no HUD population rows), the size cell shrunk to equilibrium and the line cell to the size cell by k = 75.9 answers.
- Own record: the opponent's own lifetime public multiway river fold record (OPPONENT-HUD first-wager fold record, `HorseMind.omahaStrongHandCheckRecordsOf` with the number of opponents) shrunk to the people multiplier by the same k, so his own record dominates as it grows; opponents who never fold are never bluffed (law item 3).
- No unshown cards: the fold table is fitted on public actions only (the pull has no hole-card column); his range is the people-only river range table fitted on hands shown at showdown; at decision time the option reads the public table state, the deciding Horse's own cards and the opponents' public records.

## Replay

- Replay: NOT RUN (pending: the lane runs the audited sets before the pull request is opened)
