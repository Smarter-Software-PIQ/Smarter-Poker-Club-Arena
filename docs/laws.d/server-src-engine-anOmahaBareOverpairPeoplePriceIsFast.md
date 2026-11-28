# server/src/engine/anOmahaBareOverpairPeoplePriceIsFast.law.test.ts

The people-priced bare-overpair flop continuation (omahaBareOverpairContinuationIsPeoplePriced), decided by the engine's own decide on the audited flop decisions where the option actually prices the continuation, costs at most 4 times the same decisions with the option off, with telemetry off and on, measured in alternating rounds on the same machine (src/testing/relativeCost.ts). It is the option's entry in OPTION_COST_LAWS, so the option cost gate (aPricedOptionProvesItsDecisionCost) holds for it.
