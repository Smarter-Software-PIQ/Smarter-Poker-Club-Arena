# A completed horse audit analysis replaces the partial one it completes (2026-11-07)

## What happened

The run that claimed 2026-11-06 stored its analysis at 11:07 UTC (9 flaws)
and said it had not done the sweep of the 20 biggest losses. A follow-up
session finished the sweep and saved the completed analysis (the same 9 flaws
unchanged plus 5 new, one critical) at 18:27 UTC. The save kept the first
analysis written for the day and logged the completed one as
`retained_existing` (submission 73089a83), so the Hand Reviews panel, which
reads `horse_daily_audit.agent_analysis`, kept showing the partial one.

## Root cause

`fn_horse_audit_set_agent_analysis` (20261105220227) is first-write-wins for
any differing analysis. That protects against two accounts overwriting each
other, and it also left no way for a run that finishes another run's work to
land.

## The fix

Migration `20261107191435_a_completed_horse_audit_analysis_replaces_the_partial_one.sql`:

- `fn_horse_audit_analysis_completes(prior, next)`: true when `next` keeps
  every flaw of `prior` exactly (jsonb equality) and has strictly more flaws.
- The save replaces the stored analysis only in that case (outcome
  `completes_existing`; the previous submission is re-marked `superseded` and
  kept). Any other differing analysis is still `retained_existing`. Same
  signature, so the scheduled job's standard save is the path.
- The completed 2026-11-06 analysis is promoted by the same rule, guarded on
  the md5 of both the stored analysis and the submission.

Checked on production before writing (temporary function in pg_temp): the
real 11-06 pair completes in one direction and not the other; reworded, equal
and flaw-less inputs do not complete.

## Pinned by

`tests/a-completed-horse-audit-analysis-replaces-the-partial-one.test.ts`, and
the migration's own post-image check.
