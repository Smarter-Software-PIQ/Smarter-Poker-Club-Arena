# The live memory alarms match the owner ceiling, and the V31 evaluation store is bounded

Date: 2026-11-05

## What happened

On 2026-11-05 at 14:44 Chicago, Dan raised the Phase 1 engine RSS ceiling to
12288 MB and required RSS to level off. That decision was recorded in the
release gate (`scripts/ci/verify-engine-release-bundle.mjs`) and nowhere else.
The two live alarms that watch the same number were still sitting at the old
8192 MB line:

- the engine memory governor (`server/src/observability/memoryGovernor.ts`)
  fell back to 6144 MB soft and 8192 MB hard when `MEMORY_LIMIT_MB` is unset,
  which is how production runs;
- the Prometheus rule `EngineProcessMemoryHigh`
  (`infra/monitoring/alert-rules.yml`) fired when whole-process RSS stayed
  above 8 GiB for fifteen minutes.

The measured steady state on the current engine is 8.85 to 10.3 GB
whole-process RSS. So the governor reported a hard crossing on every boot, the
alarm fired continuously on nothing, and a real growth event would have looked
exactly like a quiet day.

## Cause

Only the release gate was raised. The 8 GiB line was set on 2026-10-19 for a
4.85 to 6.82 GiB hourly band measured before the eight horse decision workers'
bounded observer memory existed. Those workers, the equity workers and the
journal writers are `worker_threads` inside the one engine process, so the
whole-process RSS figure every alarm samples already includes them. Once they
were in the process the old line could not be met at any uptime.

Separately, `GtoPostflopV31.ts` kept one evaluation store per sealed candidate
dataset checksum and never evicted any of them outside the test seam. Every
other horse cache in the engine is bounded by entry count; this one was not.

## Fix

- The governor's fallback hard ceiling is 12288 MB and its fallback soft
  ceiling is 9830 MB (80 percent, the same ratio `MEMORY_LIMIT_MB` already
  uses). The header comment cites the owner decision and date and states that
  RSS is whole-process, so the horse decision workers, equity workers and
  journal writers are counted. The soft and hard ratios, the release ratio,
  the consecutive-sample rule, the mode policy and the uptime guard are
  unchanged: observe mode still never holds a table, trims the journal or
  hands off.
- `EngineProcessMemoryHigh` fires above 12884901888 bytes (12 GiB) for fifteen
  minutes, with the same labels. The comment, summary and description carry
  the owner decision and the measured band. The promtool test that pins the
  rule's text now proves 10.3 GB stays quiet and 13 GiB fires, and the
  engine-memory runbook describes the new line.
- `GTO_V31_EVALUATION_STORE_MAX = 4`: the evaluation store map keeps the four
  most recently loaded candidate datasets. Loading a fifth evicts the least
  recently loaded one; re-loading an existing checksum moves it to most
  recent. The active store is a separate object and is never touched. A
  vitest case proves the bound and the untouched active store.

## Verified

- `npx tsc --noEmit -p .` in `server/`.
- `npx vitest run src/observability/memoryGovernor.test.ts src/engine/GtoPostflopV31.test.ts` in `server/`.
- The promtool rule test runs through `scripts/ci/test-fleet-throughput.sh`
  in CI (it needs the pinned Prometheus container).
