# An empty board is not one of the eleven (2026-11-09)

## What the activated engine did

The waiting ladder went live on `bff6eed3` at 19:38Z (thaw). At 21:03Z, read
from production (SELECT only):

- 32 Spin and 16 regular heads-up boards REGISTERING, **every one with no
  entrant and no live seat**, created 06:24-08:16Z by the previous engine.
- 0 Spin or heads-up boards created since the thaw, and 0 started after
  19:42:55Z (the 33 starts before that were the expected one-time tail).

So no horse was sitting at any board, against Dan's rule: "SIT ONE HORSE AT
LIKE 11 DIFFERENT SPINS AND LIKE 6 SIT N GO'S".

## Why

`seatFirstBoardRoom` counted every non-feeder REGISTERING row. Under the ladder
an empty board never leaves REGISTERING: the fill lane tops up only
`paid > 0`, a held-empty board (`seatFirstHeldEmpty`, about 33% of Spins and
50% of heads-up) opens with nobody, and an unused board is parked rather than
cancelled at 3 AM (`20261108034940`). Room read 11-32 and 6-16, so the launcher
opened nothing. It does not converge: every later held-empty board would take
a slot the same way, for good.

## The fix

1. The eleven and the six count **opened** boards: at least one live seat on a
   table that is not closed, the same `paid` the fill lane reads.
2. `ensureBoardOpen` **reopens an owner's empty boards before creating any**:
   same type, never a satellite feeder, joinable. While an empty board exists,
   nothing new is created, even if its reopen was refused, so empty boards are
   consumed and cannot stack.
3. A reopen writes the board's opening rung (`seatFirstOpeningWindowMs`) to
   `start_time` first, on a still-REGISTERING row, and only then seats exactly
   one horse through `seedOpenSeatTable(..., reopening = true)`. If the write
   does not land, nobody is seated.

No new rows, no cancellation, no refund path and no repair job. The held-empty
roll at creation is unchanged; a board it leaves empty is reopened on the next
tick. Pinned by `server/src/services/anEmptyBoardIsNotOneOfTheEleven.law.test.ts`.

## Addendum 2026-11-10: a board nobody can open spends no budget

Measured on `840429a3` (live from the 04:00 Chicago release): the house opened
6 heads-up boards at 12:00Z, but only 5 Spins by 14:37Z, and none of the 48
old empty boards was reopened. All 48 belong to four certification fixture
clubs with zero horse members, and a club board seats only its own members.
Each failed reopen still spent one unit of the shared budget and rewrote the
board's window, so a fixture club drawn ahead of the house took the whole
tick. A reopen now asks the owner's pool (`pickFreeHorses`) first; with no
free horse it writes nothing, spends nothing and passes the turn. That owner
still creates nothing while it has an empty board.
