# 2026-11-07 - Every game is a must-move game, and the room follows the clock

Dan, 01:05 CST: "NO ALL CLASSIC GAMES ARE ALSO MUST MOVE GAMES. THEY JUST DON'T
MOVE TO LIGHTNING. EVERY SINGLE GAME IS A MUST MOVE GAME, IF THEY ARE LABELED AS
'LIGHTNING' THEY CONVERT WHEN ENOUGH PLAYERS JOIN." and "GO AHEAD AND FULLY
BUILD, FIX AND ENHANCE ALL OF THESE".

## Every game is a must-move game (supersedes the 2026-10-24 Classic exception)

- `fn_cash_game_never_moves_players` answers false for every game. The tick,
  balancer, join door, on-table lobby and cash_seat_moves trigger all read it,
  so Classic feeders feed their Main again, short tables break into others, the
  join door fills the feeder last and the lobby shows the Must Move List.
  Lightning conversion is unchanged (cash_games.lightning_enabled).
- The 63 enabled games still at must_move = false (all empty Classic games) are
  set to must_move = true, so the tick manages their tables.
- The board mirror and lobby card follow: a Classic card says MUST MOVE.
- The 2026-10-24 law test is retired; `tests/every-game-is-a-must-move-game.law.test.ts`
  replaces it.

## The room follows the clock

- Table shapes by Chicago hour: evening (18-23) 50% full / 35% short, day
  (10-17) 40/40, late night (0-3) 30/45, early morning (4-9) 25/45; the rest
  sporadic. Every band seats at least 75% (pinned).
- Second tables: `fn_cash_game_second_table_picked` - 60% of games in the
  evening, 50% day, 30% late night, 20% early morning, per game per three-hour
  bucket. The engine's `secondTablePicked` is its exact md5 twin (fixture read
  from production).
- Line length by demand: popular stakes (0.25 to 2 big blind) carry 2-5 horses
  in line, other stakes 1-3, one shorter late at night and early morning.

## Second tables fill and drain naturally

- Past the dealable two, a second table gains one horse per cycle.
- When a game stops being picked, nobody new sits at its second table, the
  union plan's second-table allowance lapses (so the rotator walks its horses
  out at hand boundaries), must-move draws the rest up to the Main as seats open,
  and the tick closes it once empty. Never a Lightning game, never a table a
  person is playing at.

## Lobby

- A running game with a second table and a list reads "2 Tables · Waitlist 3".

## Stale entries on game lists

The 19-hour-old human entries were never offered a seat because nothing stood a
horse up for a game list (fixed in #9799's engine part, live from the 04:00
release). Once offered, an absent player's 60-second hold expires and their
entry leaves the list on the existing offer path, so the count stays honest
without a sweep (CLAUDE.md 10.12).
