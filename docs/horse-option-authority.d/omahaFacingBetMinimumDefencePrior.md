# omahaFacingBetMinimumDefencePrior: Authority For The Live Switch

Built 2026-11-24 by PLO-OWNER lead-6 (session 01BNteGX) from the PLO4/PLO5 over-fold root cause (plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4) and the multiway audit (multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Evidence NOT MET: reads the pooled every-player table (owner order Nov 26: people only); superseded by omahaFacingBetPriorIsPeopleMeasured (#12116; it acts only inside omahaFacingBetRangeIsMeasuredByLine and omahaFlopRealizationIsPriced, both superseded). The option is registered, default off (read `=== true`), and has offline replay and law-test evidence only. This file does not authorize switching the option on.

## What It Does

F6. With F1 or F3 on: a bettor with no shown record of the cell is priced with at least the cell's minimum-defence share of air (his weakest bin), so the Horse's whole heads-up range folds no more than s / (1 + s) + 0.05 to a bet of size s. Calibrated by `omaha-facing-bet-range-fit.mjs calibrate` over the root-cause report's league state set (F2 on, rake 0): PLO4 turn mid 0.197, river under 0.4 0.309, river mid 0.323; PLO5 turn mid 0.179, river mid 0.260; the flop, the turn under 0.4 pot and the PLO5 river under 0.4 pot need none. Bets of 0.7 pot or more get no bound (measured weakest calls there already lose, report section 2d; MDF there would pay off). A record is never bounded; a raise is never bounded. Receipts `omaha_priced_facing_bet_min_defence_bounded`, `omaha_flop_call_tree_min_defence_bounded`.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em and every other game (byte-identical; `scripts/ops/horse-flag-off-check.sh origin/main HEAD` 0 differences with every new option off). No input reads whether an opponent is a person or a Horse, a user id, a name or another seat's cards (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`). Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the listed streets.

Tables: `server/src/engine/HorseOmahaFacingBetRangeTables.json` (v1-2026-11-24), fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17 06Z - Nov 24 07Z (232,468 hands read, 113,115 reaching a flop on one board), hole cards only of players the showdown lists as not mucked, every player pooled.

## What Was Measured

Offline replay of the root-cause report's PLO4/PLO5 cash state set (`plo-overfold/abl/states`, 4,661 postflop facing-bet states, 2 seeds, live switch rows of 2026-11-24 05:20Z): see `plo-lead6-01BNteGX/plo-pricing/BUILD.md` (heads-up and multiway fold % by street and size, before / after, every option alone and together). Law tests: `anOmahaFacingBetDefendsAtThePrice.law.test.ts`, `HorseOmahaFacingBetPriced.realHands.law.test.ts`, `anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`. Not measured: live rates, the league mirror and the human-calibrated league (cards `plo4_/plo5_omahaFacingBetMinimumDefencePrior` in `HorseLeague.ts`).

## Prior anchor

- Baseline: the whole heads-up range of a no-record bettor folds at most mean s / (1 + s) + 0.05 per street and size bucket under 0.7 pot.
- Population weight: this option is the reduction: where the measured population prior would make the range fold above the baseline, its air share is raised to the smallest share that meets it (calibrated by `omaha-facing-bet-range-fit.mjs calibrate`; values and note in `HorseOmahaFacingBetRangeTables.json`).
- Own record: a bettor's own record is never bounded; a measured value-heavy record may justify folding more (law test, 59 value of 60 shown).
- No unshown cards: the tables are fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from `hand_history` hole cards only of players the showdown lists as not mucked; at decision time the option reads the public table state and the deciding Horse's own cards only (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`).

## Replay

- Replay: fixed 20; newlyWrong 8; changed 31; unchanged 3732; unjudged 3; set HVH48 B PLO4/PLO5 cash (memory off); scorer 5302af2ab3e; source placed verdict-only; arm f1f2f6 vs off; replayed 3763 of 3884
- Note (2026-11-24): arm f1f2f6 is omahaFacingBetRangeIsMeasuredByLine + omahaFacingBetIndifferenceCalls + omahaFacingBetMinimumDefencePrior together (they act inside one verdict); harness scripts/audited-node-option-replay.ts, seeds 1,7,42, opponent memory off. Bar fixed >= 2 x newly wrong: met (20 vs 8). Real-card EV grade not run (see omahaFlopRealizationIsPriced.md).
