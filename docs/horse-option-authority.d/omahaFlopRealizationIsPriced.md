# omahaFlopRealizationIsPriced: Authority For The Live Switch

Built 2026-11-24 by PLO-OWNER lead-6 (session 01BNteGX) from the PLO4/PLO5 over-fold root cause (plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4) and the multiway audit (multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Evidence NOT MET: the option is registered, default off (read `=== true`), and has offline replay and law-test evidence only. This file does not authorize switching the option on.

## What It Does

F3. PLO4/PLO5 cash flop facing a bet or a raise (tables and Lightning). The call is the two-street tree of `HorseOmahaFlopDefenceTree.omahaFlopDefenceTreeEv` (reused as it is; `omahaFlopDefenceTreeInputs`, which keys on the opponent kind, is not used) on `HorseOmahaFlopCallTree.ts`'s own runouts: the bettor's measured flop range, the field dealt on the same cards, his turn and river bet rates the measured rates after a called heads-up bet (PLO4 0.427 / 0.549, PLO5 0.406 / 0.559) shrunk toward his public per-street counters, his turn barrel and river bet composition from the measured tables. No realization factor, no fitted multiplier (`OMAHA_FLOP_EV_REALIZATION_FIT`, median 0.42, circular). It decides the flop whether `omahaFlopFacingBetEv` is on or off; outside its spot the flop decides as with it off. Receipts `omaha_flop_call_tree_call` / `_fold` / `_changed`.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em and every other game (byte-identical; `scripts/ops/horse-flag-off-check.sh origin/main HEAD` 0 differences with every new option off). No input reads whether an opponent is a person or a Horse, a user id, a name or another seat's cards (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`). Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the listed streets.

Tables: `server/src/engine/HorseOmahaFacingBetRangeTables.json` (v1-2026-11-24), fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17 06Z - Nov 24 07Z (232,468 hands read, 113,115 reaching a flop on one board), hole cards only of players the showdown lists as not mucked, every player pooled.

## What Was Measured

Offline replay of the root-cause report's PLO4/PLO5 cash state set (`plo-overfold/abl/states`, 4,661 postflop facing-bet states, 2 seeds, live switch rows of 2026-11-24 05:20Z): see `plo-lead6-01BNteGX/plo-pricing/BUILD.md` (heads-up and multiway fold % by street and size, before / after, every option alone and together). Law tests: `anOmahaFacingBetDefendsAtThePrice.law.test.ts`, `HorseOmahaFacingBetPriced.realHands.law.test.ts`, `anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`. Not measured: live rates, the league mirror and the human-calibrated league (cards `plo4_/plo5_omahaFlopRealizationIsPriced` in `HorseLeague.ts`).

## Replay

- Replay: NOT RUN (built 2026-11-24; the audited-set scorer was not run; offline league-state replay only)
