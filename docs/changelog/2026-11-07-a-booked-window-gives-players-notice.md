# 2026-11-07 - A Booked Window Gives Players Notice

Dan, after his NLH and PLO Lightning joins were refused at 13:20 Chicago: "HOW ELSE CAN THIS BE IMPROVED, ENHANCED OR OPTIMIZED STILL SO THIS NEVER HAPPENS AGAIN?"

## What happened

`2026-11-07-horse-fold-provenance-engine-1800z` was booked in `server/release/owner-maintenance-windows.json` by #9903, merged at 13:13:11 Chicago with `notBefore` already in the past and `announcementPolicy: earliest-certified`. The host announced at 13:14:37 and froze entry at 13:16:37. The engine has no knowledge of a booked window until the host announces it, so players got the two-minute last-hand warning and nothing else.

## Fix

- Every window booked from 2026-11-07 21:00 UTC, engine or database, must carry `playerNoticeAt`, at least 20 minutes before `notBefore` (`tests/a-booked-window-gives-players-notice.law.test.ts`). Only a `certifiedRecoveryProfile` emergency window is exempt. Twenty minutes covers the client publication that carries the booking (about eight to ten minutes after merge) and still leaves players ten minutes or more of notice.
- `scripts/generate-owner-maintenance-notices.mjs` projects the bookings (id, kind, `playerNoticeAt`, `notBefore`, `notAfter`) into `src/utils/ownerMaintenanceNotices.json`; the law test refuses a projection that differs, so a booking reaches the client on its own publication. Windows ending at or before 2026-11-08 00:00 UTC are not shipped (all past or already spent).
- `src/utils/maintenanceSchedule.ts`: `bookedMaintenanceNotice(at)` returns the booked window players should be told about (from `playerNoticeAt`, or one hour before `notBefore` for a window without one, until `notAfter`), and `bookedMaintenanceNoticeText(notice, at)` the banner sentence: "Short Maintenance Break Possible Between 1:00 PM And 7:00 PM Chicago Time. Play Pauses For About Five Minutes." before it opens, "A Short Maintenance Break Can Start Any Time Before 7:00 PM Chicago Time. ..." once open. The banner shows it in its upcoming branch.

## Not built: choosing a low-traffic minute

The request was to prefer a quiet minute for an earliest-certified cutover. The announcement minute is chosen inside the certified host release transaction (`server/scripts/engine-release-transaction.sh`, the fresh owner-window branch beside the `:05:30-:49:00` gate), which has no database read of its own, ships only through the exact control-generation packaging that once stranded the engine for 59 hours on one missing sibling file, and has no behavioural test harness for that branch. Holding the announcement for a seated-count minimum would add a second, unbounded wait to the earliest-certified policy and a new database dependency to a script whose every refusal must stay exact. The notice above already gives players the window in advance, and the booking agent chooses `notBefore`. If a quiet-minute rule is wanted, it belongs in the booking (a later `notBefore`) rather than in the certified transaction.
