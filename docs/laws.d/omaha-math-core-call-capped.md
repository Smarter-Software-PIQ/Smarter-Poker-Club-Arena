# server/src/engine/omahaMathCore/OmahaMathCoreCallCapped.law.test.ts

In PLO4 and PLO5, calling an opponent's wager (`call` at the root of `planValue` or `check-call` inside `checkEv`) sets `capped: true` on the next-street node so later streets take no unmeasured generic barrel fold credit against the aggressor or check-raiser; low-equity calls below price fold rather than fabricating positive EV from phantom turn/river bluffs, positive-equity calls still stand, and PLO6 remains untouched.
