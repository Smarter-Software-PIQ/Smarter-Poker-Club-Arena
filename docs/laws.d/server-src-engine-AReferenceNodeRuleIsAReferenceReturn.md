# server/src/engine/AReferenceNodeRuleIsAReferenceReturn.law.test.ts

Every rule the reference node (HorseLogic.decide, graph.run('reference')) applies after a preflop route has returned is entered, in source order, in the law's ledger, and for each rule and each named route, over a grid of public states (stakes down to cents, 2 to 100 big blinds, every first-in seat, a jam into the big blind), whatever the rule turns a fold into while the route's own gates hold is admitted by referenceReturnShape, so a Horse that chose to play is never folded on the liveness fallback by the shape check.
