# A called name keeps its place, and a full game asks for its line when it fills

Dan, 2026-11-22: "Horses need to join waiting lists. All games should not be
'full with no waiting lists' in fact there should always be one-seats open if
there is no waiting lists ... MAKE SURE THIS FUNCTIONALITY IS FULLY UPDATED AND
CORRECTED." Then: "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND
FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN
AND TESTED BEFORE CLAIMING SUCCESS."

This finishes what `2026-11-22-a-full-game-always-has-a-waiting-list.md`
(#11773) listed under "Not covered".

## The rule

A player keeps their place in line until they are offered a seat they can
take. Arrival order is the order, people and horses alike. A cash game is never
full with nobody waiting.

## What the hourly pacing gates, decided once

The hourly cash policy (2026-11-16) does two jobs. Its table cap limits how
many horse tables run each Chicago hour, which is what keeps weekly horse cash
rake in budget. Its two 2-4 minute clocks (the floor's start clock and a new
table's arrival clock) space the fleet's own unsolicited seating so a new game
assembles gradually.

- The cap gates every horse start of a new table and every horse arrival at a
  table it is closing. Nothing else.
- The clocks gate the fleet's own unsolicited purchases. They never gate the
  game's own seating: a name the list called to this table, or a sanctioned
  move inside the game (must-move, a full-ring feeder start's bumps, a break).
  That seating is spaced by the game itself (one name per table at a time,
  20 s apart; moves at a hand boundary), and it still restarts both clocks, so
  the next unsolicited start or arrival still waits its window.
- A person is never gated, as before. A person who sits at an empty table
  still gets horses one at a time, inside the 3-7 minute fill.

## Defects, causes, fixes

### 1. Called names lapsed off the list at a new feeder

- Cause: `fn_cash_hourly_table_admit` (20261116194028) refused every horse
  arrival at an assembling table inside its 2-4 minute window
  (`cash_hourly_horse_arrival_paced`), called names included. The seat call
  (`fn_offer_open_seat`) holds a chair for 60 seconds, so the second to fourth
  names of a full-ring feeder were refused, the hold lapsed, and a lapsed call
  leaves the list (20261023094000). The engine also skipped every call at a
  table the hourly projection did not admit (`claimOfferedSeats` was handed
  `tables.filter((table) => hourlyAdmissions.has(table.id))`), so even an
  answerable call there was never answered.
- Fix: migration `20261123013241_a_called_name_keeps_its_place_under_the_hourly_cap.sql`.
  The admission treats a live call to this table and a sanctioned move as the
  game's own seating and skips the arrival clock for it. The engine
  (`HorseFleetManager.ts`, the `claimOfferedSeats` call) answers every call;
  the database re-checks every seat.

### 2. The second bumped player of a full-ring feeder start was refused

- Cause: the same arrival clock. The second of the last two players moved off
  a full nine-handed Main 1 is a one-way move into a table that is still
  assembling. The first bump could be refused too: the opener
  (`fn_cash_hourly_feeder_admissible`, 20261121174545) counts empty opening
  feeders against the cap and the admission did not, so an unrelated start
  took the feeder's slot (`cash_hourly_table_cap_reached`) or stamped the
  floor clock (`cash_hourly_table_start_paced`) between the feeder opening
  and its first move.
- Fix: same migration. Sanctioned moves skip the arrival clock; a called name
  or move into an empty FEEDER the opener admitted skips the floor clock (and
  restarts it); a new start counts empty opening feeders other than its own
  table against the cap, exactly as the opener does, and the fleet's
  projection (`fn_cash_hourly_table_admissions`) counts the same, so the fleet
  does not try a start the database will refuse.

### 3. A table the cap is closing was called to a horse it would refuse

- Cause: `fn_offer_open_seat` called the first name in line whatever the
  hourly policy would say; at an excess table a horse is refused, the call
  lapsed and the horse lost its place behind the person it was ahead of.
- Fix: new `fn_cash_hourly_call_admissible(table, user)` answers whether the
  admission would seat this player if called here now (only the cap can say no
  to a called horse; a person is always yes). `fn_offer_open_seat` asks it in
  both candidate loops and passes a refused player over for this seat only,
  place untouched, the same rule as its wallet check. With nobody it can seat
  it answers `hourly_cap_passes_over` instead of `nobody_waiting`. The
  throughput cohort producer (`fn_lightning_admission_policy`) counts the new
  predicate as its thirteenth input.

### 4. A person taking the last chair left the game full with nobody waiting

- Cause: the line was asked for only by the 30-second fleet cycle, and only
  when that cycle reached the table.
- Fix (engine): the two seat events the engine already hears now raise
  `noteCashSeatCommitted` (`server/src/cluster/cashSeatCommittedSignal.ts`)
  when the table is full: the player's client reporting its committed buy-in
  (`ServerTableEngine.noteSeatArrival`, state `seated`) and the hand boundary
  adopting a roster that gained a player (`ServerTableEngineBase.adoptSeatRoster`).
  The fleet (`HorseFleetManager.lineOnSeatCommitted`) reads that one game
  fresh and, when every live table is full and nobody is waiting, puts one
  horse on its list now (`HorseLineOnArrival.lineOnArrival`, which uses
  `planHorseQueues` itself). The horse comes from the last completed cycle's
  sittable pool for that game, at most three minutes old, still free and on
  duty. No timer, no sweep, no new cron: one event, a few reads, one row.

### 5. A full table the cap is closing got no new names

- Cause: the seating walk skipped every table the hourly projection left out
  (`if (!hourly ...) continue;`) before the full-table queue ask.
- Fix (engine): `HorseQueueAdmission.hourlyAdmissionForWalk` gives a
  physically full table the projection left out a line-only admission; the
  walk's queue-only path buys nothing (`countOnly`) and asks for the game's
  line. No feeder churn: the opener still refuses a feeder over the cap, and
  the seat call passes a horse over at a closing table (defect 3), so the name
  waits until a seat it can take opens (a person at the table protects it).

### 6. Patience could empty a full game's list (found in the sweep)

- Cause: `planHorseQueues` cancels a horse's row after 25 to 55 minutes so the
  names rotate. When no free horse could take its place that cycle (the pool
  spent, the walk withheld), a full game's last name left and the game sat
  full with nobody waiting.
- Fix (engine): the last name of a full game stays until a free horse can take
  its place; never a horse seated anywhere, off duty, past its comparable
  lists, or for a game that wants no horse line.

## The sweep (every variant and size)

Nothing in the seat path names a variant: NLH, PLO4/5/6, PLO8, short deck,
hi-lo, pineapple and fixed limit at every size 2 to 9 run the same code, which
the laws simulate for all of them. Classic, Action and Madness differ only in
whether the game moves players (Classic never does), and the rules above do
not read that. Lightning keeps its own no-list rule (Oct 24 ruling) and is
never given a line. Remaining refusals of a call that are not pacing and are
left as they are, stated plainly: a horse off duty does not answer (it is
leaving every line anyway); the host's seat ceiling (the player curve) and the
variety-first hold on an empty extra table (2026-11-18) still decline a call,
which then lapses. A heads-up (2-seat) table still takes its second player
with nobody free to wait, because one player cannot be dealt (#11773).

## Install order

SQL: functions only, no hot-table lock, no install window. Signatures and
result types unchanged, so it is safe while the current engine runs: on
install the database lands both bumps of a feeder start and stops calling a
horse to a chair it would refuse; the current engine still skips calls at a
paced table until this engine goes live at the next three-hourly cutover. The
new engine against the old database is only refused at the door, as now; no
money moves on a refusal. The migration does not touch `fn_cash_cluster_tick`
or its uncapped copy, so it is independent of PR #11790 in either order.

## Pinned by

- `scripts/ci/test-a-called-name-keeps-its-place-postgres.py` (required server
  shard 1, beside the hourly caps proof): production's recorded bodies rebuilt
  on a disposable PostgreSQL; a full-ring feeder start at the last table under
  the cap (both bumps move, all four names sit in order, none expires), a
  floor clock set after the feeder opened, a six-max heads-up start, a closing
  table with a horse and a person in line, the autonomous clocks kept, the
  call predicate agreeing with the admission at every kind of table, the
  cohort input, privileges and replay refusal. Every scenario is red on the
  installed bodies first.
- `server/src/services/aCalledNameKeepsItsPlace.law.test.ts`
  (`docs/laws.d/server-src-services-aCalledNameKeepsItsPlace.md`).
- `scripts/ci/test-hourly-cash-caps-postgres.py` keeps pinning 20261116194028
  as installed, with a note pointing here.
