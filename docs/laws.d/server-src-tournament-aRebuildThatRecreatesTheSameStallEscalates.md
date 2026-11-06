# server/src/tournament/aRebuildThatRecreatesTheSameStallEscalates.law.test.ts

A tournament rebuild that would return to exactly the stall its previous rebuild left, inside the hour and with no hand completed since, is held for its backoff (2, 4, then 8 minutes; aRepeatedStallIsRetriedNeverLeftStanding) and raised as a critical incident instead of repeated at once; a different stall, another event or any progress rebuilds as before
