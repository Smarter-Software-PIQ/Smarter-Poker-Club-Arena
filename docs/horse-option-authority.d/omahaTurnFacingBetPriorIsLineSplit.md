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

| cell                                                                           | today        | this option alone (shown-only cells) | this option, hidden cells | both options on (shipped code) |
| ------------------------------------------------------------------------------ | ------------ | ------------------------------------ | ------------------------- | ------------------------------ |
| PLO5 heads-up                                                                  | +9.1 +/- 2.7 | +1.6 +/- 2.7                         | -5.8 +/- 2.7              | -5.8 +/- 2.7                   |
| PLO4 heads-up                                                                  | +5.6 +/- 1.6 | +4.2 +/- 1.6                         | +0.1 +/- 1.6              | +3.4 +/- 1.6                   |
| PLO5 3-way                                                                     | +5.7 +/- 3.0 | -0.9 +/- 3.0                         | -10.2 +/- 2.8             | -10.2 +/- 2.8                  |
| PLO5 4+ way                                                                    | +4.5 +/- 2.2 | -2.4 +/- 2.2                         | -5.4 +/- 2.2              | -5.7 +/- 2.2                   |
| PLO4 3-way                                                                     | +7.1 +/- 1.7 | +3.7 +/- 1.8                         | -1.1 +/- 1.8              | +1.3 +/- 1.8                   |
| (OFA's option alone, for reference) PLO4 heads-up / PLO5 heads-up / PLO5 3-way |              |                                      |                           | +3.4 / -5.8 / -7.0             |

(The hidden column's heads-up rows use this option's hidden-corrected cells; with both options on in the shipped code the heads-up bet is priced by `omahaPeoplePriorCountsHiddenBets`' own cell.) Both options on, PLO4 heads-up stays just over the bar (+3.4 +/- 1.6, z 2.1): OFA's per-game PLO4 turn cell is milder than this option's pooled hidden cell (+0.1 +/- 1.6 when this option prices the heads-up bet itself).

Flag-off: `horse-flag-off-check.sh origin/main HEAD --set full`: 0 differences in 28,000 decisions. Speed (relative-cost law, 40 real turn decisions it prices, engine decide): on 8.15 ms vs off 8.20 ms per decision telemetry off (ratio 0.99), 8.27 vs 8.20 telemetry on (1.01). Fixed-harness grades: in the PR body.

## Prior anchor

- Baseline: equilibrium. The balanced non-value share for the price (`omahaEquilibriumAnchor`, two streets on the turn) weighs 30 pseudo-bets behind the people cell and is the whole prior where a cell is unmeasured.
- Population weight: the PEOPLE-ONLY cell of the flop line, heads-up / multiway and size, n / (n + 30).
- Own record: his own shown turn bets of that size and line move the share by their not-value rate over people's (8 pseudo-bets); it dominates as it grows.
- No unshown cards: the fit reads only cards people showed at showdown; at decision time the option reads the public state and the deciding Horse's own cards.

## Replay

- Replay: fixed 0; newlyWrong 2; changed 2; unchanged 867; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm LS vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 1; changed 8; unchanged 2689; unjudged 7; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm LS vs off; replayed 2697 of 2697
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm B vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2696; unjudged 1; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm B vs off; replayed 2697 of 2697

Arm LS = this option alone on the live switch rows; arm B = this option with omahaPeoplePriorCountsHiddenBets (OFA's commit 26d03cb3 merged locally). Alone it changes 10 audited decisions and makes 3 newly wrong, 0 fixed (bar: fixed >= 2x newly wrong: NOT MET); with the hidden-bets option it changes 1 (unjudged).

## Known Limits

- Evidence NOT MET until the fixed-harness grades (value-only bettor, people-calibrated responder, the mucking barreller and give-up bots), the audited replay, flag-off and speed are recorded here.
- With shown-only cells (`omahaPeoplePriorCountsHiddenBets` off) PLO4 heads-up and 3-way stay above the bar: trial it with that option on.
- PLO4 heads-up out of position after a checked flop stays over (+3.8 +/- 1.0 bb per bet with hidden cells, n 52): not a people-cell question (stab and lead cells do not differ); the Horse's checked range is weak there.
