# The Checkpoint Guard Settles Manager Seat-Move Serials

Release 41743213429-1 (398b9ac2) reached its 00:55 UTC break. The guard ran as the process (the earlier `retained_process_actor_unproven` is gone). It then refused `retained_manager_serial_changed` at preflight, before touching any table, and the old engine was recovered.

**Cause.** The EED manager's public `absorbOrphanedSeats()` enqueues a seat-move redrive with no freeze check of its own. With an empty outcome map that operation does nothing, yet it advances the manager's serial tail and revision. The guard compared a single witness taken before one await, so across 349 managers a harmless redrive refused the release.

**Fix.** Each manager's serial is followed to a settled witness, at most 9 rounds per manager. Every pass must end with all managers settled at the same time, at most 5 passes. This happens before the manager proofs and again immediately before the stops, with no await between the final witness, the proofs and the synchronous stops. Every authority check is unchanged: pending outcomes, park requests, break and cleanup maps, retirement and recovery operations. A manager whose serial never settles still refuses.

**Tests.** Three new guard cases:

- a single no-op redrive during the freeze settles and stops exactly once;
- a serial that never settles refuses before any stop;
- a settled serial that left a pending seat-move outcome refuses before any stop.

All 42 guard tests and 289 legacy guard tests pass.
