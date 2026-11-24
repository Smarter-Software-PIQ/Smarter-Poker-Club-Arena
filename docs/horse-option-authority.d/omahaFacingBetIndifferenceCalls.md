# omahaFacingBetIndifferenceCalls: Authority For The Live Switch

Built 2026-11-24 by PLO-OWNER lead-6 (session 01BNteGX) from the PLO4/PLO5 over-fold root cause (plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4) and the multiway audit (multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Evidence NOT MET: the option is registered, default off (read `=== true`), and has offline replay and law-test evidence only. This file does not authorize switching the option on.

## What It Does

F2. PLO4/PLO5 cash, every street where a verdict of this family decides (`omahaFacingBetEv`, `omahaFlopRealizationIsPriced`). The call is made at EV >= the estimate's own error: 0 for an exact count (today's turn and river verdict and F1), the sampling error for the joint sample (M1, F3), instead of EV > 2% of the final pot. Exact indifference calls; EV is still computed per hand. With F1 off it changes only ties and near-ties of today's verdict. Receipts `omaha_priced_facing_bet_margin_call` / `_fold`.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em and every other game (byte-identical; `scripts/ops/horse-flag-off-check.sh origin/main HEAD` 0 differences with every new option off). No input reads whether an opponent is a person or a Horse, a user id, a name or another seat's cards (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`). Scopable per game (`horse.omahaGameScope.<option>`); staged for shadow re-decision on the listed streets.

Tables: `server/src/engine/HorseOmahaFacingBetRangeTables.json` (v1-2026-11-24), fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from PLO4/PLO5 cash hand_history Nov 17 06Z - Nov 24 07Z (232,468 hands read, 113,115 reaching a flop on one board), hole cards only of players the showdown lists as not mucked, every player pooled.

## What Was Measured

Offline replay of the root-cause report's PLO4/PLO5 cash state set (`plo-overfold/abl/states`, 4,661 postflop facing-bet states, 2 seeds, live switch rows of 2026-11-24 05:20Z): see `plo-lead6-01BNteGX/plo-pricing/BUILD.md` (heads-up and multiway fold % by street and size, before / after, every option alone and together). Law tests: `anOmahaFacingBetDefendsAtThePrice.law.test.ts`, `HorseOmahaFacingBetPriced.realHands.law.test.ts`, `anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`. Not measured: live rates, the league mirror and the human-calibrated league (cards `plo4_/plo5_omahaFacingBetIndifferenceCalls` in `HorseLeague.ts`).

## Prior anchor

- Baseline: indifference: a call is made at EV >= the estimate's own error (0 for an exact count), not EV > 2% of the pot.
- Population weight: none of its own; it fits no population rate and only moves the call margin of the verdict it sits on (F1, M1, F3 or today's verdict), whose prior is anchored in that option's doc.
- Own record: it reads no record; the verdict's own read (F1 / F3 record shrink) is used unchanged.
- No unshown cards: the tables are fitted by `scripts/ops/omaha-facing-bet-range-fit.mjs` from `hand_history` hole cards only of players the showdown lists as not mucked; at decision time the option reads the public table state and the deciding Horse's own cards only (`anOmahaFacingBetPriceNeverKeysOnIdentity.law.test.ts`).

## Replay

- Replay: fixed 20; newlyWrong 8; changed 31; unchanged 3732; unjudged 3; set HVH48 B PLO4/PLO5 cash (memory off); scorer 5302af2ab3e; source placed verdict-only; arm f1f2f6 vs off; replayed 3763 of 3884
- Note (2026-11-24): arm f1f2f6 is omahaFacingBetRangeIsMeasuredByLine + omahaFacingBetIndifferenceCalls + omahaFacingBetMinimumDefencePrior together (they act inside one verdict); harness scripts/audited-node-option-replay.ts, seeds 1,7,42, opponent memory off. Bar fixed >= 2 x newly wrong: met (20 vs 8). Real-card EV grade not run (see omahaFlopRealizationIsPriced.md).
