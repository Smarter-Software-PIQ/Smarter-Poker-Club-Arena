# 2026-11-22: Invite To Game holds a seat for your friend

A player, texted to Dan: "The crazy river is always on the table, even when
you invite someone. It doesn't open a new table." Dan: "FULLY BUILD, FIX AND
ENHANCE ALL OF THESE".

## What a player saw

Every open Spin and Heads Up board opens with one horse seated (the Nov 8
volume ruling, `SEAT_FIRST_OPENING_HORSES = 1`), and a Heads Up starts the
moment a person takes its other seat. So a player who invited a friend into a
Spin or Heads Up found the friend's seat already taken, or the game started
without them. The only seat hold that existed (Heads Up "Specific Player",
20261122025900) worked at an empty Heads Up table only, and nothing in the
seat doors read it: a held seat could be bought by anyone, a horse included.

## Fix

- **Invite To Game opens a private game.** `fn_invite_to_private_game`
  (20261123013126): a player not in the game gets a private copy of the same
  board (same club, union, format, stake, game, seats, satellite target),
  bought into through the normal seat door in the same transaction, so a failed
  buy-in leaves nothing behind and nobody is charged twice. A player seated
  alone makes that game private in place; one seated beside others holds the
  open seat(s). Heads Up holds 1 seat, a Spin up to 2.
- **The friend's link admits only them.** `fn_accept_private_game_invite`
  checks the token; anyone else is told the seat is held, before any money
  moves. Cancel releases the hold (`fn_cancel_private_game_hold`); unregister
  is the existing refund path.
- **The hold is a rule, not a suggestion.** `fn_private_game_entry_guard` is
  attached to `tournament_players` (20261123013136) and refuses a held seat to
  anyone but its invited holder, on every entry door. A horse is refused by
  the same line as a person; nothing reads `is_horse`. That trigger needs the
  daily maintenance break (`-- @install-window: daily-maintenance`), so it
  attaches at the next 04:00 Chicago window; until then the engine and the
  client honour the hold.
- **The hold lasts ten minutes of open play.** Every frozen second of an
  engine cutover is given back, so a break never costs the friend the seat.
  When it runs out, the inviter leaves, or the friend sits, the game is an
  ordinary board again. Nothing sweeps holds; liveness is computed where read.
- **Engine.** `privateGameHolds.ts` reads live holds; the seat-first lane and
  `topUpWithHorses` do not seat a horse into a held game, an unreadable answer
  holds the fill instead of filling, and a private game is not one of the
  board's horse-seeded instances, so the public board reopens beside it.
- **Client.** Invite To Game on the tournament page, lobby rows and cards, and
  the table menu offers the private game (`usePrivateGameInviteLauncher`,
  `PrivateGameInviteModal`); the table shows the held seat and time left, with
  Cancel; the friend's landing shows Take Seat.

Six and nine seat Sit & Gos were left out here, on the belief that a friend
could join one through the link. That was wrong: the field fills around the
people in it. They now hold seats too, by the same hold, in place:
`2026-11-23-a-sit-and-go-holds-seats-for-invited-friends.md` (20261123071654).

## How it is pinned

- `scripts/ci/test-private-game-holds-postgres.py` (CI: Private game holds):
  38 checks on a real PostgreSQL, including the red case, a stranger takes the
  held seat with the guard removed.
- `server/src/services/aSeatHeldForAFriendIsNotGivenToAHorse.law.test.ts`.
