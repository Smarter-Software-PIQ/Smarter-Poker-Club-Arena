# tests/the-pull-request-builds-what-ships.law.test.ts

Every command the engine release prequalification's "Compile and test the exact server tree" step runs (except `npm ci`) is also run from server/ by the required `Server Engine` job on pull requests, `npm run build` with at least the same Node heap, and the test shard split is identical, so a commit cannot reach main and only then fail the build that decides whether it can ship. The failure of 2026-11-27: four merged commits failed prequalification with "heap out of memory" in `npm run build` and the 07:00 Chicago cycle kept serving.
