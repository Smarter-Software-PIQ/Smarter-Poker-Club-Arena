# tests/client-lint-never-gets-worse.law.test.ts

Until 2026-11-26 no CI job linted the client; eslint ran only on staged files
at commit time, which a commit without hooks skips. That day `eslint src/`
reported 0 errors and 1,089 warnings (541 react-refresh, 362
react-hooks/exhaustive-deps, 186 unused variables).
`.github/workflows/client-lint-ratchet.yml` fails a pull request that changes
the client with any lint error or more warnings than its `MAX_WARNINGS`. The law
pins that the workflow lints all of `src` on every such pull request, that the
step cannot be made to pass regardless, and that the cap never rises above
1,089; it may only be lowered as warnings are fixed.
