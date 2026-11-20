# omahaTournamentsExcludeCategoricalRules: authority for the live switch

**State: OFF in source (read `=== true`), no switch row, UNEVALUATED. Do not switch on.** Evidence rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md met: mechanism, scope, tests and off-identity only; no replay, no league result.

Owner order it rests on, 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc." Built by the Horse Switch lane (builder ROWFIX, 2026-11-18) from the TOURNAMENTS swarm inventory (D1, fix 4).

## What it does

`omahaStrategyInTournaments` (on in production since 2026-11-16) opens every cash-scoped PLO4/PLO5 rule of 2026-11-15 to tournament hands inside its public scope (PLO4/PLO5 high, one board, not All-In-Or-Fold or Lightning, the Horse deeper than 14 big blinds) through `HorseOmahaTournamentScope.omahaCashOnlyExcludes`. Twelve of the rules it opens are classed `categorical` in `HorseOmahaRuleSites` (they decide by a size, a chip count, a hand category, a line or a label), and every evaluation of them was in 100 bb cash.

With this option on, those categorical rules stay cash-only in every tournament hand: their sites read `omahaCategoricalCashOnlyExcludes`, which equals `omahaCashOnlyExcludes` except that it is also true in a tournament hand when the decision's scope carries `excludeCategorical` (set by `HorseLogic.decide` only with the option on and the extension on). The sites:

- omahaTurnRiverRaiseNeedsNuts (and omahaRiverNutRaiseOnly): `HorseOmahaTurnRiverRaiseNeedsNuts.omahaRaiseNeedsNutsScope`;
- omahaNoDrawRaiseOutOfPosition: the draw-raise bar, `HorseOmahaBigDrawAggression.omahaDrawRaiseBarOf`;
- omahaOopTurnCheckAfterFlopCall, omahaBareOverpairOopFlopCheck, omahaOverpairNoOopBarrelVsValueLeader, omahaPairedTurnNoBarrelWithoutBoatVsValueLeader, omahaPairedRiverNoThinLeadVsValueLeader: the common scope `HorseOmahaOopChecks.scopeStreet`;
- omahaPressureNeedsPostflopAggression: its three sites in HorseLogic;
- omahaBluffCatcherFoldVsValueLeader, omahaUnderpairNoMultiwayFlopContinue, omahaMadeHandDefenseVsValueLeader (`omahaValueLeaderDefenseInScope`), omahaRiverNutBlockerBluffReachable: their HorseLogic sites.

Unchanged with it on: the priced and outside rules (facing-bet EV, card impact, the street plan, big-draw aggression, the re-raise-by-position rules, the paired-board price exception and the rest), the survival premium, cash play, PLO6 and every tournament hand outside the public scope. The receipt validator's admission scope is unchanged (it admits a superset of the answers).

Off (absent or false): byte-identical. Changing live tournament play, it is a new option instead of a change to `omahaStrategyInTournaments` (owner ruling: a change to what a live option does must leave production identical).

## Tests

`server/src/engine/HorseOmahaStrategyInTournaments.test.ts`, describe "omahaTournamentsExcludeCategoricalRules": the scope read equals `omahaCashOnlyExcludes` for every scope without the option and is never true in cash; the forced-input nut-raise and draw-raise rules stand aside with it on while `omahaBigDrawAggression` still acts; on the nine recorded nodes off and unset are byte-identical and cash is unchanged with it on; in tournament hands categorical receipts fire with it off and none with it on.

## Receipts

None of its own: with it on the categorical rules' receipts stop firing in tournament hands (`omaha_turn_river_raise_needs_nuts_*`, `omaha_oop_*`, `omaha_pressure_needs_*` and the others of their sites).

## Evaluation (owed)

League cards declared, not run: `plo4_mtt_6max_omaha_tournaments_exclude_categorical_rules_40bb` and `plo5_...` in `server/src/benchmark/HorseLeague.ts` (both arms `OMAHA_LIVE_OPTIONS_20261118`, arm A adds this option). A PASS-BAR must be written before any run; nothing has been measured.
