# tests/a-horse-claim-never-waits-on-a-dashboard-revision.law.test.ts

A horse claim never waits on a dashboard revision: fn_ca_horse_claim_due takes each horse's daily_challenge_dashboard_revisions row with its other player locks, after the profile and before the claim, FOR NO KEY UPDATE SKIP LOCKED, so the minute claim run can no longer deadlock with the daily prune or any other writer that bumps several players' revisions at once; a busy horse is owed to the next run, and every reward and every revision bump is unchanged (migration 20261123071151).
