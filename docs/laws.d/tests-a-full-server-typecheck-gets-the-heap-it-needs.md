# tests/a-full-server-typecheck-gets-the-heap-it-needs.law.test.ts

A TypeScript program over all of `server/src` now peaks near Node's default heap
on the hosted runner. #12130 gave the type-aware engine promise lint 6 GB after
it ran out of memory, but the opponent-memory typecheck in the accounting shard
compiles the same program and was missed. From 2026-11-27 00:38Z it aborted with
"heap out of memory" on most runs, failing PRs that never touched the server.
Both full server typechecks in `ci.yml` now run with
`NODE_OPTIONS=--max-old-space-size=6144`, and the law requires it of every
workflow step that runs `tsc` from `server/` on a program including `src/**/*`.
