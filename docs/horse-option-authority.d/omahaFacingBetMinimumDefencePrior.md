# omahaFacingBetMinimumDefencePrior: Authority For The Live Switch

Built 2026-11-24 by PLO-OWNER lead-6 (session 01BNteGX) from the PLO4/PLO5 over-fold root cause (plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4) and the multiway audit (multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Evidence NOT MET: the option is registered, default off (read `=== true`), and has offline replay and law-test evidence only. This file does not authorize switching the option on.

## What It Does

F6. With F1 or F3 on: a bettor with no shown record of the cell is priced with at least the cell's minimum-defence share of air (his weakest bin), so the Horse's whole heads-up range folds no more than s / (1 + s) + 0.05 to a bet of size s. Calibrated by `omaha-facing-bet-range-fit.mjs calibrate` over the root-cause report's league state set (F2 on, rake 0): PLO4 turn mid 0.197, river under 0.4 0.309, river mid 0.323; PLO5 turn mid 0.179, river mid 0.260; the flop, the turn under 0.4 pot and the PLO5 river under 0.4 pot need none. Bets of 0.7 pot or more get no bound (measured weakest calls there already lose, report section 2d; MDF there would pay off). A record is never bounded; a raise is never bounded. Receipts `omaha_priced_facing_bet_min_defence_bounded`, `omaha_flop_call_tree_min_defence_bounded`.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em and every other game (byte-identical; `scripts/ops/horse-flag-off-check.sh origin/main HEAD` 0 differences with every new option off). No input reads whether an opponent is a person or a Horse, a user id, a name or another seat's cards (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`). Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the listed streets.

Tables: `server/src/engine/HorseOmahaFacingBetRangeTables.json` (v1-2026-11-24), fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17 06Z - Nov 24 07Z (232,468 hands read, 113,115 reaching a flop on one board), hole cards only of players the showdown lists as not mucked, every player pooled.

## What Was Measured

Offline replay of the root-cause report's PLO4/PLO5 cash state set (`plo-overfold/abl/states`, 4,661 postflop facing-bet states, 2 seeds, live switch rows of 2026-11-24 05:20Z): see `plo-lead6-01BNteGX/plo-pricing/BUILD.md` (heads-up and multiway fold % by street and size, before / after, every option alone and together). Law tests: `anOmahaFacingBetDefendsAtThePrice.law.test.ts`, `HorseOmahaFacingBetPriced.realHands.law.test.ts`, `anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`. Not measured: live rates, the league mirror and the human-calibrated league (cards `plo4_/plo5_omahaFacingBetMinimumDefencePrior` in `HorseLeague.ts`).

## Replay

- Replay: NOT RUN (built 2026-11-24; the audited-set scorer was not run; offline league-state replay only)
