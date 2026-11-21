# tests/hot-path-lock-matrix-exercised-in-ci.law.test.ts

`scripts/ci/test-rebuy-never-pauses-the-tournament.py` (wired into `.github/workflows/tournament-event-lane.yml`) exercises the unified concurrent hot-path lock matrix of sibling-table hand commits (`w_commit_e4`) against every tournament writer (`move`, `break_park`, `bounty_rebuy`, `addon`, `elimination`, `bounty_sweep`, and `entry_close`) with strict sibling-table commit latency bounds (`< 50 ms` in-DB SQL commit time and `< 150 ms` wall clock against a `1.6 s` held lock).
