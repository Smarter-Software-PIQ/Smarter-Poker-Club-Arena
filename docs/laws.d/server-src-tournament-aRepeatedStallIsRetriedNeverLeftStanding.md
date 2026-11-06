# server/src/tournament/aRepeatedStallIsRetriedNeverLeftStanding.law.test.ts

A tournament stall that a rebuild recreated is held only for a 2, 4, then 8 minute backoff (capped) and then rebuilt again, never refused for the hour; a completed hand clears the backoff, the incident is paged once per window, and the page cadence map is pruned with the ledger
