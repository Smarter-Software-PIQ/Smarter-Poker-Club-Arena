# A late Spin rung is asked at least once a minute (2026-11-19)

Production Alerts incident `spin-ladder-rung-overshoot`: six SpinFleetProducingNothing criticals in seven days.

A horse-only seat-first board whose ladder rung had closed and came back short was re-asked on a backoff that doubled from 12 s up to a ten-minute cap. Under the ladder the free-horse pool is busy for minutes rather than empty for hours. That cap therefore made the board that had waited longest the one that asked least often, and fresher boards won every freed horse. Board 2db5ea97 was seated 1951 s past its rung, one pass after its 1944 s ask.

- `seatFirstLadderBackoffMs` (`server/src/config/seatFirstLadder.ts`): 12 s, 24 s, 48 s, then 60 s, never more.
- The fast lane reads REGISTERING seat-first boards oldest `start_time` first.
- `SEAT_FIRST_STUCK_AFTER_MISSES` goes from 6 to 14, so the stuck alarm still fires after about twelve minutes of shortness.
- Law: `server/src/aLateRungIsAskedOnceAMinute.law.test.ts`.
- Evidence: `docs/production-alerts/evidence/spin-ladder-rung-overshoot/`.

This is an engine change. It ships through the daily 04:00 America/Chicago engine release.
