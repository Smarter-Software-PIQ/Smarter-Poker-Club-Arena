# A Waiting Game Keeps Its Clock Through A Release

2026-11-28, HORSE DECISIONS lane. Follow-up to the first-owed time added by docs/changelog/2026-11-27-the-drain-review-follow-ups.md (#12297).

## What Was Wrong

#12297 put `detail.variety_owed_since` on the fleet heartbeat ({game id: the time the game first became owed a start}) so the live check could report real waits. On the first release that carried it (1 AM CST, 2026-11-28, build 2b3b3647d3a6) every game that was already waiting lost its time: the fleet's last beat before the stop was 12:57:43 AM with nine games owed, its first beat after the restart was 1:05:19 AM, and all nine games read 1:05:15 AM. A game that had waited for hours read as waiting for seconds, at every release, which is exactly when the live check is run.

## Why

The time was kept in a private field of the fleet process (`varietyOwedSinceByGame` in `HorseFleetManager`, stamped by `HorseVarietyFirst.varietyOwedSince`), and that field starts empty. The fleet process stops about 5 minutes before each release and starts again about 3 minutes after it, every 3 hours. A clock held in a process cannot measure a wait that is longer than the life of that process. The design recorded the value on the heartbeat for others to read and never read it back itself.

## The Fix

The heartbeat is already the durable copy of that memory, so the fleet reads its own last word once when it starts.

1. `HorseFleetManager.start()` makes ONE read per boot: the newest `ca_horse_fleet_heartbeat` row written before this process started (`beat_at` below the boot time, newest first, one row, on the existing `beat_at` index). No cycle makes this read. A failed read, an error or no row carries nothing.
2. `HorseVarietyFirst.carriedOwedSince` (pure) decides what may be carried from that row:
   - the beat must be at most `VARIETY_OWED_CARRY_MAX_AGE_MS` (20 minutes) old when the first seating cycle runs, and not from the future. Measured on the ten restarts from 10 PM CST Nov 26 to 1 AM CST Nov 28, the last beat before the stop to the first beat after it was 431 to 460 seconds, so 20 minutes is 2.6 times the longest: a slow release still carries, and a longer stop (a failed release, an outage) carries nothing because the floor can change while no fleet is watching it;
   - each value must be a full ISO time, not after now and not older than `VARIETY_OWED_CARRY_CEILING_MS` (90 days, there only to refuse a nonsense date); anything else is ignored, one game at a time.
3. `varietyOwedSince` takes the result as `carried`. On the first seating (not withheld) cycle a game that is owed keeps its carried time; a game that is no longer owed keeps nothing; a time this process already holds wins over a carried one. A withheld cycle publishes no owed games, so it takes nothing and the first seating cycle after it does (if the beat is still inside the 20 minutes).
4. A game that fails any guard gets the first-cycle time, which is what every game got before this change.

Heartbeat detail only, no migration. The fleet's single assignment to its first-owed memory is unchanged.

## It Changes No Decision

The first-owed time is written to the beat and read by nothing in the engine. No decision function of the drain takes it (`drainOwedGames`, `varietyDrainDecision`, `drainCycleOutcome` and `drainWhyForBeat` have no such input), and in the fleet the memory is read in two places only: as its own `previous`, and by the heartbeat write.

## What Was Not Done, And The Error That Remains

- **No check that the game dealt no hand during the stop.** That needs `hand_history` joined to `tables` for every carried game: a second query against the largest table in the system at boot, not something the one heartbeat read can answer. The rule relies instead on two facts: a game is owed only while it has no occupied table, and the stop is at most 20 minutes, almost all of it with the engine down and nothing dealing. The case that slips through: a game that was owed on the last beat, was started, dealt, and emptied again all between that beat and the first seating cycle. Its wait is then overstated by the length of that short session. It needs a start, a hand and a walk-off inside the few engine-up seconds on either side of a release, and the live check already refuses a first-owed time earlier than the game's last dealt hand, so the check corrects it.
- **The newest beat is believed as written.** If the stopped process's last beat came from a cycle that ended before it reached the first-owed step, that beat carries an empty map and nothing is carried (the old behaviour, for that one release). On the ten measured restarts the last beat was a full cycle every time.
- **A wait longer than 90 days** starts its clock again at the release that crosses the ceiling.
- **A resting game still restarts its clock.** A game whose start failed for its own reason rests for 5 minutes and leaves the owed list while it rests, so `varietyOwedSince` forgets it (the rule from #12297, unchanged here). That is inside one process and is not this defect.

## The Live Check

`scripts/sql/variety-drain-live-check.sql` is unchanged. A carried time is earlier than the release, which the check already treats as a wait that began before its window and times from the heartbeat.

## Pinned By

`server/src/services/aWaitingGameKeepsItsClockThroughARelease.law.test.ts` (docs/laws.d entry in the same commit):

- the measured release: a game owed before the stop and still owed after it keeps its time, and a newly owed game gets the first-cycle time;
- only a game owed on the first seating cycle keeps a carried time; this process's own memory wins; a withheld cycle takes nothing;
- a beat too old, from the future, missing or unreadable carries nothing; a malformed, future or too-old time is ignored one game at a time;
- the drain's cycle outcome is identical with and without a carried time, and the fleet's first-owed memory reaches the heartbeat and nothing else;
- one read per boot: `start()` makes the only read of the heartbeat table, a failed read never rejects, the first seating cycle takes it and no later cycle reads or awaits anything.

All of these fail on origin/main.
