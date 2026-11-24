# omahaMultiwayValueBetIsPriced: Authority For The Live Switch

**NOT READY: real-card replay 0/81.** On the audited HVH48 B PLO4/PLO5 cash decisions the priced multiway value bet changed 111 decisions, 0 fixed and 81 newly wrong (receipt `omaha_multiway_value_bet_priced_bet`; scorer 5302af2ab3e, 2026-11-24). It stays registered and default OFF, must not be shadowed or switched on, and is not tuned in this build. No other option reads it or depends on it: its only sites are its own hook in `HorseLogic` (`omahaOwnerRuledFinal`), its registration (option switch, game scope, shadow stage, rule basis and sites, data ledger) and the league cards that measure it.

Built 2026-11-24 by PLO-OWNER lead-6 (session 01BNteGX) from the PLO4/PLO5 over-fold root cause (plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4) and the multiway audit (multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Evidence NOT MET: the option is registered, default off (read `=== true`), and has offline replay and law-test evidence only. This file does not authorize switching the option on.

## What It Does

M3. PLO4/PLO5 cash, flop/turn/river, nothing to call, two to four live opponents, the chain's final check (`omahaOwnerRuledFinal`, the same place as `omahaMultiwayCheckedToBetRule`; owner-ruled checks below still stand). The best of a third, a half and three quarters of the pot replaces the check where the hand is a VALUE bet (its showdown share against one caller's measured calling range is at least one half; this option never bluffs) and EV(bet) - EV(check) > 2% of the pot: EV(check) = the showdown share against the whole field x pot; EV(bet) = P(all fold) x pot + sum over j callers of P(j) x (share against j measured calling ranges x (pot + (j + 1) bet) - bet), with P(all fold) the measured share of multiway first wagers of the size every player folded to (`HorseOmahaMultiwayValueBet.ts`). Raises over the bet and later streets are not priced. It never turns a bet into a check. Receipts `omaha_multiway_value_bet_priced_bet`, `omaha_multiway_value_bet_check_kept`.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em and every other game (byte-identical; `scripts/ops/horse-flag-off-check.sh origin/main HEAD` 0 differences with every new option off). No input reads whether an opponent is a person or a Horse, a user id, a name or another seat's cards (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`). Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the listed streets.

Tables: `server/src/engine/HorseOmahaFacingBetRangeTables.json` (v1-2026-11-24), fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17 06Z - Nov 24 07Z (232,468 hands read, 113,115 reaching a flop on one board), hole cards only of players the showdown lists as not mucked, every player pooled.

## What Was Measured

Offline replay of the root-cause report's PLO4/PLO5 cash state set (`plo-overfold/abl/states`, 4,661 postflop facing-bet states, 2 seeds, live switch rows of 2026-11-24 05:20Z): see `plo-lead6-01BNteGX/plo-pricing/BUILD.md` (heads-up and multiway fold % by street and size, before / after, every option alone and together). Law tests: `anOmahaFacingBetDefendsAtThePrice.law.test.ts`, `HorseOmahaFacingBetPriced.realHands.law.test.ts`, `anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`. Not measured: live rates, the league mirror and the human-calibrated league (cards `plo4_/plo5_omahaMultiwayValueBetIsPriced` in `HorseLeague.ts`).

## Replay

- Replay: fixed 26; newlyWrong 83; changed 148; unchanged 3615; unjudged 39; set HVH48 B PLO4/PLO5 cash (memory off); scorer 5302af2ab3e; source placed verdict-only; arm m123 vs off; replayed 3763 of 3884
- Note (2026-11-24): arm m123 is omahaFacingBetFieldIsJoint + omahaMultiwayCallNeedsNutShare + omahaMultiwayValueBetIsPriced together. Per receipt: the facing-bet part (omaha_priced_facing_bet_joint_call) 34 changed / 26 fixed / 0 newly wrong; the multiway value bet (omaha_multiway_value_bet_priced_bet) 111 changed / 0 fixed / 81 newly wrong. Bar NOT met because of the value bet.
