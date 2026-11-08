# 2026-11-07 - A Booking Cannot Start In The Past

Dan's NLH and PLO Lightning joins were refused at 13:20 Chicago because #9903 merged an owner engine window (`2026-11-07-horse-fold-provenance-engine-1800z`) at 13:13 with `notBefore` already past; the host announced at 13:14:37 and froze entry at 13:16:37. #9952 then required `playerNoticeAt` at least 20 minutes before `notBefore`, but nothing stopped a booking from merging after its own notice time - and #9969 did exactly that at 23:35 UTC: `2026-11-07-cash-room-realism-engine-2230z` with `playerNoticeAt` 22:10 and `notBefore` 22:30, so its cutover was allowed from the moment it landed.

`scripts/ci/check-owner-window-notice-after-merge.mjs` now refuses any window (engine or database) whose `playerNoticeAt` is earlier than the moment it merged: the first first-parent commit on main that added its id, or now for a window the pull request is booking. It runs in the required "TypeScript compilation and repository checks" job, which already checks out full history, against the PR's base.

Certified recovery windows stay exempt. Windows main held before 2026-11-08 02:00 UTC are not re-judged (the cash-room window is the last of them; its window closes 2026-11-08 04:30 UTC).

Not enforced inside `engine-release-transaction.sh`: the certified transaction has no git or database read of its own and ships through exact control-generation packaging, so a new refusal there would add a failure mode to every cutover. A booking that cannot merge cannot be activated, so the pull request is the door.

Law test: `tests/a-booking-cannot-start-in-the-past.law.test.ts`.
