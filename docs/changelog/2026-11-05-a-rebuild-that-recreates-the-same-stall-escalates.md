# 2026-11-05 - a rebuild that returns to the same stall is escalated, not repeated

## Why

Satellite 25 (fbb86b2a) was rebuilt three times on 2026-11-05, by three
independent recovery paths:

- the table zombie rebuild at 18:39Z, which handed the event to a successor;
- a zombie rebuild of all five tables at 18:49Z;
- the dark-event manager rebuild at 18:54Z.

Every one replayed the same retained hand into the same wait
(`start_wait_for_players:permit=attempted`), and none of them knew the
previous rebuild had already failed that way.

Owner requirement: "Two rebuilds that return to the same deadlock should
trigger a different diagnostic or recovery path."

## What changed

`tournament/repeatedRecoveryLedger.ts` keeps, per tournament, the stall
signature of its last rebuild. A signature is each owned table's
`loopPhase:permit=<phase>`, with no timings. Both tournament rebuild paths
(`zombie_engine_rebuilt` for tournament tables, and
`dark_tournament_manager_rebuild`) ask `mayRebuildTournamentForStall` first.

The rebuild is refused when all of these hold:

- the previous rebuild cured exactly the same signature;
- it happened inside an hour;
- no hand has completed on the event since.

On refusal nothing is rebuilt and nothing is moved. The engine raises one
critical `GameServer.tournament_repeated_recovery_refused` incident per hour,
naming both rebuilds. A different stall, another event, an unknown signature
(a table with no engine, or one that cannot say where it stopped), or any
completed hand rebuilds exactly as before. Cash tables are unchanged.

Pinned by
`server/src/tournament/aRebuildThatRecreatesTheSameStallEscalates.law.test.ts`.
The four-hour dark-event law now expects 4 rebuilds and 4 escalations instead
of 8 identical rebuilds.
