# A table move takes a chair that is free when it lands

**2026-11-25 · tournaments**

When late registration was filling new tables, the table balancer sometimes sent a player to a chair a new entrant had just taken. The move was refused cleanly and retried on a later pass, but each refusal showed up as an error and the player waited at the old table. The engine now checks the destination chair when the move is sent, picks another free chair if it was taken, and waits quietly if the table filled up.
