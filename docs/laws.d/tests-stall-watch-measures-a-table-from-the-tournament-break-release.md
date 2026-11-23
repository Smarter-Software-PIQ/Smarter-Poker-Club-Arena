# tests/stall-watch-measures-a-table-from-the-tournament-break-release.law.test.ts

The table stall watch excuses a tournament table that was dealing up to the hourly break only until the engine's latest possible break end plus 60 seconds (break_started_at + 8 minutes), so the :00 alerts after every synchronized break report real post-break stalls instead of the pre-break silence.
