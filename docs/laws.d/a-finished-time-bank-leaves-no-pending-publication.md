# server/src/engine/AFinishedTimeBankLeavesNoPendingPublication.law.test.ts

A time bank that has been turned off (the seat acted, was auto-folded, or the bank expired) carries no pending publication, and the turn handler only takes the deferred-publication branch for a bank that is actually active, so a seat that timed out on its last decision always gets its ordinary clock on the next one.
