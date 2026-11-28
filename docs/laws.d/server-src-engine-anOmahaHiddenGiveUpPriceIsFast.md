# server/src/engine/anOmahaHiddenGiveUpPriceIsFast.law.test.ts

The give-up price (omahaHiddenBetsArePricedAsGiveUps) inside the PLO4/PLO5 facing-bet price, decided by the engine's own decide on real turn decisions where the option actually prices the decision, costs at most 4 times the same decisions with the option off, with telemetry off and on, measured in alternating rounds on the same machine (src/testing/relativeCost.ts). It is the option's entry in OPTION_COST_LAWS, so the option cost gate (aPricedOptionProvesItsDecisionCost) holds for it.
