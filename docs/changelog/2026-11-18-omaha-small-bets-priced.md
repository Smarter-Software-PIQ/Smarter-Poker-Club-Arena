# Omaha small bets are priced, not filtered (omahaSmallBetIsPriced, default OFF)

PLO4/PLO5 cash, heads-up turn and river with nothing to call: with the option on, the Horse's check or bet is priced beside bets of 10%, 20% and 25% of the pot on the card-impact model, the opponent's response at each size shaped by the measured response of his kind (a person or a Horse) by pot share. The best small bet is played when it is worth more by 2% of the pot. Default OFF; no evaluation yet; nothing is switched on.

Files: `server/src/engine/HorseOmahaSmallBet.ts`, `HorseOmahaSmallBetConstants.ts`, `HorseOmahaSmallBet.test.ts`; additive lines in `HorseOmahaCardImpact.ts` (optional response curve; the keep formula exported unchanged), `HorseLogic.ts` (option, rule in the own-bet chain), `HorseDataLedger.ts`, `HorseOmahaRuleSites.ts`, `HorseReferenceDecisionSources.ts`, `benchmark/HorseLeague.ts`; generated switch lists.
