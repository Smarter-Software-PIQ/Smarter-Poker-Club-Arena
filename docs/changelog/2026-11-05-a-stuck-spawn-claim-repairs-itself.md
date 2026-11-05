# A Stuck Spawn Claim Repairs Itself

The scheduled spawner claims an occurrence's spawn key before it inserts the tournament. A spawn that died between the two left a claim with no tournament, and every later poll stood down on it, so that occurrence never existed. Six were on the board on 2026-11-05, including Saturday's 8:30 AM Midway Morning Free Buy.

The spawner's poll now sweeps claims older than ten minutes that still have no tournament, at most every ten minutes (`server/src/services/orphanSpawnClaims.ts`). A claim with exactly one tournament of its schedule created around it is linked to that tournament (only the back-link was lost); a claim with none is released so the next poll spawns the occurrence if it is still due; a claim with several is left alone and reported. Every write is conditional on `tournament_id` still being NULL. Law: `aStuckSpawnClaimRepairsItself.law.test.ts`.
