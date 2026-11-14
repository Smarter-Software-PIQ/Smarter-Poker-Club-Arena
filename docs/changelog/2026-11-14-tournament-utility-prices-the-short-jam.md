# The tournament utility prices the short stack's shove in pot limit and fixed limit

Reported 2026-11-14 by the Feature Activation lane's decision spot matrix (seeds plo4 1663882339, plo6 1264265673, plo8 2568337932, flo8 2269140658, flh 530853016 and 547630635).

In a pot-limit or fixed-limit tournament, a Horse with more than the call and less than the minimum bet or raise holds a menu with the all-in button and no sized wager (minRaiseTo and maxRaiseTo are null). The controller executes that button as a wager of the whole stack. `buildTournamentActionCandidates` built a pot-limit or fixed-limit jam only against a numeric ceiling, so the shove was missing from the candidates, and when the reference decision was that `all_in` the tournament utility refused the decision as `baseline_not_modeled`. The shove was played, legally, but upgrade 07 did not price the decision that put the tournament life at stake. No-limit built the jam and was priced.

The menu alone cannot say what the button does: fixed limit shows the same menu on a capped street and to a seat that may not reopen, where the button is a call. So the utility input carries one new optional fact, `shortAllInWagers`, and `HorseLogic.phase7ShortAllInWagers` sets it from the controller's own rule: in pot limit the button without a sized wager is always the whole stack (an all-in above the pot cap is only advertised as a legal raise to the cap, which puts the sized wager on the menu); in fixed limit the street is not capped and the whole stack reaches no further than the standing bet plus the street's legal increment (the first test of `HandController.clampToStructure`). When it is set the builder adds the jam at the whole stack. The fact is committed in the utility input hash only when it is set, so every other input keeps its commitment.

The shove is priced by the model no-limit already uses for it: each live opponent may call or fold, never re-raise, and folds at a rate set by the price of the extra chips it must pay (`mdfFold`: the raise over the contestable pot), so a small over-call shove carries almost no fold equity. No fold equity is assumed from a full raise the hero cannot make.

## What can change, and what cannot (added after the review of b07e5885)

The fact is set only when the reference decision is that shove (`decision.action === 'all_in' && phase7ShortAllInWagers(...)` in `buildPhase7UtilityInput`). The first version set it on every short menu. A jam beside a reference fold or call is a near twin of the call (identical when nobody can pay the extra chips), the two overlap in the arbiter's uncertainty gate, and a reference fold the utility had replaced by a call went back to a fold: the review measured 17 such pot-limit decisions. That side effect is removed.

Can change, in pot-limit (PLO4, PLO5, PLO6, PLO8) and fixed-limit (FLH, FLO8) tournaments, with no option gating it: a reference `all_in` on the short menu, refused until now as `baseline_not_modeled` and therefore always played, is now priced, so the utility may replace it (by a fold, or by a call) where its own gate says the other action is clearly better. Its receipt and telemetry change from the refusal to a priced ledger, and its utility input hash differs from a recorded one because it now carries the fact.

Cannot change: any decision whose reference action is not `all_in` (the input is byte for byte the one built before, no fact, no jam); no-limit (the helper answers false first, and no-limit already built its jam); every menu with a ceiling; cash games (the tournament utility runs in tournaments only).

Measured on real controller menus (`HorseTournamentUtilityShortJam.test.ts`, 150 short menus for each of plo4, plo5, plo6, plo8, flh, flo8, two payout structures, 1,800 decisions): 1,661 decisions with a reference other than `all_in`, every one identical in action, amount, refusal and utility receipt to a run with the fact forced off, 7 of them utility overrides that are all kept (6 would have been cancelled by the first version); 139 reference all-ins, all 139 refused before and priced now, 0 replaced by the utility, 0 with a different final action. A replacement is possible in principle and was not seen.

Phase 13: the joint owners call the builder without the fact, so the joint proposal is unchanged. The Phase 7 owner that judges that proposal in a tournament (`buildPhase7UtilityInput` on the Phase 13 path, acting only in candidate mode) uses the same rule: it sees the fact only when the proposal it is given is itself the `all_in`, which the joint owner cannot newly propose on this menu because its own candidates hold no jam. The variant owners' shadow evaluation reuses the main input and so carries the fact only when the main reference is the shove.

## Receipts (added on the sign-off of c7c52fe3)

A replaced reference shove is a live decision change, so it is countable per variant after release. The existing `phase7_utility_override` carries neither the variant nor the reference action, and telemetry rows have no variant column, so two occurrence counters are added, registered in `HorseDataLedger.ts` as the family `phase7_short_shove_*`:

- `phase7_short_shove_priced_<variant>_seen`: a reference `all_in` on the short menu was priced (fires with `phase7_tournament_utility`, only when the input carries `shortAllInWagers`).
- `phase7_short_shove_replaced_<variant>_seen`: the utility selected another action for it and that action was committed, by the Phase 7 owner or by the Phase 7 owner on the Phase 13 candidate path.

Replaced over priced is the replacement rate of a variant. No other telemetry or ledger string is added or renamed. No threshold or tuning constant is added: when a priced shove becomes a fold is decided by the existing utility model and the existing arbiter gate (the selected action's lower bound must clear every other candidate's upper bound, at `CONFIDENCE_Z_999`).

Not changed here, and still refused as `baseline_not_modeled`: a fixed-limit reference decision of `all_in` on a capped street or from a seat that may not reopen, where the button executes as a call.

Tests: `server/src/engine/HorseTournamentUtilityShortJam.test.ts` (33). The six reported seeds live in the Feature Activation law, which is on no shared ref; they are covered here by equivalents on real controller menus, not replayed. The Feature Activation law `HorseDecisionSpotMatrix.law.test.ts` pins the refusal by name and goes red on this change by design; its last block is to be replaced by the plain rule (every tournament decision of that spot is priced). Whichever of the two merges second must carry that update.
