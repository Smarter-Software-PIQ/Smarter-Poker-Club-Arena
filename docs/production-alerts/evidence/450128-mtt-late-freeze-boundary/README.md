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

`20261128200707`: a bounded freeze is credited when it began by `t.start_time + late` (inside the late bar) and ended after `t.start_time`. Everything else in the function body is unchanged.

## Proof

- `native-proof.sh` (PG16, same fixtures, both definitions), output in `native-proof.out`:
  - A, the live shape: `1,0,301` pre-fix, `0,0,0` post-fix.
  - B, a 181 s post-thaw stall: still alerts.
  - C, a freeze opened after the late bar: still alerts.
  - D, an unbounded 13 minute freeze: still alerts.
- `tests/mtt-lateness-ignores-an-event-nobody-entered.law.test.ts (renamed; see the re-version note below)`: fails 2 of 4 on main without the migration, passes 4 of 4 with it. The existing `mtt-launch-lateness-measures-from-bounded-maintenance-thaw` law still passes, and so does the law registry.

## Second cause, same function (row 450194, read live 2026-11-28T19:07Z)

Every 19:05Z `MttStartedLate` since 11-24 read "2 MTT(s)" and resolved to "1" at about 19:31Z (449020/449033, 449324/449332, 449757/449764, 450194). The second event is the daily "Daily 25 Chip Freezeout" of the one-member pilot club 652f121d (min_players 3, no horse in its pool). Today's df0cc4ad sat REGISTERING with no `tournament_players` row and current_players 0, and `late_waiting` counted it from start + 240 s. The engine's empty-event rule (`server/src/tournament/emptyPastStartEvent.ts`, 2026-10-15) then cancels it at start + 30 m: 876d20ee at 19:32:24Z, 5d264f3a at 19:30:23Z, 3c2f86c6 at 19:30:10Z and ff9a92ad at 19:30:05Z.

An event with no entrant has nobody to deal to. `fn_tournament_metrics.overdue_start` (TournamentNeverStarted) already exempts exactly this shape until start + 30 m + overdue, and pages if it is still standing. `late_waiting` now uses the same entrant test. An event with even one registered or playing entrant still alerts.

Read-only at 19:09:59Z, window 60 m:

| definition | result |
|---|---|
| live (`31cdd1ce`) | `(1, 1, 600)` |
| amended body | `(0, 0, 0)` |

Native proof, case E: pre-fix `late_waiting` 1, post-fix 0, and 1 again with one registered entrant.

## Re-versioned after #12377 (2026-11-28T20:10Z)

`20261128161915` (#12377, merged 19:11Z, another lane) fixed cause 1 with a 5 s tolerance on the freeze start, which covers every observed stamp (`.001`). Both PRs redefine `fn_tournament_launch_lateness_metrics`. The draft's version `20261128160858` is older than `161915`, so it would have installed after #12377, replaced its body, and left #12377's law test passing against a function that no longer matched it.

What changed:

- The migration is now `20261128200707_mtt_launch_lateness_ignores_an_event_nobody_entered.sql`, versioned after `161915`.
- It pins `161915`'s installed body as its preimage: md5 `19533b7bf3421c6bbbf2e4b1560564f6`.
  - I computed it on PG16 from the #12377 file.
  - The same method reproduces #12377's own pinned live preimage, `31cdd1ce…`, from `075041`.
  - If `161915` is not installed first, the preimage check refuses (fail closed).
- The late-bar widening is dropped. #12377's 5 s predicate is kept byte for byte, and the only body change is the entrant test (cause 2).
- The law is renamed `tests/mtt-lateness-ignores-an-event-nobody-entered.law.test.ts`. It asserts the version order and the preimage.

`native-proof.out` (chain 075041 → 161915 → 200707):

| case | result |
|---|---|
| A, live shape | `1,0,301` → `0,0,0` (#12377) → `0,0,0` |
| B, post-thaw stall | still alerts |
| C, freeze 121 s after start | still alerts |
| D, unbounded freeze | still alerts |
| E, empty event | `late_waiting` 1 → 0, and 1 with one entrant |
