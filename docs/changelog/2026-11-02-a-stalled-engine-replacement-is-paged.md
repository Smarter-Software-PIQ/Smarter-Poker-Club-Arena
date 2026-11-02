# A Stalled Engine Replacement Is Paged

- **Problem:** every host release attempt writes its failure to `engine_deploy_exit_paths`, but nothing read that table. On 2026-11-01 to 02, 25 consecutive replacement attempts failed while eed06fe5 kept serving, and one stranded receiver retried 269 times without anyone being paged.
- **New check:** `fn_ca_engine_release_stall_check(6, 3)` runs hourly at :23 (outside the break window). It raises one critical `financial_alerts` page when the engine leader is fresh and at least three attempts to deploy a different version failed in the last six hours. The page is not repeated while the stall persists, and it is resolved with the re-measurement once the stall clears. A stale leader heartbeat is reported as unknown and never as healthy. The check reads two tables and never touches releases, engines or money.
- **Production at install time:** 10 failed attempts (10 runs) in the previous six hours on eed06fe5, so it pages on its first run.
- **Proof:** `scripts/ci/test-a-stalled-engine-replacement-is-paged.py` (PostgreSQL 17, exact migration file, nine behaviours). Three code mutations were each caught.
