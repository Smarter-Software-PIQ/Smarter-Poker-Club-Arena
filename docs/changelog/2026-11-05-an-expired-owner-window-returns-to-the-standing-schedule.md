# An expired owner window returns releases to the standing schedule (2026-11-05)

Dan: "HARD CODE FIX THIS AT ITS ROOT CAUSE SO IT STOPS HAPPENING."

## What was wrong

`server/scripts/engine-release-activation-floor.py` refused every fresh engine
release once the selected later owner window (`supersedesPhase1Schedule`) had
expired: "explicit later owner window expired; no alternate reset authorized".
The standing hourly Phase1 schedule Dan ordered on October 31 was never
reached, so after each window ended (05:00Z and 12:45Z on November 5) releases
stayed refused until an agent wrote a new owner window into
`server/release/owner-maintenance-windows.json`.

## The fix

An expired owner window simply stops applying. Fresh admission falls through to
the standing schedule (the maintained Phase1 policy, or the daily 04:00 Chicago
baseline once Phase1 is recorded complete), exactly as an expired legacy floor
already did. The release transaction already required an unexpired owner
window before skipping the routine cycle, so it needs no change. An expired
window still admits nothing itself, and runtime entries already in custody keep
their original recovery.

Pinned by `tests/an-expired-owner-window-returns-to-the-standing-schedule.law.test.ts`
and the native case in `tests/operations/engine-activation-floor.test.py`.
