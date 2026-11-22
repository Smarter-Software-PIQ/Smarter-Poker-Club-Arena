# server/src/benchmark/HoldemBlanketOffDevCards.law.test.ts

The six Hold'em blanket-off development league cards (cash6 and hu for v80TopPairStrongKicker, v79TopPairWeakKicker, and v68TurnAirDrawCalls) live in DEVELOPMENT_LEAGUE_CARDS, resolve by exact name for on-demand grade runs, never appear in LEAGUE_MATCHUPS or UNMEASURABLE_MATCHUPS, differ between arms in exactly their single blanket option, and route OFF decisions cleanly to V38 priced logic while keeping HU tables inert for v79 and v80.
