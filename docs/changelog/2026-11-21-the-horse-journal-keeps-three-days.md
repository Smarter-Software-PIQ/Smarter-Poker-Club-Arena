# 2026-11-21: the Horse decision journal keeps three days

## What was wrong

Each decision-worker shard of the Horse decision journal keeps the larger of its byte allocation and a time guarantee, and the guarantee was 30 hours. The only copy off the ring is a by-hand read on the engine host, which the release rules forbid between a booking's merge and its seal. With a cutover every three hours the busiest 4 GiB shard, which carries the PLO5 and person-seated tables, lost hands before they could be read: on the evening of Nov 20 all of Nov 18 was gone, and of the Nov 19 hands with a person seated 2 of 135 sampled still had records (PLO5: 14 of 549). Every exact-replay grade of a Horse change against persons reads those records.

## What changed

- `HORSE_JOURNAL_MIN_RETENTION_HOURS` (services/horseDecisionJournal/config.ts) is 72, was 30. Nothing else: the 32 GiB free-disk floor, the hard quotas, the `HORSE_DECISION_JOURNAL_ARCHIVE_MIN_RETENTION_HOURS` override (0 to 168) and readers are as they were. No decision path, no migration, no setting.
- Law `theJournalKeepsThreeDaysAndStillYieldsAtTheDiskFloor.law.test.ts`: the default is 72 h, segments 31 h and 71 h old stay past the byte allocation, and under the floor the guarantee yields by name exactly as before.

## Disk

Estimated about 35 GB per added day for the fleet, so about 50 GB more than at 30 hours, reached over the two days after the release starts. The estimate comes from the engine's /health on 2026-11-21 04:53Z (one shard: 4.83 GB, 408,997 segments, 646,233 records, a 1.01 GB catalog at 30 h) and the retention the other shards showed; the host's free disk was not read for this change. The release driver reads `df` on the engine host before the cutover that carries this: with less than about 90 GB free the guarantee would reach the 32 GiB floor and yield (logged as journal_retention_guarantee_breached, capture continues), which is safe but is not three days.

## Rolling back

Lowering the hours on this release drains safely (config.ts, TURNING IT OFF). Only segments not yet retired are protected; nothing already retired returns.
