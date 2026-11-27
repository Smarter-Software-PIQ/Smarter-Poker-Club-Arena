# tests/a-full-server-typecheck-gets-the-heap-it-needs.law.test.ts

A TypeScript program over all of `server/src` now peaks near Node's default heap
on the hosted runner. #12130 gave the type-aware engine promise lint 6 GB after
it ran out of memory, but the opponent-memory typecheck in the accounting shard
compiles the same program and was missed. From 2026-11-27 00:38Z it aborted with
"heap out of memory" on most runs, failing PRs that never touched the server.
Both full server typechecks in `ci.yml` now run with
`NODE_OPTIONS=--max-old-space-size=6144`, and the law requires it of every
workflow step that runs `tsc` from `server/` on a program including `src/**/*`.

On 2026-11-27 the native fixture smoke's `npm run build --prefix server` (the
server build script, a full `tsc` on `server/tsconfig.json`) aborted the same way
on every PR built on main 84749b1c, where the server program measured 4,314 MB.
That step now carries the same 6144 MB, and the law also treats every step that
runs `npm run build --prefix server` or `npm --prefix server run build` from the
repo root as a full server typecheck, and asserts that it finds the native smoke one.
The engine release prequalification's plain `npm run build` from `server/` is
the same program and carries the same heap; the law finds and asserts both steps.
