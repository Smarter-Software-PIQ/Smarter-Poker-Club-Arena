# server/src/engine/anOmahaGiveUpIndifferenceCallIsFast.law.test.ts

The indifference call inside the give-up price (omahaGiveUpPricedTurnCallIsAtIndifference), decided by the engine's own decide on real turn decisions where the option actually decides the call, costs at most 3 times the same decisions with the option off, with telemetry off and on, measured in alternating rounds on the same machine (src/testing/relativeCost.ts). It is the option's entry in OPTION_COST_LAWS, so the option cost gate (aPricedOptionProvesItsDecisionCost) holds for it.
