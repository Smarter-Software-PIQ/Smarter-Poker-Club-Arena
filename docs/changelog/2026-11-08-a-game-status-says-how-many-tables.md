# A game's status says how many tables, not the waiting list

2026-11-08. Dan, with a lobby screenshot showing "2 Tables · Waitlist 3":
"STATUS SHOULD JUST SAY HOW MANY TABLES NOT 'WAITLIST 3' UNDER IT. PLAYERS
WILL JOIN A WAITING LIST."

## What changed

- `clusterRunningStatus` (`src/components/lobby/lobbyEntries.ts`) prints only
  the table count for a running must-move game: "2 Tables", "13 Tables", or
  "Running" for one table. The waiting-list count is no longer part of the
  label. The status key is still `running`, so the card keeps its Join Game
  door, which puts the player on the game's list.
- `premiumStatusBadge` passes through only `N Tables` for a running card, so a
  stale "Waitlist N" label can never reach the pill.
- `tests/a-full-game-shows-its-line.test.ts` now pins that no running status
  ever prints a waitlist.

Unchanged: a single non-game cash table that is full still says
"Waitlist N" (its key is `waitlist`, which drives the Join Waitlist button).
The list itself, its counts and its live broadcast are untouched.

The feeder-start rules Dan described in the same message (moving the last two
players to sit on a full nine-handed game to a new feeder once four are
waiting, and when feeder players move up) are a separate seating change and
are not part of this commit.
