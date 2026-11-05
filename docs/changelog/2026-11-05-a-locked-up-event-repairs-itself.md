# 2026-11-05 - a locked-up tournament repairs itself instead of waiting for an engine restart

## What happened

At 13:57Z a hand-continuation write on PLO4 Spin 312a52c3 (table 4f1f0fa6)
lost its reply (`Hand Continuation Write Is Unproven [transport_error]`). The
table engine's stop then threw `retains unproven original hand custody`
before it gave back its process-wide table slot. The manager was handed to a
successor generation, and its stop failed `retained time-bank custody`. The
quarantine re-offered the same stop every minute after that. PLO4 Heads-Up 2
d86349bc went the same way at 14:02Z, and six more events did between 14:43Z
and 15:10Z. Each time, only a manual restart of the whole container cleared
them (14:13Z and 14:36Z, with every table paused for about seven minutes
each time). After the restart every one resumed from its durable rows and
finished normally. 312a52c3 completed at 14:30Z and d86349bc at 14:57Z.

## Why the stop could never succeed

`persistStoppedTimeBankCustody` is the one write that clears "retained
time-bank custody". It refuses while any live engine holds the table's
process slot (`shouldPersistStoppedCustody`), so that it never overwrites a
newer engine's park row. The only engine holding that slot was the dead
original itself: its `performStop` threw on unproven hand custody before it
reached `releaseCurrentEngine`. Re-offering the same stop could therefore
never succeed. A restart is the only other thing that frees the slot.
PR #9528 makes the continuation write retry a lost reply, which prevents most
of these, but it does nothing for a manager that is already stuck.

## The fix

`TournamentManagerOwnership.evictManagerAfterRepeatedStopFailure` reuses the
fenced eviction that a stranded stop already uses (2026-10-03) for a stop
that keeps failing. Only the quarantine's own retry calls it, once the
quarantine has been charged `QUARANTINE_SELF_REPAIR_ATTEMPT` (4) attempts:
the first failure plus three retries, about 70 s. The eviction:

1. refuses an F06 recovery owner, a manager whose stop has not settled, and a
   refused seat-move release certificate;
2. fences the manager (its lease proof expires, so it can no longer deal or
   renew);
3. refuses if any table is running, holds a claimed seat-move boundary or has
   a settlement in flight;
4. gives back each terminal engine's process slot
   (`surrenderProcessOwnershipOfStrandedTeardown`). With the slot free, the
   stopped time banks can now be written to disk;
5. refuses if any bank is still not on disk. The registry's identity-CAS
   unregister refuses that case as well.

Then `stopTournamentManagerIfOwned` releases only that manager's exact lease
generation. The RUNNING lane re-adopts the event through the resume path a
fresh boot uses, under a new generation. That path asks the abandoned
generation door and the hand-continuation recovery about the unproven hand.
GameServer also refuses the self-repair while the process holds in-memory
drained or mixed F06 custody for the event, because a rebuild from durable
rows would not see it.

A refusal leaves the manager quarantined on its existing backoff (at most one
attempt a minute) and is reported as
`GameServer.quarantined_tournament_manager_self_repair_refused` with the
reason. A success is reported as
`GameServer.quarantined_tournament_manager_self_repaired`. No other
tournament is touched, nothing is settled or credited, and no cancellation
path was added.

Pinned by `server/src/tournament/aStopThatKeepsFailingIsSelfRepaired.test.ts`.
