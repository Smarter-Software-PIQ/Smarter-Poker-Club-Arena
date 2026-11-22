# A Freeze Baseline Is Certified Once (incident 076ff467)

**Alert:** EngineCutoverMissed, 2026-11-20 04:30 Chicago. Production kept serving 5ed440ab; the owed build was 62520794.

**What happened.** The 03:30 selection (daily-engine-selection-2026-11-20) answered keep-serving with no deferred candidates: no commit carried a successful `backup-engine/certified` status. The freeze baseline 62520794 had been certified at 02:18 (run 44689115500). Two pushes merged while that run soaked (02:00, 02:02) each planned `due` again, because the reader only stopped on a success. The two duplicates queued for the Backup host; run 44699440514 timed out waiting for its turn and published `failure: database_refresh_failed` over the success at 03:18, having tested nothing. The other finished at 04:03, after the cutoff. (Earlier that night the baseline also failed twice: once on the new regression replay, fixed in #11505/#11506, and once on a cancelled run.)

**Fix.**

- backup-freeze-baseline.py answers `claimed` while an active run's pending status names the baseline, and `done` for any success after the freeze began even under a newer refusal.
- The plan job writes that pending claim the moment it answers `due`.
- A run whose refresh never held the Backup host neither marks the commit pending nor publishes `failure`; it reports `error`, which never replaces a success.

**Law:** tests/a-freeze-baseline-is-certified-once.law.test.ts.
