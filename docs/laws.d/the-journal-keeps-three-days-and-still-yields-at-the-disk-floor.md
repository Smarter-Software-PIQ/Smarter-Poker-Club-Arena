# server/src/services/horseDecisionJournal/theJournalKeepsThreeDaysAndStillYieldsAtTheDiskFloor.law.test.ts

The Horse decision journal's live writer keeps every shard's segments for at least 72 hours by default (it was 30, and the hands a person played were retired before the by-hand read the release rules allow could reach them), and the 32 GiB free-disk floor still makes that guarantee yield, by name, exactly as before: under the floor young segments are retired oldest first, a hard quota never yields, and readers and tools get no guarantee.
