# Horse Decision Readiness Qualification — Items 12, 21–26, 30–33

## Summary

Delivers deterministic, domain-bounded qualification modules and regression suites covering the Horse Decision Readiness Checklist (`FULL-HORSE-READINESS-PLAN.md`):

- **Items 22 & 31 (`server/src/engine/omaha/OmahaHiLoOutlook.ts` & `.test.ts`)**: Four-card PLO8 (Omaha Hi-Lo 8-or-better) exact two-hole / three-board low evaluation, counterfeit detection (unprotected A2 on 3-4-8 board when an Ace or Deuce hits vs. protected A25 backup wheel), low completion, and scoop vs. quarter risk classification.
- **Item 12 (`server/src/engine/HorseRareOpportunityMemory.ts` & `.test.ts`)**: Versioned (`v2`) opportunity-clocked rare-node memory with paired numerator/denominator opportunity decay, explicit wall-clock expiry, style-shift confidence dampening, and lossless `v1` transition compatibility.
- **Items 21 & 23 (`server/src/engine/HorseContinuationPlanInvalidation.ts` & `.test.ts`)**: Explicit continuation-plan contingency binding (`check`, `call`, `raise_small`, `raise_pot`, `barrel`) with deterministic invalidation across board texture shifts, opponent range narrowing, live contender multiway expansion, and effective exposure changes, plus accepted-wager-only effect commitment.
- **Item 25 (`server/src/engine/HorseDormantCandidateReadiness.test.ts`)**: Positive, negative, and boundary qualification across all seven dormant candidate skills (`comboDrawPressure`, `v54RiverBluff`, `riverPositionDefense`, `riverBluffCheckRaise`, `barrelContinuationOutlook`, `smallPotNearNutRiverValue`, `multiwayRiverBluffCheckRaise`), confirming `HorseFeatureAuthority` keeps all seven unselected (`enabled: false`) until paired Condition A / held-out registries are populated.
- **Items 24, 26 & 30 (`server/src/engine/HorsePhase24And26Readiness.test.ts`)**: Per-skill 15-phase activation matrix verification, Phase 7 allocated-key utility calibration, and tournament ICM / bubble / bounty risk separation from cash-chip EV.
- **Items 32 & 33 (`server/src/engine/HorseWholeHandLossAttribution.ts` & `.test.ts`)**: Whole-hand decision-sequence loss attribution separating positive-EV terminal river pot-odds calls from earlier street range/sizing/commitment errors without revealed-card hindsight bias.
