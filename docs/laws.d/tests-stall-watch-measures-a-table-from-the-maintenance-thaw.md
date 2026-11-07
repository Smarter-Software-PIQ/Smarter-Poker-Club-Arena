# tests/stall-watch-measures-a-table-from-the-maintenance-thaw.law.test.ts

The table stall watch excuses a table whose last hand predates the latest maintenance thaw only for the first 60 seconds after that thaw, then raises it with the time measured since the thaw, so the hourly :05 alerts report real post-break stalls instead of the pre-break total.
