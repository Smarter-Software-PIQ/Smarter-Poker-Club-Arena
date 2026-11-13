# tests/a-table-resuming-from-its-tournament-break-is-not-stopped.law.test.ts

The table stall watch excuses a tournament table whose last hand predates the end of its synchronized break only for the first 60 seconds after the watch last saw that break, then raises it with the time measured since the break ended, so the hourly :00 TableStoppedDealing alerts report real post-break stalls instead of the pre-break total.
