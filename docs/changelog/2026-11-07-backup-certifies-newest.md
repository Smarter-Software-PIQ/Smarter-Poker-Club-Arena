# Backup Engine push runs certify only what can still ship

- `.github/workflows/backup-engine.yml` plan job, push runs only: after the existing
  "newer push run queued" retirement, the starting run asks GitHub for main's newest
  commit touching `server/**` (the tree `stage-engine-release.yml` offers as
  `TARGET_SHA`, which always contains the newest engine-runtime commit). If that commit
  strictly descends from the pushed commit, the run certifies it instead (RETARGETED).
- If the chosen commit already carries `backup-engine/certified = success`, the run
  plans nothing and writes no status (ALREADY CERTIFIED), so no commit is certified twice.
- Unreadable GitHub answers keep the pushed commit (old behaviour). `workflow_dispatch`
  with `sha`, schedule and post-seal `workflow_run` paths are unchanged; certification
  steps and the status context are unchanged. Release admission still reads
  `backup-engine/certified` on its exact target / newest certified ancestor.
- Law test: `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`.
