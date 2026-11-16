# Live style engagement receipts: an ON style option is counted when it applies, Lightning apart (2026-11-15)

The seven Hold'em style options are ON through the live switch. Only an option in shadow recorded that it engaged, so the worker had no engagement count for the options that are actually on to set beside the shadow one. The shadow receipt also counts Lightning (a cash speed) under `c` with Classic cash.

Telemetry only. Nothing re-decides because of an ON option, and the committed decision (action, amount, RNG position) and every brain receipt are unchanged.

- **ON engagement.** Every consumer site that records a shadow engagement now also records an ON engagement (`noteStyleEngaged(option, confidence, 'on')`, a separate record) where the ON arm applies its adjustment, under the same non-neutral condition. The shadow record, the shadow re-decision and the shadow receipt are unchanged.
- **What is counted.** `style_engaged_<opt>_<c|t|l>_seen` fires once per engaged ON option per decision, after the committed result is sent. `opt` is one of vb bb rr tr fr ve fb, and the format is `t` for a tournament, `l` when `publicMemoryDomain.speed` is `lightning`, and `c` otherwise (Classic cash). There are 7 x 3 = 21 keys. Ledger row `style_engaged_*`.
- **Cleared each decision.** Each style-active decision clears the record before it decides. So whatever a later shadow re-decision records for an ON option is never counted for the next decision.
- **Not in this change.** There is no live counterfactual: no re-decision with an ON option OFF, no `style_live_*` receipt and no arm `l`. Hold'em Strategy's R1 work keeps the counterfactual, so a decision never gets two re-decisions. The shadow receipt keeps its `c|t` format and its `s|c` arm.

Tests:

- `HorseStyleShadow.liveReceipts.test.ts` covers the format and the 21 keys. It runs the pinned style contexts through the real brain: every applied receipt has its option in the live record, shadow and off record nothing there, and the decision is the same whether the live record is empty or full.
- `workerRuntime.test.ts` adds a "live style engagement receipts in the live worker" block. It covers Lightning `l`, Classic `c`, tournament `t`, and an identical committed result and RNG with and without recording. It also checks that nothing re-decides because of an ON option, that the shadow arm is unchanged, and that the next decision clears what a shadow re-decision records.
