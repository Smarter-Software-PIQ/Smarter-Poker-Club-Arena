# omahaFacingBetRangeIsMeasuredByLine: Authority For The Live Switch

Built 2026-11-24 by PLO-OWNER lead-6 (session 01BNteGX) from the PLO4/PLO5 over-fold root cause (plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4) and the multiway audit (multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Evidence NOT MET: the option is registered, default off (read `=== true`), and has offline replay and law-test evidence only. This file does not authorize switching the option on.

## What It Does

F1. PLO4/PLO5 cash (tables and Lightning), turn and river, inside `omahaFacingBetEv` (it acts only where that verdict decides; `HorseLogic.omahaFacingBetEvCount` -> `HorseOmahaFacingBetPriced.ts`).

The bettor's range is his MEASURED strength histogram (8 bins of the share of holdings of his size that beat his hand) for the street, line (the previous street's aggressor, any other first wager, a raise), size bucket and pot type (heads-up or multiway). Where his own shown record of the cell has at least 4 shown bets (`HorseOmahaBetRead` per-opponent cells, the same learner for every opponent), the cell's weak share is moved by his shown weak share against the population's (prior 8 shown bets). With no record, today's public read factor moves the table, as today. The Horse's share against every bin is an exact count (`omahaEvHandCounts`), so the price is exact; the turn keeps today's realization and caps. The per-street 0.8 / 0.9 narrowing and the fixed 13-19% river bluff share are not used. Receipts `omaha_priced_facing_bet_range_call` / `_fold`, `omaha_priced_facing_bet_changed`, `omaha_priced_facing_bet_record_read`.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em and every other game (byte-identical; `scripts/ops/horse-flag-off-check.sh origin/main HEAD` 0 differences with every new option off). No input reads whether an opponent is a person or a Horse, a user id, a name or another seat's cards (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`). Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the listed streets.

Tables: `server/src/engine/HorseOmahaFacingBetRangeTables.json` (v1-2026-11-24), fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17 06Z - Nov 24 07Z (232,468 hands read, 113,115 reaching a flop on one board), hole cards only of players the showdown lists as not mucked, every player pooled.

## What Was Measured

Offline replay of the root-cause report's PLO4/PLO5 cash state set (`plo-overfold/abl/states`, 4,661 postflop facing-bet states, 2 seeds, live switch rows of 2026-11-24 05:20Z): see `plo-lead6-01BNteGX/plo-pricing/BUILD.md` (heads-up and multiway fold % by street and size, before / after, every option alone and together). Law tests: `anOmahaFacingBetDefendsAtThePrice.law.test.ts`, `HorseOmahaFacingBetPriced.realHands.law.test.ts`, `anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`. Not measured: live rates, the league mirror and the human-calibrated league (cards `plo4_/plo5_omahaFacingBetRangeIsMeasuredByLine` in `HorseLeague.ts`).

## Replay

- Replay: NOT RUN (built 2026-11-24; the audited-set scorer was not run; offline league-state replay only)
