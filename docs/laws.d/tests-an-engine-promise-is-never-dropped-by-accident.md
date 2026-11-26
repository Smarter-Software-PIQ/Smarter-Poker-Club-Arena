# tests/an-engine-promise-is-never-dropped-by-accident.law.test.ts

The engine treats an unhandled rejection as fatal on purpose: it drains for a
supervisor restart, and every hand in flight on every table is voided. On
2026-11-26 a type-aware scan of `server/src` found 42 promises dropped without
a decision and one async request listener handed to a caller that ignores it.
All were safe that day, but nothing stopped the next one. Each is now marked
`void` or documented, `server/eslint.promises.config.mjs` turns on
no-floating-promises and no-misused-promises as errors, and CI runs it whenever
engine source changes. The law pins the config, the npm script, the CI step,
the fatal handler and the router's own catch.
