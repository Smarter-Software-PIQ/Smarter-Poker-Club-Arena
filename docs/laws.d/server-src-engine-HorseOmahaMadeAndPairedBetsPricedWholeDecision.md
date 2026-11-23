# server/src/engine/HorseOmahaMadeAndPairedBetsPricedWholeDecision.law.test.ts

`omahaMadeAndPairedBetsArePricedOnHisResponse` (R5, default OFF) through whole PLO4 and PLO5 cash turn/river decisions: off fires no R5 receipt; on, the three HorseLogic call sites decide (a kept bet stays a bet, a checked bet becomes a check, one receipt per decision); a spot R5 cannot price is not decided by it: the rule returns null and the whole decision equals the option-off decision (the legacy bet-or-check path ran).
