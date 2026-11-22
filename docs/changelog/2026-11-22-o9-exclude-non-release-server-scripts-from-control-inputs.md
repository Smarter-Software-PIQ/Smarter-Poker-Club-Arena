# 2026-11-22: exclude verified non-release offline scripts under server/scripts from CONTROL_INPUTS projection (O9)

## Root cause

`scripts/ci/read-engine-prequalification.py` computes `projection(sha)` via
`git ls-tree -r` across `CONTROL_INPUTS`, which includes `server/scripts`.
Twice on 2026-11-22 (at `11:34Z` and `14:16Z`), merges editing offline HUD
backfill scripts (`server/scripts/opponent-hud-build.ts`,
`opponent-hud-asof.ts`, `opponent-hud-dump.ts`) caused `projection()` to
diverge and falsely disqualified already-certified engine candidates with
`RC=3` (`qualification inputs differ from selected control`), even though no
release workflow, `server/Dockerfile`, `server/standby/**`, CI selector, or
engine release script references those offline scripts.

## Fix

- Kept `"server/scripts"` in `CONTROL_INPUTS` and preserved exact top-level
  literal constants `CONTROL_INPUTS`, `CONTROL_INPUT_TEST_EXCLUDED_DIRS`, and
  `PURE_TEST_FILE_SUFFIXES` (full AST-parsing compatibility with
  `scripts/ci/backup-freeze-baseline.py`), so any new or unknown script added
  under `server/scripts/` fails closed and remains hashed.
- Added top-level literal tuple constants `NON_RELEASE_SERVER_SCRIPT_PREFIXES`
  and `NON_RELEASE_SERVER_SCRIPT_EXACT` plus
  `_is_non_release_server_script_path(path)` in
  `scripts/ci/read-engine-prequalification.py`, invoked by
  `_filter_projection_tree` (used by `projection()` and inherited by
  `backup_projection()`, while `server/standby`, `supabase/migrations`, and
  `scripts/ci/recorded-migrations.manifest.json` remain 100% hashed).
- Kept every release, runtime, qualification, and unknown script under
  `server/scripts/` included (`engine-*`, `build-engine-*`, `install-*`,
  `launch-*`, `observe-*`, `retain-*`, `collect-monitoring-*`, `legacy-*`,
  `main-inspector-*`, `phase*`, `qualify-*`, `prewarm-*`, `quarantine-*`,
  `reconcile-*`, `retained-*`, `retire-*`, `verify-recovery-*`,
  `build-public-hist215-*`, `runtime-settings-publish.ts`,
  `switch-list-fresh-at-merge.ts`, `privateRecordGateway*`, and any unknown
  prefix).

## Verification

- Extended `tests/operations/engine-prequalification.test.py` to prove offline
  non-release script edits leave `projection()`,
  `projection(release_authority=True)`, and `backup_projection()` identical
  while release scripts, unknown scripts, and
  `scripts/ci/recorded-migrations.manifest.json` still invalidate projections.
- Added static law barrier
  `tests/non-release-server-scripts-are-unreferenced-by-release-surfaces.law.test.ts`
  (registered in `docs/laws.d/`) proving zero excluded scripts are referenced
  by any release workflow, `server/Dockerfile`, `server/standby/**`, release
  CI script, or engine release script.
