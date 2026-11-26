# server/src/engine/anOpenerRecordReadIsFast.law.test.ts

Reading the opener's own record inside the out-of-position 3-bet rule (omahaOopReraiseRangeReadsOpenerRecord on PLO4/PLO5 at 100, 300 and 800 bb; holdemOopReraiseRangeReadsOpenerRecord on NLH), decided by the engine's own decide inside a HorseMind sandbox that carries the record, on spots where the receipt shows the record was read, costs at most 3 times the same decisions with the parent rule alone, measured in alternating rounds on the same machine (src/testing/relativeCost.ts).
