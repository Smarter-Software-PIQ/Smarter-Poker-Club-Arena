# server/src/engine/HorseOmahaBigDrawEquitiesMemoIsResultIdentical.law.test.ts

The one-entry memo of the shared helper `omahaBigDrawEquities` changes no result: on 2,100 seeded random inputs (PLO4/PLO5/PLO6 hands, flop and turn, with and without dead cards and counts) a memo hit deep-equals a fresh deal, shares and counts, also after eviction; a hit deals nothing and returns copies.
