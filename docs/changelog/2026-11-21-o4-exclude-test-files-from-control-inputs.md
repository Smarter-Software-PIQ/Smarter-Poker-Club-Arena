# 2026-11-21: exclude pure test files from CONTROL_INPUTS projection

## Root cause

`scripts/ci/read-engine-prequalification.py` computes `projection(sha)` via
`git ls-tree -r` across `CONTROL_INPUTS`, which includes the directories
`server/src/maintenance` and `server/scripts`. On 2026-11-22 at `01:07:44Z`,
merging PR `#11676` (H10) added `server/src/maintenance/frozenDiscoverySweeps.test.ts`
and updated `server/src/maintenance/theFreezeIsTotal.law.test.ts` without
modifying any production maintenance module or release script. Because raw
`git ls-tree -r` hashed those test files alongside production code,
`read-engine-prequalification.py` exited with RC=3
(`qualification inputs differ from selected control`) and falsely disqualified
the already-prequalified/certified candidate.

## Fix

- Preserved every entry in `CONTROL_INPUTS` unchanged, including
  `scripts/ci/recorded-migrations.manifest.json`, `server/scripts`,
  `server/src/maintenance`, and all four release workflows.
- Added strict tab-field path filtering (`_filter_projection_tree` and
  `_is_pure_test_control_path`) in `projection()` (also inherited by
  `backup_projection()`) to exclude only pure unit/law test files
  (`*.test.ts`, `*.law.test.ts`, `*.spec.ts`, `*.test.py`, `*.test.mjs`,
  `*.test.js`, `*.test.cjs`, and `test_*.py`) under `server/src/maintenance/`
  and `server/scripts/`.
- Failed closed on lines without a tab separator and on all paths outside
  `server/src/maintenance/` and `server/scripts/`.
- Kept all production files under `server/src/maintenance/`, all runtime and
  release scripts under `server/scripts/`, `scripts/ci/recorded-migrations.manifest.json`,
  all workflows, `server/standby`, and `supabase/migrations` 100% hashed.

## Verification

- Added regression tests in `tests/operations/engine-prequalification.test.py`
  proving pure test edits under `server/src/maintenance/` and `server/scripts/`
  leave `projection()`, `projection(release_authority=True)`, and
  `backup_projection()` byte-for-byte identical, while edits to production
  maintenance files, release scripts, or
  `scripts/ci/recorded-migrations.manifest.json` continue to invalidate
  projections and refuse mismatched controls.
