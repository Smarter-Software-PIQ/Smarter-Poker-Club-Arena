# server/src/engine/anOmahaFacingBetPriceIsFast.law.test.ts

The corrected PLO4/PLO5 facing-bet price (omahaFacingBetRangeIsMeasuredByLine, omahaFacingBetIndifferenceCalls, omahaFacingBetMinimumDefencePrior heads-up; with omahaFacingBetFieldIsJoint and omahaMultiwayCallNeedsNutShare three-way), decided by the engine's own decide on the committed real facing-bet states, costs at most 8 times the same decisions with the options off, measured in alternating rounds on the same machine (src/testing/relativeCost.ts).
