# A full game always has a waiting list, or one chair open

Dan, 2026-11-22, with a screenshot of a six-max PLO5 Madness table reading
"TABLE FULL · 5 WAITING": "Horses need to join waiting lists. All games should
not be 'full with no waiting lists' in fact there should always be one-seats
open if there is no waiting lists correct that logic and functionality for No
Limit Holdem games. MAKE SURE THIS FUNCTIONALITY IS FULLY UPDATED AND
CORRECTED."

The rule: a cash game is never full with nobody on its waiting list. Either it
has a list (horses on it exactly as people are), or one chair is open.

## How it works today (read from the code)

- A horse joins the GAME list, `cash_game_waitlist`, the list a person's Join
  door (`fn_cash_game_join`) writes. `HorseFleetManager.syncHorseGameQueues`
  inserts a `waiting` row; the database stamps `created_at`, and
  `fn_offer_open_seat` calls names in that order, horses and people alike. A
  horse answers its call in `claimOfferedSeats`. Planned by
  `HorseGameQueue.planHorseQueues`: only while every live table of the game is
  full, one new name per game per 30-second cycle, never on Lightning.
- The cluster tick (`fn_cash_cluster_tick` / `_uncapped`) offers open chairs to
  the list one name at a time and opens a second table: six-max on two buyers,
  full ring (7 to 9 handed) on four names, moving the last two to sit.
- The plate under a full table (`ClusterWaitlistCallToAction`) prints the game
  list's count from `fn_cash_game_lobby`. Nothing in it reads a variant.

## Why Hold'em, and why not PLO

Nothing names a variant. The difference is table size. The Classic Hold'em
games are nine-handed; the PLO5 game in the screenshot is six-max.

1. **The full-ring feeder branch ignored the hourly table cap.** Since
   2026-11-16 the hourly cash policy refuses a horse a seat at a new table when
   the floor is at its cap. The six-max (buyer-driven) feeder branch was taught
   to ask that cap first on 2026-11-18 (`20261118165301`); its header says the
   full-ring branch was left "unchanged". So at the cap a six-max game kept its
   line ("5 WAITING"), while a nine-handed game with four names opened a feeder
   nobody could sit at: both bump moves were refused, the four waiting horses
   were called to its chairs, their sixty-second holds lapsed, a lapsed call
   leaves the list (`20261023094000`), and the Main stood full with nobody
   waiting until the line regrew, about every eight minutes. Migration
   `20261121174545` records it on exactly four games, all nine-handed Hold'em
   (.05/.10, .10/.25, .25/.50 and 1/2), and guards the full-ring branch.
2. **In every size, the chair came first and the line was a later cycle's
   job.** The seat stage filled a table to its last chair; the line was asked
   for only when a later cycle reached that table as "physically full", behind
   every gate of the seating walk. A withheld cycle, an hourly refusal or an
   empty pool left the game full with nobody waiting, and each drained line
   put it back there.
3. **A full Main with a short feeder read "Table Full · 0 Waiting".** After a
   feeder start the game has open chairs (at the feeder) and, correctly, no
   list; the plate on the Main printed an empty list instead of the seat.

## What changed

Engine (live at the next engine cutover):

- `server/src/services/HorseLastChair.ts` (new, pure). The fleet no longer
  buys a game's LAST open chair on its own. When the seats a table is about to
  take would fill the game (every live table of it counted, planned arrivals
  included): if the game already has a list the seats stand; if a horse is free
  to wait, the chair is taken AND the line is asked for in the same cycle; if
  nobody is free to wait, the chair stays open. A two-seat table still takes
  the second player it needs to deal. Lightning games (no list, owner
  2026-10-24) are not judged.
- `HorseFleetManager.ts`: the verdict is the last trim before a seat is bought;
  the cycle spends a per-game count of open chairs as it seats; a game that
  filled this cycle pushes its queue ask at once, and `syncHorseGameQueues`
  counts this cycle's seats so the planner sees the game as full now.
  Counters: `last_chair left_open=N paired=M` on the cycle line, and
  `last_chair_left_open` in the opening-feeder diagnostic.

Client (publishes on merge, needs no engine):

- `WaitlistCallToAction` / `ClusterWaitlistCallToAction`: a full table whose
  game has a chair open at another live table, with nobody waiting, reads
  "Table Full · N Seats Open In This Game / Join The Game" (the database's own
  `open_seats`, which already leaves out held chairs). A real list still
  prints its count; a game with every chair taken still offers the list.

SQL: none. The database half of the cause is `20261121174545`, already on
main; this change adds no migration and needs none installed first.

## What is unchanged

Must-move, the full-ring feeder start (four names, last two to sit, held
chairs until the feeder has seven), six-max feeders, one name called at a
time, the lobby status ("2 Tables", never "Waitlist N"), a person on the list
emptying the horse line and being yielded a chair, Lightning, the hourly table
caps and paced arrivals, and every admission rule. No horse is stood up, no
person is refused a chair, and nothing reads who is a horse to give anyone a
different deal. Not a sweep or a repair job: the rule is in the seat decision.

## Not covered, stated plainly

All three are closed by `2026-11-22-a-called-name-keeps-its-place.md`.

- A person who takes the last chair fills the game; the next fleet cycle
  (30 s) puts a name on the list.
- A table the hourly cap has marked excess gets no new names (the seating walk
  skips it before the ask); it keeps the names it has until they give up
  (25 to 55 minutes) and is being closed.
- Under the cap, a new feeder admits one horse per 2 to 4 minutes while a seat
  call holds a chair for 60 seconds, so some of a full-ring game's four names
  lapse off the list instead of sitting. The game has open chairs then, so the
  rule holds, but it is a horse losing its place to pacing. Not changed here.

## Pinned by

- `server/src/services/aFullGameAlwaysHasAWaitingList.law.test.ts`
  (`docs/laws.d/server-src-services-aFullGameAlwaysHasAWaitingList.md`): the
  invariant after every cycle of a simulated fleet for all nine cash variants
  at every size 2 to 9, with and without a horse free to wait; the verdict
  exhaustively; the wiring order; that the rule reads no variant, style or
  handedness; and the two feeder guards that explain Hold'em.
- `tests/unit/clusterWaitlistCallToAction.test.tsx`: the plate.
- Pins moved in the same commit: `HorseGameQueue.test.ts` (the sync call
  gained an argument) and `HorseSitVerdict.test.ts` (a fifth counted skip).

Real-time law: no new event; the existing `cash-game-waitlist` broadcast
re-reads the count when a horse's row is inserted.
