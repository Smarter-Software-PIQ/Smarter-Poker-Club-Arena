# server/src/engine/HorseOopReraiseRangeReadsOpenerRecord.law.test.ts

With `holdem/omahaOopReraiseRangeReadsOpenerRecord`, the out-of-position 3-bet rule binds in proportion to this opener's own record of 4-betting a 3-bet. The law holds four things on 400 seeded heads-up NLH deals:

- **No record:** every verdict is exactly the verdict without the option.
- **An opener who 4-bets at or above the 0.10 baseline:** the guard binds in full, and no 3-bet stands through the record.
- **An opener who never 4-bets:** the 3-bets the rule rejected stand at the seeded frequency 1 - w, and the record is on the receipt.
- **The rule only removes:** it never adds a raise.
