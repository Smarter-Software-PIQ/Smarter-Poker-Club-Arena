# The Charles Rule countdown shows when it is paused (2026-11-14)

Owner ruling 2026-11-13: a player who falls out of profit with 7 hands left
and later returns to profit resumes at 7, not at 10. The database half shipped
in PR #10788 (`20261114050737_charles_rule_countdown_resumes_where_it_left_off.sql`).
This is the client half. No engine code and no SQL changed.

## What the client received

- Classic table: the engine's seat fields `hit_run_hands_remaining` and
  `hit_run_hands_required` are both null while the player is out of profit
  (`server/src/engine/ChipContinuity.ts`, `seatFields`). The table state says
  nothing about a paused countdown.
- `fn_my_hit_run_status` (already called by the client for the leave doors and
  for Lightning) returns `hands_required`, `hands_played` and `completed`
  through the pause, with `hands_remaining = 0`.

## What changed

- `src/lib/hitAndRun.ts`: `pausedHands(row)` reads the hands left on a paused
  countdown from one status row (required minus played, not completed, nothing
  owed). `fetchMyHandCount` returns it as `paused`, plus `done` for a completed
  countdown. New wording: `Countdown Paused`, `Hands Left When You Are Back In
Profit`, `You Are Back In Profit. 7 Hands Left Before You Can Leave`.
- `src/hooks/useHeroHandCount.ts`: on a classic table the engine still owns
  the owed count. While it reports nothing owed, the hook reads the status RPC
  for the pause: once when the table opens, then after each hand from the
  moment a count was seen until the countdown is completed. A table where no
  countdown exists is read once and not again. `useCountdownResumed` announces
  the resume with the resumed number.
- `src/components/table/HeroVpipTracker.tsx` and `HitRunCountPill.tsx`: the
  existing count block and pill show `Countdown Paused`, the number, and the
  line under it. Same classes, no new art or CSS.
- `src/pages/TablePage.tsx`: passes the pause to both and toasts the resume.

## Leave doors

Unchanged, verified: every door asks `fetchMyHandsOwed`, which reads
`hands_remaining` from the database. While paused that is 0, so no warning
opens. After the return to profit it is required minus played (7), which is
the number in the popup. The on-table count is the engine's required minus
played. Neither reads a constant.

## Tests

`tests/charles-rule-paused-display.test.tsx`.

## Not done

The engine does not send the paused count. If it should come from the table
state instead of the status RPC, `ChipContinuity.seatFields` would need to
send required minus played while `hit_run_completed` is false and the stack is
at or below the baseline.
