# 2026-11-19: omahaSlowplayMixInLightning, omahaPublicBetSizeInLightning (both default OFF)

PLO Strategy lane. Stacks on omahaPricedInLightning (#11380). The measured winning human plays the Lightning pools, and two more PLO4/PLO5 cash rules were gated out of Lightning by a speed test (lightning-013U37/CHECKPOINT.md, "Lightning scope resolution"). Each gets its own scope option so each can be evaluated alone. Both are NOT EVALUATED.

- `omahaSlowplayMixInLightning`: the game of `omahaStrongHandSlowplayMix` (HorseOmahaStrongHandSlowplayMix.ts inGame) includes the Lightning pools. The mix acts there only when its own switch is on.
  - Receipt validator: the mix's raise -> call and flop bet -> check are admitted in a Lightning pool only under the decision's own option (`omahaSlowplayMixInLightningGateCandidates`; `horseDecisionReceiptRefusalForGates` optional seventh argument; without it, exactly as before). The worker client and the offline ablation worker pass it.
  - Receipt `omaha_slowplay_mix_in_lightning_scope_seen` (once per decision).
- `omahaPublicBetSizeInLightning`: the game of `omahaBetSizeByPublicState` (HorseLogic.publicBetSizeInGame) includes the Lightning pools. The public size acts there only when its own switch is on. No validator change (a bet, a raise or the legalizer's all-in is admitted at any speed).
  - Receipt `omaha_public_bet_size_in_lightning_scope_seen` (once per decision).
- The third gated scope, the re-raised lane (`omahaReraisedLaneUntouched`), already has its option on main: `omahaReraisedPositionInLightning` (Lightning parity lane, 2026-11-18). Not duplicated.
- Registration for both: HorseDecideOpts, ledger flag and receipt, live-switch registry (release default off), HorseOmahaRuleSites class, refused league matchups `plo5_omaha_slowplay_mix_in_lightning` and `plo5_omaha_public_bet_size_in_lightning` (no Lightning domain in the league; not run), authority files docs/horse-option-authority.d/omahaSlowplayMixInLightning.md and omahaPublicBetSizeInLightning.md.
- Off or unset: byte-identical. Tests: server/src/engine/HorseOmahaScopesInLightning.test.ts.
- Not in this change: the switch-list migration and the CI evidence script list (the lane lead generates both from the registry).
