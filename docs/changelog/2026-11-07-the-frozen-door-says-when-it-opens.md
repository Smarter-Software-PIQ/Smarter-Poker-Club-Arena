# 2026-11-07 - The Frozen Door Says When It Opens

Dan, 14:27 Chicago, after the 13:20 Lightning join refusals: build the resume time into every refusal, show the freeze before the tap, and make the app and the database agree on when the break ends.

## What the 13:20 incident showed

- `LightningEntryPage.openLightningBuyIn` caught the rejoin door's `PLATFORM_FROZEN`, filed it as `buyin_context_failed`, and said "We Could Not Open The Buy-In Right Now. Please Try Again." The freeze sentence fixed earlier today (#9922) never reached this path.
- The engine resumed at 13:20:17; the database kept entry closed until its release boundary at 13:21:37. The banner follows the engine, so it could say "Maintenance Complete. Tables Are Resuming." while every new seat was refused.
- Lobby Join buttons looked open throughout.

## The fix

The database decides, and the app asks it two things: `fn_entry_purchases_frozen()` (the entry guard the triggers call) says frozen or open, so a stale break row the guard ignores can never hold Join shut; `fn_maintenance_break_state()` says until when. If the guard cannot be read (signed out, network), the break row alone is used. No schema change was needed.

- `src/utils/entryFreeze.ts` (pure): the row as a freeze (end = read time + `remaining_ms`, immune to device clock skew), the Join label ("Opens In 0:47" / "Opening Shortly"), and the refusal sentence ("Seats Reopen In About 47 Seconds").
- `src/hooks/useEntryFreeze.ts`: one shared store. Reads on first mount, tab return, coming online, every lobby maintenance broadcast, after any refusal, and once at the stated end. While the end is uncertain it reads again every 15 seconds so a missed broadcast cannot hold Join shut. It never polls while entry is open and never decides admission; the database still does.
- Lobby (all three board layouts) closes Join through the existing seats-closed label; seated players keep Return To Game. The Lightning page holds Join with the countdown, shows the banner, and treats the freeze as a refusal with its time. Cash join, must-move, table seat entry and the buy-in modal say the time.
- `MaintenanceBreakBanner` stays up until the database reopens entry: "Tables Are Back. New Seats Open In 1:20."

Law test: `tests/the-frozen-door-says-when-it-opens.law.test.tsx`.
