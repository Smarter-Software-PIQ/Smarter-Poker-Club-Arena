# 2026-11-01: owner-ordered drained activation of the engine crash-loop fix

Dan ordered the remaining platform-health work finished (2026-10-31 15:34 and
2026-11-01 00:05 America/Chicago), naming the engine crash loop that was waiting
for the 04:00 daily window.

Why a window, measured:

- eed06fe5 restarted unplanned seven times in eleven hours (RSS about 10 GB
  before each crash); its replacement (#9057) merged at 04:10 UTC.
- No release has sealed since 2026-10-29. Every intake made during play died at
  once because the drained-boundary witness re-armed errexit (#9095).
- The daily 03:30 Chicago preparation ran about six hours late on 2026-10-30
  (15:08 / 16:03 UTC) and 2026-10-31 (14:37 / 15:24 UTC), after the 04:00 break
  it was meant to stage. On 2026-10-31 that break certified ready in 4 s with
  nothing waiting to install.

This appends owner window 69, `2026-11-01-engine-crashloop-fix-daily-fallback`
(contains the #9095 merge, which contains #9057), eligible 07:05-09:25 UTC,
wholly after the end of daylight time: one activation at a Chicago :53 notice /
:55 break (01:55 or 02:55 CST), and selects its exact activation-floor witness.
The census does not fit, so only a strict drained boundary may cut over; a pass
that is not drained refuses cleanly and the break thaws on its own clock.

If no pass activates, the floor expires at 09:25 UTC and the admitted request
waits on the routine 04:00 Chicago (10:00 UTC) daily break, so tonight's daily
window no longer depends on GitHub firing the schedule on time. The window never
overlaps the daily window. Every historical window byte is unchanged and pinned.
