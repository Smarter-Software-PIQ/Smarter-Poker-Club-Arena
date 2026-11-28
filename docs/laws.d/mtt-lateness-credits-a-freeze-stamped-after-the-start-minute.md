# tests/mtt-lateness-credits-a-freeze-stamped-after-the-start-minute.law.test.ts

The newest `fn_tournament_launch_lateness_metrics` credits a bounded (<= 12 m) maintenance freeze that began no later than the late bar after `start_time`, because the engine stamps each cutover freeze just after the boundary (16:00:00.001) and the exact-start predicate of 20261128075041 never matched an on-the-hour start (Production Alerts row 450128, false `MttStartedLate` at 301 s).
