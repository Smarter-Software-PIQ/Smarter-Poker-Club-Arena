# 2026-11-05 - The defence-by-opener test reads a fixed hour, not the wall clock

Release run 42030755361 (12:52 UTC, commit 8715922322a2) failed shard 3/4 of "Test The Exact Engine Release Request" on two cases in server/src/engine/HorseDefenceByOpener.test.ts: the 6-handed cash big blind three-bet share came out 10.972850678733032 against a floor of 11, and the 6-handed tournament share came out 13.989441930618401 against a floor of 14. The same commit passed every shard at 10:58 UTC.

Cause: the test measured through HorseLogic.decide without decisionTimeMs, so the V9 hourly mood (moodOf in HorseLogic.ts, which hashes the horse id with the current UTC hour) read the wall clock. For the hero id def-2 the mood is 0.415 to 0.418 from 08:00 to 11:00 UTC on 2026-11-05 and falls to 0.091 at 12:00 UTC, where the hour number rolls over a multiple of ten. The lower mood scales bluffFreq down, which takes about 0.08 points off both three-bet shares. Neither the test's own seeded random number generator nor state leaking from other files was involved. Vitest runs each file in its own isolated fork, and the equity governor is already off under test.

Reproduction: with the measurement clock set to each hour of 2026-11-05, hours 00 to 11 UTC all pass with 11.048265460030166 and 14.102564102564102. Hours 12 to 23 all fail with exactly the CI numbers above.

Fix: #9529 (merged 14:12 UTC) pins decisionTimeMs to 2026-11-05 11:00 UTC inside defend(). Verified on main at 23122c8a19ae: three runs alone and three runs with every CPU core busy gave identical numbers to the last digit, all 19 tests passing. Release test shards on later main commits pass.

Note: the pinned hour leaves the 6-handed cash three-bet share 0.05 points above its floor of 11. Any change to the mood or defence logic that moves it will fail the test the same way on every run. It will no longer fail only at certain hours.
