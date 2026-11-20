# 2026-11-18: omahaPricedInLightning (default OFF)

PLO Strategy lane. Answers the HORSE SWITCH lane finding of 2026-11-18T20:08:21Z: the priced PLO4/PLO5 options were gated out of Lightning by `omahaPricedInScope`, so a priced option switched on did nothing in the PLO5 1/2 Lightning pool while the categorical rules it replaces kept acting there.

- New scope option `omahaPricedInLightning` (HorseDecideOpts, ledger flag, live-switch registry, release default off; switch-list follow-up migration). On: `omahaPricedInScope` admits the Lightning pools, so each priced option whose own switch is on decides there; the two priced raise owners read their turn/river spot there through `omahaRaiseNeedsNutsScope(..., lightning)`. The categorical rule's scope is unchanged.
- Receipt validator: the priced raise -> call is admitted in Lightning only under the decision's own option (`omahaPricedInLightningGateCandidates`, `horseDecisionReceiptRefusalForGates` optional sixth argument; without it, exactly as before). The worker client and the offline ablation worker pass it.
- Receipt `omaha_priced_in_lightning_scope_seen` (once per decision).
- League: refused matchup `plo5_omaha_priced_in_lightning` (no Lightning domain); evaluation is the paired Lightning harness.
- Authority: docs/horse-option-authority.d/omahaPricedInLightning.md (Evidence NOT MET).
- Tests: server/src/engine/HorseOmahaPricedInLightning.test.ts.
