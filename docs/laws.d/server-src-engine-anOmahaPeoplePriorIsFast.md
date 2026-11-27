# server/src/engine/anOmahaPeoplePriorIsFast.law.test.ts

The people-measured bettor prior (omahaFacingBetPriorIsPeopleMeasured) inside the PLO4/PLO5 heads-up facing-bet price, decided by the engine's own decide on the committed real facing-bet states where the option actually prices the decision, costs at most 4 times the same decisions with the option off, with telemetry off and on, measured in alternating rounds on the same machine (src/testing/relativeCost.ts). It is the option's entry in OPTION_COST_LAWS, so the option cost gate (aPricedOptionProvesItsDecisionCost) holds for it.
