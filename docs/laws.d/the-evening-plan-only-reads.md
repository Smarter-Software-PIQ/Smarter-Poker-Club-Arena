# tests/the-evening-plan-only-reads.law.test.ts

The 20:00 America/Chicago evening release plan (evening-release-plan.yml, scripts/ops/release-plan.mjs) is a report, never an action: read-only permissions, explicit GETs only, no dispatch/cancel/rerun/status write, no applier, installer, deploy or child_process in the script, one SELECT on schema_migrations, and a job that fails on NOT_READY and UNKNOWN so the red-main detector is its reader.

The hosted plan retains the installed migration rows only in the runner's temporary snapshot. Its report-only Python reader verifies the exact certificate archive and Backup dump binding, reads source migration requirements, and measures physical Backup phases through GitHub GET requests. A workflow head alone cannot identify a manual or retargeted run's candidate.
