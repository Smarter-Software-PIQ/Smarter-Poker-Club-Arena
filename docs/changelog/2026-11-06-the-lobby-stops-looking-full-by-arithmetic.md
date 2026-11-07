# 2026-11-06 - The lobby stops looking full by arithmetic

Dan, 20:40 CDT: "GAMES SHOULD NOT BE ALWAYS MAXED OUT WITH THE EXACT AMOUNT OF
PLAYERS PLAYING AS ARE ALLOWED IN THE GAMES. THERE SHOULD BE SOME GAMES WITH TWO
TABLES RUNNING AND THE MUST MOVE LIST, AND HORSES SHOULD BE ON THE WAITING
LIST... IT LOOKS FAKE WHEN THERE ARE THE EXACT MAX AMOUNT OF PLAYERS ON EVERY
GAME, AND ZERO PLAYERS ON THE WAITING LIST. FIX THIS AT ONCE."

## Measured before the change (production, 2026-11-07 ~02:45 UTC)

- 14 of 15 occupied Classic must-move games sat at exactly `max_players`.
- 0 of 68 enabled cluster games had a second live table.
- The only rows on any game list were three HUMANS (GottiLeardi, Rubdznuts,
  3Putt) behind full horse tables, waiting up to nineteen hours, never offered
  a seat.

## Causes, each read from the code

1. `HorseFleetManager` forced `seatTarget = table.max_players` for every
   Hold'em and PLO table after `occupancyTargetFor` had answered. That threw
   away the sparse shape AND the humans-waiting subtraction.
2. Horses were barred from every waiting list (2026-09-02 rule).
3. `fn_cash_cluster_tick` caps tables at `greatest(1, floor((cap_mains+1)*0.2))`
   since the owner's November 2 supply cut: one table for every game, so a full
   Main 1 could never grow a second table.
4. `HorseGameWaitlistYield.gameListNeedsYield` skipped ordinary must-move games
   because "their tick opens a feeder for the list" - which cause 3 made
   impossible. So nothing stood a horse up for the three people.

## What changed

- `occupancyTargetFor` (engine): three shapes per table per 3-hour bucket -
  FULL 40% (every seat plus a 1-4 horse line), SHORT 40% (one or two seats
  open, re-rolled every 20 minutes), SPORADIC 20% (two seats to two short).
  Expected occupancy ~85%, so the 2026-09-02 "at least 75% of seats" floor
  holds. A human waiting still opens a seat on every shape and empties the
  horse line.
- The forced-max line is gone.
- `HorseGameQueue` + `HorseFleetManager.syncHorseGameQueues` (engine): horses
  join `cash_game_waitlist` only while every live table of the game is full,
  one arrival per game per cycle, each giving up after 25-55 minutes. Never on
  Lightning (no waiting list there, Dan 2026-10-24) or disabled games. Table
  lists stay horse-free.
- `gameListNeedsYield` counts every enabled game, so a person on a game list is
  always owed a chair.
- Migration `20261107030430_some_games_run_a_second_table.sql`: about half the
  games (re-chosen per game every three hours) may hold two tables. The OPEN
  rule is unchanged (a full floor and two buyers). Classic still never moves
  its players. Also adds `fn_cash_game_waiting_counts(uuid[])`, counts only.
- Lobby (client): a running must-move game shows "Waitlist N", else "N Tables",
  else "Running". The key stays `running` so the card keeps Join Game.

## Delivery

Engine changes activate only at the 04:00 America/Chicago window (owner
direction 2026-11-06). The migration and the lobby publish as soon as they merge.

## Follow-up: the second table gets seated

After #9799's migration went live, three games opened a second table within a
minute (NLH 1/2, NLH 0.50/1, PLO4 0.25/0.50 Classic) and every one sat at 0
players. The November 4 union cash plan (`horseUnionCashTableAllowed`) admits
horses only at a game's Main 1 "to prevent the fleet multiplying a slot into
feeders". `horseCashPlanSecondTables` now names ONE second table per game
(a feeder or a Main 2) whose Main 1 horses may sit at, and that table inherits
its Main 1's answer in the fleet's seating, offer and rotator paths. The tick
still allows at most two tables, and forbidden variants and the stake ceiling
still apply.
