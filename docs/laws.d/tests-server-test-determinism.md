# tests/server-test-determinism.law.test.ts

`scripts/ci/check-server-test-determinism.mjs` runs in `.github/workflows/ci.yml`'s required `Invariant guards (parallel)` step and refuses unpinned `Date.now()` or `Math.random()` calls in `server/src` test files against a strict closed ratchet baseline (`scripts/ci/server-test-determinism-baseline.json`), preventing runner-timing and random-draw flakes from merging.
