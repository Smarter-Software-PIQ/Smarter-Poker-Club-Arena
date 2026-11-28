# omahaFacingBetFieldIsJoint: Authority For The Live Switch

Built 2026-11-24 by PLO-OWNER lead-6 (session 01BNteGX) from the PLO4/PLO5 over-fold root cause (plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4) and the multiway audit (multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Evidence NOT MET: reads the pooled every-player table (owner order Nov 26: people only); superseded by omahaMultiwayFieldIsPeopleMeasured (#12164; with the multiway turn cells of omahaTurnFacingBetPriorIsLineSplit #12239). The option is registered, default off (read `=== true`), and has offline replay and law-test evidence only. This file does not authorize switching the option on.

## What It Does

M1. PLO4/PLO5 cash, turn and river, inside `omahaFacingBetEv`, another player in the hand. The bettor (his measured range for a bet into several players), every caller and earlier all-in (the measured calling range of a multiway first wager of the size) and every player still to act (present at the measured multiway continue rate, his call added to the pot) are dealt on the same cards over every river card on the turn (`HorseOmahaPricedJointSample.ts`); EV = realization x pot share x (pot + calls) - call. Heads-up spots are untouched. Receipts `omaha_priced_facing_bet_joint_call` / `_fold`.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em and every other game (byte-identical; `scripts/ops/horse-flag-off-check.sh origin/main HEAD` 0 differences with every new option off). No input reads whether an opponent is a person or a Horse, a user id, a name or another seat's cards (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`). Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the listed streets.

Tables: `server/src/engine/HorseOmahaFacingBetRangeTables.json` (v1-2026-11-24), fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17 06Z - Nov 24 07Z (232,468 hands read, 113,115 reaching a flop on one board), hole cards only of players the showdown lists as not mucked, every player pooled.

## What Was Measured

Offline replay of the root-cause report's PLO4/PLO5 cash state set (`plo-overfold/abl/states`, 4,661 postflop facing-bet states, 2 seeds, live switch rows of 2026-11-24 05:20Z): see `plo-lead6-01BNteGX/plo-pricing/BUILD.md` (heads-up and multiway fold % by street and size, before / after, every option alone and together). Law tests: `anOmahaFacingBetDefendsAtThePrice.law.test.ts`, `HorseOmahaFacingBetPriced.realHands.law.test.ts`, `anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`. Not measured: live rates, the league mirror and the human-calibrated league (cards `plo4_/plo5_omahaFacingBetFieldIsJoint` in `HorseLeague.ts`).

## Prior anchor

- Baseline: the price toCall / (pot + toCall) against the bettor and the field dealt jointly; the shared multiway defence obligation is lower than heads-up and is not a law target.
- Population weight: the bettor's multiway range and the callers' measured calling ranges (showdown-bias corrected: callers who fold later or muck are moved to the weak bins) and continue rates, at full weight; F6 bounds the bettor's no-record prior when it is on.
- Own record: the bettor's own shown record of the cell (`HorseOmahaBetRead`, from 4 shown bets) replaces the table's weak share through a Beta-binomial shrink with 8 prior bets (`OMAHA_MEASURED_RECORD_PRIOR`), so it dominates once it has a real sample; a record is never bounded by F6.
- No unshown cards: the tables are fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from `hand_history` hole cards only of players the showdown lists as not mucked; at decision time the option reads the public table state and the deciding Horse's own cards only (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`).

## Replay

- Replay: fixed 26; newlyWrong 8; changed 50; unchanged 3713; unjudged 16; set HVH48 B PLO4/PLO5 cash (memory off); scorer 5302af2ab3e; source placed verdict-only; arm m123 vs off; replayed 3763 of 3884
- Note (2026-11-24, after the M3 rebuild v2): arm m123 is omahaFacingBetFieldIsJoint + omahaMultiwayCallNeedsNutShare + omahaMultiwayValueBetIsPriced together. Per receipt: omaha_priced_facing_bet_joint_call 34 changed / 26 fixed / 0 newly wrong; omaha_priced_facing_bet_joint_fold 3 / 0 / 2; ft_semibluff_raise_skip_multiway 11 / 11 / 0; the rebuilt multiway value bet (omaha_multiway_value_bet_priced_bet) 13 / 0 / 6 (verdict-only counts every bet that replaces an audited-OK check as newly wrong; its real-card grade is in omahaMultiwayValueBetIsPriced.md). Bar fixed >= 2 x newly wrong: met (26 / 8). The earlier row (M3 v1: 26 fixed / 83 newly wrong, 111 value bets / 0 / 81) is superseded.
