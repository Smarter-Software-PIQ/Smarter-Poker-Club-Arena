# omahaRiverBluffIsPricedOnRangeAdvantage: Authority For The Live Switch

**Evidence MET on the scored replay (6 fixed / 1 newly wrong), the probes, the mirror and a real person's hands (+601 bb over 31 bets).** Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaRiverBluffIsPricedOnRangeAdvantage`). Built 2026-11-26 by PLO-OWNER lead-7 (session 01TLQer8), personally, on Dan's orders of 2026-11-26 (late-street bluffs are "MATH DEPENDANT, AND BLOCKER DEPENDANT, OR HAVE THE RANGE ADVANTAGE"; "the stats need to be used against human players, not horses"). This file does not authorize switching the option on: switches are made only through the shadow stage and the live-switch procedure.

## What It Does

PLO4/PLO5 cash river, heads-up, nothing to call: the price of omahaRiverBluffIsPricedOnBlockers (`HorseOmahaRiverOpeningBet.ts`, his fold from his own record, then people's population for the line and size, then equilibrium) with the RANGE ADVANTAGE as the second leg instead of blockers: the Horse's measured range for its line beats his on this texture and the hand is in the weakest share of its range that its value carries at the size.

Nothing is keyed on an account, a name or a person/Horse flag; public actions, the Horse's own cards and the known dead cards only. It changes only a final check into a bet, never a raise or a fold (owner rules: a hand that is not nut class never raises the turn or river; draws are never raised out of position). PLO4/PLO5 cash, high only, one board, no bomb pot, heads-up; PLO6, hold'em and tournaments are untouched (`server/src/engine/HorseOmahaOpeningBluff.ts`; law `anOmahaOpeningBluffIsPricedOnPeople.law.test.ts`).

## What Was Measured

Everything in `plo-lead7-01TLQer8/plo-bluffs/` (harness and outputs in that folder). Base = the live switch rows.

- Flag-off check (`scripts/ops/horse-flag-off-check.sh origin/main HEAD --set full`): 0 differences in 28,000 decisions (all four bluff options off).
- Scripted responders, all four bluff options on together, Horses ON minus OFF, bb/100, 2 seats, 100 bb, 16,000 deals, the responder's public answers served as his lifetime record (as live): calling station PLO4 +0.44 +/- 0.38, PLO5 -0.07 +/- 0.16; over-folder PLO4 +10.28 +/- 2.46, PLO5 +14.18 +/- 3.82. Without the record (the worst case: a station nobody has answers for) the station costs PLO4 -13.1 +/- 1.6, PLO5 -17.7 +/- 2.9: the record is what protects it, and it is live.
- League mirror (Horses ON against OFF, 12,000 hands): PLO4 +6.17 +/- 2.57, PLO5 +13.15 +/- 3.54.
- A winning PLO5 regular (a person; 2,898 recorded heads-up and multiway Horse checks of his last 7 days, public action and the deciding Horse's own cards, opponent memory from his public hands): river checks that become bets, scored against his own measured fold rate by line (woowoo/data/missed_bluffs.csv): omahaRiverBluffIsPricedOnBlockers 46 bets, +270 bb (+5.9 +/- 9.4 each); omahaRiverBluffIsPricedOnRangeAdvantage 31 bets, +601 bb (+19.4 +/- 16.2 each); the turn options 0 bets in 1,463 turn checks (the price keeps the check: against people a turn bet of 0.7 pot and more is folded to 39 to 45%, and the checks it saw kept more by checking).

## Prior anchor

- Baseline: equilibrium, the fold a minimum-defence player gives a bet of B into P, B / (P + B); a thin people cell reads it.
- Population weight: the PEOPLE-ONLY measured fold multiplier for the game, street, the Horse's line and the size (`HorseOmahaPeopleFoldTables.json`, fit by `scripts/ops/omaha-people-fold-fit.mjs`: answers by people only, Horse answers never enter, no HUD population rows), each cell shrunk to equilibrium by the street's measured between-player k (27.8 turn, 75.9 river answers).
- Own record: the opponent's own lifetime public answers (OPPONENT-HUD x.foldToBet by size, live through omahaOpponentLifetimeHud) shrunk to the people multiplier by the same k, so his own record dominates as it grows; a player who never folds is priced as one (probe: calling station ON minus OFF +0.4 +/- 0.4 PLO4, -0.1 +/- 0.2 PLO5).
- No unshown cards: the range tables are fitted on hands shown at showdown (mucked = false); at decision time the option reads the public table state, the deciding Horse's own cards and the opponent's public record.

## Replay

- Replay: fixed 1; newlyWrong 1; changed 2; unchanged 867; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm RR vs off; replayed 869 of 869
- Replay: fixed 5; newlyWrong 0; changed 7; unchanged 2690; unjudged 2; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm RR vs off; replayed 2697 of 2697
