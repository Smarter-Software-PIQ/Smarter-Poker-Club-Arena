# Omaha read-conditional defence: the 4-bet fold only against a tight re-raiser, the made-hand defence only against a value leader

Date: 2026-11-15. Lane: PLO Strategy. Owner instruction 2026-11-15 01:03 America/Chicago (play a maniac and a tight player differently; fix the problem, not particular folds). Two new options, both off by default (read `=== true`): `omahaReraisedFoldVsTight` and `omahaMadeHandDefenseVsValueLeader`.

## What happened

Three PLO rules built on the owner's complaints failed their declared league evaluations and ship off: the made-hand defence (`omahaBeatenMadeHandDefense`: Horses against a loose-aggressive value seat PLO4 -23.73, PLO5 -16.17 bb/100), the preflop 4-bet fold (`omahaReraisedPotDiscipline`: against that seat PLO5 -11.95, against a light 4-bettor PLO4 +14.94) and the one-pair rules (`omahaOnePairDiscipline`). Each rule is right against one kind of opponent and wrong against another.

## Root cause

The rules read only public information and the Horse's cards, so they treated a tight 4-bettor and a light one, and a value-heavy bettor and an over-bluffer, the same way.

## What changed

New `server/src/engine/HorseOmahaReadConditional.ts` and `HorseMind.omahaReadConditionalOf`: from the opponent memory's decayed counters (the ones every exploit read uses), whether a player is MEASURED (15+ decayed hands, the Omaha presumption evidenced or disproved; a presumed read never counts), a measured TIGHT RE-RAISER (not a maniac, re-raise rate credibly at or below the Horse mean on 12+ decayed opportunities, no recent burst) and a measured postflop VALUE LEADER (8+ decayed postflop opportunities; bet when checked to not credibly above the Horse mean, not a postflop maniac, no recent burst; folds to bets at least and calls rivers at most as often as the average Horse; preflop width is not part of it).

1. `omahaReraisedFoldVsTight`: the preflop cell of the re-raised-pot discipline (unchanged) runs outermost on both decision paths only when the last preflop raiser is a measured tight re-raiser. Receipts `omaha_reraised_fold_vs_tight`, `_priced_in`, `_withheld`.
2. `omahaMadeHandDefenseVsValueLeader`: the made-hand defence's turn no-raise and scare-card checks (unchanged) keep a change only when every live opponent is a measured value leader. Receipts `omaha_value_leader_defense_applied` and `_withheld` beside the defence's own.

Against an unknown, presumed, wide, maniac, over-bluffing or station opponent each option gives today's decision. The failed options and their modules are unchanged; each new option stands aside while its unconditional parent is on. With both unset or false the brain plays exactly as before. League cards plo4/plo5 for each; evidence files `docs/horse-default-on.d/omahaReraisedFoldVsTight.md` and `omahaMadeHandDefenseVsValueLeader.md`.

## Evaluation

Declared in the evidence archive (`plo-handoff-review-01a1cbbd/readcond-20261115/PROTOCOL-*.md`) before any graded run; the verdicts are added here when they are read.
