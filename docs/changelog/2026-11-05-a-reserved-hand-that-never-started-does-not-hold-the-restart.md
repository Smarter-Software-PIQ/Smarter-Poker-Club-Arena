# 2026-11-05 - a hand held by the break before its deal no longer blocks engine releases

## What happened

Engine release run 42126015699-1 announced the 23:20 Deployment Recovery
break at 23:20:00.953Z. Spin table 9139b7d2 (tournament 3111798e, "20 Chip
Spin NLH", 2 players) logged `Hand #55574170 - 2 players` at 23:20:01.301Z.
The LAST HAND fan-out reached it at about 23:20:01.365Z. The table logged
`Parked between hands` at 23:20:01.536Z. That hand was not dealt until after
the thaw.

From 23:22:09Z the restart census reported the table as
`unparkedReasons={'cards_in_air': 1}` every 16 s. The release ran out of its
260000 ms budget and backed out. Release 42099609162-1 had backed out the
same way at 20:27-20:34Z.

## Cause

- `dealHand` allocates the number and reserves the F06 permit, then
  `runOriginalController` retains the sequence-zero original
  (`retainOriginalBatch`). After `attemptOriginalRetention()` that permit can
  never be cancelled locally as `never_started`.
- The break's `pauseForMaintenance` landed during that retention, so the
  engine held the retained, never-started original at the pause gate. It is
  correct to hold it there: a break forbids the start, and the hand plays
  intact after the thaw.
- `MaintenanceBreak.unparkedTables()` asked only `isBetweenHands()`, which is
  `handController === null`. A held original has a controller, so the table
  was counted as `cards_in_air` for the whole break, with no card dealt.
- The gate path also never wrote the `parked` bank checkpoint. So even with
  the census fixed, the table would have read `bank_park_write_incomplete`.

## Fix

- `ServerTableEngineDealing.isPreparedOriginalHeldForMaintenance()` names
  exactly that shape. It has the same terms as #9560's
  `isPreparedOriginalHeldAtTerminalCloseout()`, but under the maintenance
  hold:
  - the engine is running and current, and is at the gate;
  - the controller is the retained prepared original;
  - the permit is attempted for this hand;
  - there is no continuation batch;
  - `handStarted === false`;
  - no settlement, post-hand, boundary or weekly-payout writer is in flight.
- `MaintenanceBreak.unparkedTables()` does not count that table as
  `cards_in_air`. It still asks the table's durability.
- `runOriginalController` writes the break's `parked` presence and time-bank
  checkpoint before it holds the original at the gate, the same way the
  dealing loop does at its own park. `pauseForMaintenance` treats an already
  held original as already parked.
- The census adds no retry, timer or bypass. The hand is not dropped,
  re-numbered or settled. It deals from the same deck after the thaw, or a
  successor generation reclaims the same original.

Pinned by
`server/src/maintenance/aReservedHandThatNeverStartedDoesNotHoldTheRestart.law.test.ts`
and the engine interleaving in
`server/src/engine/aReservedHandHeldForTheBreakIsParked.test.ts`.
