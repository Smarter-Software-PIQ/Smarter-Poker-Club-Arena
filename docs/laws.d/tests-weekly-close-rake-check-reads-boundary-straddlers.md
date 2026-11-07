# tests/weekly-close-rake-check-reads-boundary-straddlers.law.test.ts

The weekly close evidence report compares accepted hand rake with earned rake after removing hands that straddle a week boundary by at most ten minutes (recognized on one side, rake distributed on the other), so a Lightning hand finishing at 06:59:59 can no longer block a union close; the payout basis stays earned_at.
