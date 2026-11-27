# omahaTurnFacingBetPriorIsLineSplit: Authority For The Live Switch

Built 2026-11-27 by lead-8 over-fold lane OFB (session 013U37ba) on Dan's order of 2026-11-27 12:27 PM ("we still aren't even close to fixing the over folding bug, and that should be your number 1 priority"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaTurnFacingBetPriorIsLineSplit`; compiled scope 0 = PLO4 and PLO5). **Evidence NOT MET**: the grades are being run; this file does not authorize switching the option on.

## The Defect It Answers

The serving engine (3aa21caa9f7d, live switch rows, runtime settings v15) re-decided every recorded Horse turn decision facing a wager in PLO4/PLO5 cash hands with a person, Oct 27 23Z to Nov 27 05Z (9,898 decisions, the deciding Horse's own cards only, seeds 1/7/42; `plo-lead7-01TLQer8/l8-ofb/BUILD.md`). Pooled over lines no turn size cell leaks, but split by the flop line the over-fold sits in one place: a person's 0.7-1.1 pot turn bet after a CHECKED-THROUGH flop, faced only by Horses. Fold-through and the zero-equity bluff's result per bet against today's engine:

| cell (checked-through flop, 0.7-1.1 pot) | bets | fold-through | break-even | zero-equity bluff, bb per bet |
| ---------------------------------------- | ---- | ------------ | ---------- | ----------------------------- |
| PLO5 heads-up                            | 337  | 66.8%        | 47.2%      | +9.9 +/- 2.6                  |
| PLO4 heads-up                            | 160  | 84.4%        | 48.1%      | +5.9 +/- 1.5                  |
| PLO5 3-way                               | 201  | 65.2%        | 47.9%      | +6.5 +/- 2.7                  |
| PLO5 4+ way                              | 146  | 62.3%        | 47.5%      | +5.5 +/- 2.1                  |
| PLO4 3-way                               | 76   | 77.6%        | 47.2%      | +7.1 +/- 1.6                  |

After the bettor's own flop bet the same bluff loses (PLO5 heads-up -23.1, PLO4 -35.3 bb per bet). Every one of those folds is `omahaFacingBetEv` (`omaha_facing_bet_ev_fold`): heads-up priced by `omahaFacingBetPriorIsPeopleMeasured`, whose people cell is one per street and size whatever the flop line; multiway on the old constant bettor share (that option is heads-up only). The Horse's turn holdings after a checked flop are mostly one pair and board two pair, which it folds 80-86% of the time.

## What It Does

PLO4/PLO5 cash (tables and Lightning, one board, high only, no bomb pot), the turn, a first wager (never a raise), heads-up or multiway, inside the facing-bet verdict (`HorseOmahaTurnLinePeoplePrior.ts`, wired in `HorseLogic.ts`): the bettor's non-value share is

1. his own shown bets of the turn, size and line (the same record cell `omahaFacingBetPriorIsPeopleMeasured` reads), as a Beta-binomial ratio over people's rate in the record unit of this line's cell (8 pseudo-bets);
2. the PEOPLE-ONLY cell of the flop line (checked through / wagered), heads-up or multiway, and size (`HorseOmahaTurnLinePeoplePrior.data.ts`, fitted by `server/scripts/omaha-turn-line-people-prior-fit.ts`: people's turn bets shown at showdown by people, no Horse play, no HUD population rows);
3. the balanced share for the price behind a thin cell (30 pseudo-bets).

One reader, `omahaTurnLinePeopleCell(potFrac, multiway, line, hidden)`, serves the cells. With `omahaPeoplePriorCountsHiddenBets` on (lane OFA: people's bets never shown although they did not win uncontested count as non-value) the multiway cells are the hidden-corrected ones, and a heads-up turn bet stays with that option's own hidden-corrected cell and hidden-counting record, so this option never undoes it. People cells (shown-only / hidden-corrected), 0.7-1.1 pot: checked heads-up 0.528 / 0.662 (n 53 + 21 hidden), wagered heads-up 0.389 / 0.554; checked multiway 0.385 / 0.667 (65 + 55), wagered multiway 0.318 / 0.483. A split by whether the turn was checked to the bettor was measured and not kept (0.556, n 18 vs 0.514, n 35).

No input reads whether a player is a person or a Horse, a name or an account; no unshown card. It never raises; it changes calls and folds only. PLO6, tournaments, the flop and the river are untouched. Receipts `omaha_turn_line_prior_priced`, `_checked_flop`, `_multiway`, `_record_read`, `_changed`. Staged for shadow re-decision on the turn.

## What Was Measured

Serving-engine replay of the 9,898 turn decisions with the option on (live switch rows as the base; same seeds). Checked-through flop, 0.7-1.1 pot, zero-equity bluff bb per bet (bar: not more than +2 SE above zero):

| cell          | today        | option on (shown-only cells) | option on + hidden cells |
| ------------- | ------------ | ---------------------------- | ------------------------ |
| PLO5 heads-up | +9.1 +/- 2.7 | +1.6 +/- 2.7                 | -5.8 +/- 2.7             |
| PLO4 heads-up | +5.6 +/- 1.6 | +4.2 +/- 1.6                 | +0.1 +/- 1.6             |
| PLO5 3-way    | +5.7 +/- 3.0 | -0.9 +/- 3.0                 | -10.2 +/- 2.8            |
| PLO5 4+ way   | +4.5 +/- 2.2 | -2.4 +/- 2.2                 | -5.4 +/- 2.2             |
| PLO4 3-way    | +7.1 +/- 1.7 | +3.7 +/- 1.8                 | -1.1 +/- 1.8             |

(The hidden column's heads-up rows use this option's hidden-corrected cells; with both options on in the shipped code the heads-up bet is priced by `omahaPeoplePriorCountsHiddenBets`' own cell.) Grades on the fixed harness, the audited replay, flag-off and speed follow in this file as they are run.

## Prior anchor

- Baseline: equilibrium. The balanced non-value share for the price (`omahaEquilibriumAnchor`, two streets on the turn) weighs 30 pseudo-bets behind the people cell and is the whole prior where a cell is unmeasured.
- Population weight: the PEOPLE-ONLY cell of the flop line, heads-up / multiway and size, n / (n + 30).
- Own record: his own shown turn bets of that size and line move the share by their not-value rate over people's (8 pseudo-bets); it dominates as it grows.
- No unshown cards: the fit reads only cards people showed at showdown; at decision time the option reads the public state and the deciding Horse's own cards.

## Replay

- Replay: NOT RUN (the audited-decision scorer has not been run for this option yet)

## Known Limits

- Evidence NOT MET until the fixed-harness grades (value-only bettor, people-calibrated responder, the mucking barreller and give-up bots), the audited replay, flag-off and speed are recorded here.
- With shown-only cells (`omahaPeoplePriorCountsHiddenBets` off) PLO4 heads-up and 3-way stay above the bar: trial it with that option on.
- PLO4 heads-up out of position after a checked flop stays over (+3.8 +/- 1.0 bb per bet with hidden cells, n 52): not a people-cell question (stab and lead cells do not differ); the Horse's checked range is weak there.
