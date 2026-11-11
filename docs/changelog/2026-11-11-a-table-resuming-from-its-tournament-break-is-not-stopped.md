# 2026-11-11: a table resuming from its tournament break is not stopped

The table stall watch raised `TableStoppedDealing` for every tournament table at
the first tick after the hourly synchronized break was released, because it
counted from the table's last hand before :55. In 14 days that was 248 rows (40 critical). The maintenance thaw was fixed
the same way on 2026-11-07 (20261107032642), but the tournament break never was.

Migration `20261111074922` records the watch's own last sight of the break on
the watch row (`tournament_break_seen_at`) and excuses a table silent since
before it for 60 seconds after that sighting, never longer. A table still
silent after that is raised as before, with its time measured since the break
ended. Law: `tests/a-table-resuming-from-its-tournament-break-is-not-stopped.law.test.ts`.
Evidence: `docs/production-alerts/evidence/376615-tournament-break-resume/README.md`.
