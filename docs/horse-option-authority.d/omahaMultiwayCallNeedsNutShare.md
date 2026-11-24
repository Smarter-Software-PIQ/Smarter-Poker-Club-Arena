# omahaMultiwayCallNeedsNutShare: Authority For The Live Switch

Built 2026-11-24 by PLO-OWNER lead-6 (session 01BNteGX) from the PLO4/PLO5 over-fold root cause (plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4) and the multiway audit (multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Evidence NOT MET: the option is registered, default off (read `=== true`), and has offline replay and law-test evidence only. This file does not authorize switching the option on.

## What It Does

M2. Inside M1's joint sample and F3's field: a field player's holding inside its strength bin holds a flush draw (two board cards of a suit, a card to come) at the measured share of callers of that bin, and the share of the Horse's wins over the bettor lost to a better same-category hand of the field is measured into the price. An input to the price, never a rule of its own; a nut hand's share never falls.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em and every other game (byte-identical; `scripts/ops/horse-flag-off-check.sh origin/main HEAD` 0 differences with every new option off). No input reads whether an opponent is a person or a Horse, a user id, a name or another seat's cards (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`). Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the listed streets.

Tables: `server/src/engine/HorseOmahaFacingBetRangeTables.json` (v1-2026-11-24), fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17 06Z - Nov 24 07Z (232,468 hands read, 113,115 reaching a flop on one board), hole cards only of players the showdown lists as not mucked, every player pooled.

## What Was Measured

Offline replay of the root-cause report's PLO4/PLO5 cash state set (`plo-overfold/abl/states`, 4,661 postflop facing-bet states, 2 seeds, live switch rows of 2026-11-24 05:20Z): see `plo-lead6-01BNteGX/plo-pricing/BUILD.md` (heads-up and multiway fold % by street and size, before / after, every option alone and together). Law tests: `anOmahaFacingBetDefendsAtThePrice.law.test.ts`, `HorseOmahaFacingBetPriced.realHands.law.test.ts`, `anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`. Not measured: live rates, the league mirror and the human-calibrated league (cards `plo4_/plo5_omahaMultiwayCallNeedsNutShare` in `HorseLeague.ts`).

## Prior anchor

- Baseline: the same price as `omahaFacingBetFieldIsJoint`; this option only gives the field its measured flush-draw share by strength bin.
- Population weight: the measured flush-draw share of callers per bin, at full weight; it is an input to M1's price, not a rule.
- Own record: it reads no record; M1's bettor read is unchanged.
- No unshown cards: the tables are fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from `hand_history` hole cards only of players the showdown lists as not mucked; at decision time the option reads the public table state and the deciding Horse's own cards only (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`).

## Replay

- Replay: fixed 26; newlyWrong 83; changed 148; unchanged 3615; unjudged 39; set HVH48 B PLO4/PLO5 cash (memory off); scorer 5302af2ab3e; source placed verdict-only; arm m123 vs off; replayed 3763 of 3884
- Note (2026-11-24): arm m123 is omahaFacingBetFieldIsJoint + omahaMultiwayCallNeedsNutShare + omahaMultiwayValueBetIsPriced together. Per receipt: the facing-bet part (omaha_priced_facing_bet_joint_call) 34 changed / 26 fixed / 0 newly wrong; the multiway value bet (omaha_multiway_value_bet_priced_bet) 111 changed / 0 fixed / 81 newly wrong. Bar NOT met because of the value bet.
