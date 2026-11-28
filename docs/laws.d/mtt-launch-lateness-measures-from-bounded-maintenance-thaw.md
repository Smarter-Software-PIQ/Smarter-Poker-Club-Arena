# tests/mtt-launch-lateness-measures-from-bounded-maintenance-thaw.law.test.ts

`fn_tournament_launch_lateness_metrics` measures MTT launch lateness from `effective_start_time = GREATEST(start_time, covering bounded <= 12 m maintenance thaw)` across `engine_maintenance_break_log` and complete v3 `engine_maintenance_thaws`, eliminating false `MttStartedLate` alerts when fixed-board `:00` starts deal immediately after the owner's 3-hourly `:00-:05` maintenance freeze while still alerting on any post-thaw stall, non-break late launch, or unbounded freeze (incident 334c611e).
