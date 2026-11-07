# tests/the-evening-plan-only-reads.law.test.ts

The 20:00 America/Chicago evening release plan (evening-release-plan.yml, scripts/ops/release-plan.mjs) is a report, never an action: read-only permissions, explicit GETs only, no dispatch/cancel/rerun/status write, no applier, installer, deploy or child_process in the script, one SELECT on schema_migrations, and a job that fails on NOT_READY and UNKNOWN so the red-main detector is its reader.
