# 2026-11-08 - Forced Phases Keep Their Authority When An Owner Rule Speaks Last

## What happened

On 2026-11-07 the forced Horse Brain phases lost authority partway through the day, on both engine releases:

| Release | Phase | Withdrawn at (UTC) | Triggering decision |
|---|---|---|---|
| 40bc2467 | 13 (plo6 cash) | 16:48:37 | joint river bet 3.50 into 10.60, sized to 10.60 by the wager rules |
| 40bc2467 | 10 (plo4 cash) | 17:48:37 | pack river stab 4.32 into 4.32, checked by the wager rules |
| 40bc2467 | 13 (plo5 cash) | 17:50:37 | joint river bet 1.53 into 4.65, sized to 4.65 |
| 40bc2467 | 11 | 18:20:37 | not in the retained journal window; same receipt path |
| 391f7bc0 | 13 (plo6 cash) | 21:31:36 | joint river bet 3.50 into 7, sized to 7 |
| 391f7bc0 | 11 (plo5 cash) | 21:58:36 | pack river stab 5.41, checked |
| 391f7bc0 | 11 (plo6 cash) | 23:26:37 | pack river stab 18, checked |
| 391f7bc0 | 13 | 00:17:37 | same receipt path |
| 391f7bc0 | 10 (plo4 cash) | 00:57:38 | pack river stab 8.28, checked |

After each one, every later candidate of that phase (or variant) was withdrawn before acceptance for the rest of the boot: Phase 10 withdrew 129 selections on 40bc2467 and 107 on 391f7bc0.

In every case the horse decision journal's execution witness shows the controller executed exactly the decision it was given (`intended`). The candidate was legal. The `wager_rules` node (the owner rules: river paired-board check, full-pot nut wager, ...) runs after the Phase 10-13 receipts are finalized. It replaced the candidate, and the receipt still said `selected` with the pack's own bet. The table compared the honest execution against that stale receipt, called it `coerced`, and withdrew the whole phase gate for the process (the Phase 8 illegal-action law).

## Fix

- Root cause (`HorsePhaseControllerWithdrawal.ts`, `reconcileHorsePhaseReceipts`): after each later owner (the Phase 14 `corrective_policy` node, the `wager_rules` node, and the table door's `wager_rules_commit_correction`), every Phase 10-13 receipt records the action that actually leaves. A `selected` candidate that owner replaced becomes `shadow_change`, the existing `variant_utility_guard` vocabulary for "applied, but not the action leaving". Receipt: `phaseN_selection_superseded_by_<owner>`.
- Scoped disable (owner design change, 2026-11-07): a real controller coercion or fallback of a selected candidate now withdraws only its authority domain, `<variant>-<format>` (the Phase 14 domain key), on that gate (`HorsePhase8AuthorityGate.withdrawDomain`). Acceptance (`check(receipt, now, domain)`) and Phase 14's baseline-owner check read it. It holds until the next certified boot (a new gate), with no timer, no re-admission and no retry. Receipts kept: `phaseN_authority_controller_withdrawn`. New: `phaseN_authority_domain_withdrawn_<domain>` (first time per domain), and the loud `phaseN_selected_candidate_<coerced|fallback>` plus `reportError` (`horse_phaseN_selected_candidate_<status>`), because a selected candidate is now legal and owned by construction. A decision whose domain cannot be named fails closed and withdraws the whole gate (`phaseN_authority_domain_unknown_gate_withdrawn`).
- Phase 10 is cash only, so its domain is `plo4-cash`, the whole phase. For Phase 10 the protection is the root-cause fix.

## Tests

`server/src/engine/aForcedPhaseAuthorityIsWithdrawnOnlyWhereItFailed.law.test.ts`: the seven journal cases, the owned and shadow cases, the HorseLogic and table-door call positions, domain isolation, stickiness through refresh and worker restart until a new gate, the receipts, and the fail-closed unknown domain.
