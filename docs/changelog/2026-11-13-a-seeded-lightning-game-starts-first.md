# A Seeded Lightning Game Starts First (2026-11-13)

Owner order, 14:56 Chicago: "THE 1/2 HORSES NEED TO BE PLAYING THE 1/2 LIGHTNING
FOR HOLDEM AND PLO AND WE NEED TO GET THE .50/1.00 LIGHTNING RUNNING FOR HOLDEM
AND PLO. HORSES NEED TO FOLLOW THEIR DAILY SCHEDULE AND MAKE SURE THAT WE ARE
FOLLOWING THE ORGANIC PLAYER FLOW ... HORSES MUST FOLLOW THERE DAILY SCHEDULES
AND DAYS OFF. MAKE SURE THIS IS FULLY IMPLEMENTED AND VERIFIED".

## What was measured (read-only, 15:06 to 15:20 Chicago)

- The serving engine is `53360840` (started 02:08 Chicago). #10723 (the seat
  ceiling and the five newly seeded Lightning games) merged at 12:49 Chicago and
  its migration `20261113175242` is installed, but an engine change serves only
  after a cutover, so none of it is running yet: `/health`
  `horseWorkSchedule.lastCycle.supply` has no `seats` or `seatCeiling`.
- Floor: 242 horse bodies (exactly the body cap) held 855 cash seats, 3.5 each.
  The seat ceiling in #10723 would be 532 at that minute.
- Lightning NLH .50/1, PLO4 .50/1, NLH 1/2, PLO4 1/2 and PLO5 1/2: enabled,
  0 players each. Lightning NLH .25/.50 and PLO4 .25/.50: running.
- Work schedule and days off (live since `08c27924`): since 02:08 the engine
  sent 1,063 horses home (691 shift over, 356 daily cap, 16 rest day). Of the
  242 seated bodies, 5 were on their rest day and 14 past their daily cap.
  Nine of those 19 are the trapped Lightning seats below and three sit at FLO8
  .25/.50 Madness tables that are not dealing (below); the rest had passed
  their cap within the last few minutes.

## The gap this change closes

Being allowed to sit is not being seated. The seeding walk ranks an occupied
Main 1 ahead of an empty one and every feeder last, and under #10723 it stops
at the host's seat ceiling. Lightning PLO4 .50/1 holds one table, a feeder, so
it stood behind every other open chair on the floor; the four seeded Main 1
tables stood behind every occupied Main 1.

`lightningStarterTables` (HorseUnionCashPlan.ts): until a horse-seeded
Lightning game holds one full ring (6), one of its tables (the fullest, then a
Main before a feeder, then the lowest id) is seated straight after a
short-handed person and ahead of the ordinary order. One table per game, so it
forms a ring that can turn into Lightning. Order only: the seat ceiling, the
work schedule, bankroll and every admission guard are unchanged.

Test: `server/src/services/aSeededLightningGameStartsFirst.test.ts`.

## Found and not fixed here: a Lightning leave that can never complete

Fifteen horse seats in the two running Lightning games are sat out with a
pending leave, the oldest for 60 hours, five of them created on the serving
engine today. Each owes 7 to 10 hit-and-run hands and has been dealt none
since. Cause, read from the code and the rows:

1. A leave asked during a live Lightning hand is queued
   (`queueDepartureBehindLightningHand`): `fn_request_seat_departure` marks the
   seat `is_sitting_out` and `leave_pending`.
2. After that hand the cash-out is refused because hands are owed in profit
   (`fn_cash_leave_check`), and `onLeaveRefusedAtSettlement` holds the leave.
3. `fn_lightning_player_legality` answers `CASHOUT_PENDING` (and
   `fn_lightning_anchor_is_live_eligible` false) for a seat with
   `leave_pending` or a sit-out, so the pool never deals it again, the owed
   hands are never played, and `releaseLeavesHeldByClock` waits for ever.

The between-hands path (`holdLockedLeave`) avoids this by not sitting a
Lightning anchor out; the queued path does not. It applies to a person the
same way. It is in the Lightning leave path and the matcher's legality, which
this change does not touch; it is reported to the Lightning lane with these
facts. Nothing was written to any seat, session or wallet.

## Found and not fixed here: FLO8 .25/.50 Madness tables seated and not dealing

Game `0bc9bdf3`: Main 1 (`f9b14107`, status `waiting`) has held six funded,
sat-in horses since its last hand at 00:55 Chicago; Main 3 (`b43ddcc7`) and
Main 4 (`433e947a`) last dealt at 04:21 and 04:11, minutes after the daily
thaw; Main 2 (`ebcff453`) at 14:48. `/health` reports 0 stalled tables and 10
undealable. A horse cannot leave a table that never reaches a hand boundary,
so three of these seats are past their rest day or cap. Reported to the table
liveness owner with these ids; nothing was written.

## Not changed

No migration. No fee, wallet, admission, schedule or curve value. The curve
itself (peak 18:00 to 23:00 Chicago, night ceiling 03:00 to 08:00) is #10723's
and the September curve's, unchanged.
