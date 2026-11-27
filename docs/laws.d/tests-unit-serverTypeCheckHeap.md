# tests/unit/serverTypeCheckHeap.law.test.ts

The opponent-memory regression type-checks its own test and what it imports, never all of server/src: `server/tsconfig.opponent-memory.json` includes only `tests/HorseOpponentMemory.postgres.test.ts` and no `src` glob. On 2026-11-27 it included `src/**` (4,697 files, about 4.4 GB of type program), passed the CI runner's default Node heap and aborted "heap out of memory" in Accounting shard 2/7 on every pull request. The whole program is checked once, by the Server Engine type check.
