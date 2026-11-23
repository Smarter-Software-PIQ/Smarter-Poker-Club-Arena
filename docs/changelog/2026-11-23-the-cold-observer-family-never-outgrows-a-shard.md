# 2026-11-23: The cold observer family never outgrows a CSS Beat shard

## What broke

During #11804 (and latently on `main` whenever any PR shifted CSS Beat test counts), `CSS Beat general shard 7/10` received **zero tests** and failed `scripts/ci/playwright-flaky-summary.mjs` with `Error: the report lists no tests`.

## Root cause

Playwright's `--shard=k/10` treats each top-level `test.describe` with `test.describe.configure({ mode: 'default' })` as an indivisible unit. `cold observer and phone geometry` in `tests/e2e/table-proportions.spec.ts` wrapped **69 tests** inside a single top-level `mode: 'default'` block while the 10 general CSS Beat shards averaged ~67.4 tests each. Because that single block was larger than an entire shard, any boundary alignment that placed it across a shard cut starved the adjacent shard to 0 tests.

## Permanent source fix and hardening

- Split `cold observer and phone geometry` into five self-contained, bounded top-level `test.describe` blocks, each retaining `test.describe.configure({ mode: 'default' })` and every original test, assertion, and timeout unchanged:
  1. `cold observer canvases (2-9 seats)` (16 tests)
  2. `cold phone captions, bubbles and notice containment` (19 tests)
  3. `cold phone paint coverage, crowns and motion` (6 tests)
  4. `observer avatar artwork allocations` (15 tests)
  5. `cold scaled phone full ring and dealer geometry` (13 tests)
- Added `tests/no-css-beat-shard-is-ever-empty.law.test.ts` (registered in `docs/laws.d/tests-no-css-beat-shard-is-ever-empty.md`) so no future change can merge multiple cold families back into a single monolithic default-mode group, while keeping the empty-report guard in `scripts/ci/playwright-flaky-summary.mjs` intact.
