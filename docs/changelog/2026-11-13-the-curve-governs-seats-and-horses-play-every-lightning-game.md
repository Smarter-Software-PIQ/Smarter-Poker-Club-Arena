# The Curve Governs Seats, And Horses Play Every 1/2 Lightning Game (2026-11-13)

Owner request, 11:43 Chicago: split the 1/2 players across every game including
Lightning (and Lightning .50/1 for PLO and Hold'em); make the horses follow the
designed daily player curve; open the table pill with a tap on mobile; and the
Leave Next Hand button was missing from No Limit Lightning games.

## The daily player curve

- Measured 11:44 Chicago: 234 horse bodies held 823 seats (3.52 each) against a
  body cap of 185; 249 of the seats were at Hold'em. The body cap was enforced,
  but a body already seated could take table after table, and the lobby counts
  seats.
- The designed seats-per-horse band (1.6 to 2.2 by day, 1.0 to 1.3 at night) was
  only an alert. It is now a ceiling: `StableHand.hostSeatCeiling` = body cap x
  band maximum. The seeder (`hostAllowsNewBody`, `openPlannedTables`) stops at
  it, counting every seat it buys in the cycle, and the Stable Hand winds the
  room down to it (one stand per table per cycle, multi-tabled horses first,
  never thinning a table with a person below a real game; the executor's limit
  of four stands per host every 30 seconds).
- With the relaunched scale and 1,140 eligible horses the whole floor is held to
  roughly 300 seats at 10 AM, about 400 at noon and about 600 at the 6-8 PM
  peak, falling overnight.
- `/health` `horseWorkSchedule.lastCycle.supply` now also shows `seats` and
  `seatCeiling` per host.
- Law: `server/src/services/TheCurveGovernsSeats.law.test.ts`.

## Lightning

- Horses now start Lightning NLH .50/1, Lightning PLO4 .50/1, Lightning NLH 1/2,
  Lightning PLO4 1/2 and Lightning PLO5 1/2 (horseUnionCashPlan.json
  `lightningHorseSeeded`), alongside the two .25/.50 games. Every other
  Lightning game is still started by a person.
- Migration 20261113175242 switches on Lightning PLO4 .50/1 (off since
  2026-11-06) with the same Lightning rules as Lightning NLH .50/1, and removes
  the person requirement from the PLO4 1/2 Lightning horse guard
  (`fn_plo_lightning_horse_admit`); its 10-player cap, heads-up rescue and
  70-90 second pacing are unchanged.
- The rotator no longer winds a horse-seeded Lightning game down after its last
  person leaves (the fleet would only seat those horses again).

## Table controls

- The table pill opens its menu with a tap on the table you are at; a second
  tap closes it; a tap on another table's pill still switches tables.
- Leave Next Hand now shows on every Lightning-capable table to a seated player
  before Lightning starts, through the ordinary leave-after-this-hand.
