# 450128: MttStartedLate after the 10:00 CST cutover (freeze stamped 1 ms after the start minute)

Row 450128 (`alertmanager`, `MttStartedLate`, firing 16:05:26Z, 2026-11-28). This incident is `mtt-started-late-cutover-hour`; the linked rows are 449889, 449822, 449757, 449705, 449551 and 449426, plus engine incident 334c611e.

## Read live (read-only, 2026-11-28T16:06Z)

| what | value |
|---|---|
| `20261128075041` (the #12326 fix) | installed; the live function body contains `effective_start_time` |
| live md5 of `pg_get_functiondef` | `31cdd1ce751effd17cd335d30f60e840` |
| `fn_tournament_launch_lateness_metrics(120,120,15,24)` | `(1, 0, 301)` |
| MTT 5d4aeb41 "Mid-Morning Turbo (6-Max NLH)" | start_time 16:00:00.000, first hand 16:05:01.156 |
| `engine_maintenance_break_log` | 16:00:00.001 -> 16:05:00.149 (13:00:00.001 -> 13:05:00.103 before it) |
| `engine_maintenance_thaws` v3 | 16:00:00.001 -> 16:05:00.001, complete |

## Root cause

`20261128075041` credits a thaw only when `freeze_started_at <= t.start_time`. Every cutover freeze is stamped just after the boundary, so the predicate is 1 ms short for every on-the-hour start, and the fix can never match the case it was written for. 16:00Z was the first cutover with an MTT start after the fix was installed.

## Fix

`20261128160858`: a bounded freeze is credited when it began by `t.start_time + late` (inside the late bar) and ended after `t.start_time`. Everything else in the function body is unchanged.

## Proof

- `native-proof.sh` (PG16, same fixtures, both definitions), output in `native-proof.out`:
  - A, the live shape: `1,0,301` pre-fix, `0,0,0` post-fix.
  - B, a 181 s post-thaw stall: still alerts.
  - C, a freeze opened after the late bar: still alerts.
  - D, an unbounded 13 minute freeze: still alerts.
- `tests/mtt-lateness-credits-a-freeze-stamped-after-the-start-minute.law.test.ts`: fails 2 of 4 on main without the migration, passes 4 of 4 with it. The existing `mtt-launch-lateness-measures-from-bounded-maintenance-thaw` law still passes, and so does the law registry.
