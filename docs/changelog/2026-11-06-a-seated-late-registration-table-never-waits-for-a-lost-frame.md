# A seated late-registration table never waits for a lost frame (2026-11-06)

## What was slow

After the 03:00 UTC maintenance break on 2026-11-06, three late-registration
tables sat seated with no dealer: Six-Card Feature 716f92a0 for 304 s (3 seated,
no hand), Six-Card Feature 1817ecac for 72 s and 40 Chip Bounty Freezeout
4b7f39d4 for 164 s. The 30 capacity tables opened earlier that night were
admitted in about 1 s.

## Cause

The dealer of a capacity table is started by the direct admission that runs
when the `late_registration` manager wake reaches the engine over Realtime.
Each of the three tables was committed by a generation bump of a wake that
was already pending, the direct admission never ran, and the table was
admitted only by the next full elimination sweep, seconds before that sweep
consumed the wake (03:08:29/03:08:32, 03:13:43/03:13:48, 03:18:08/03:18:12).
Realtime is not a delivery guarantee, and the wake drain only re-reads on boot,
reconnect or a failed read, so nothing else started the dealer.

## Fix (root)

`GameServer` now re-reads its pending `late_registration` wakes every 5 s and
runs the same direct admission a frame runs (`admitCapacityTablesOnLateRegistrationWake`,
shared by the frame, the drain and the recheck). It only starts dealers for
receipts the database already committed with seated entrants, is idempotent
per receipt, never requests or acknowledges a sweep, and keeps every gate of
the direct path. Realtime stays the primary path; a lost frame now costs at
most about 5 s instead of a full sweep.

## Law

`server/src/tournament/aSeatedLateRegistrationTableNeverWaitsForALostFrame.law.test.ts`
(registry `docs/laws.d/a-seated-late-registration-table-never-waits-for-a-lost-frame.md`).
