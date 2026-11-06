# Favorites Never Jump The Tournament Clock (2026-11-05)

Dan, 16:58 Chicago, with screenshots of the MTT board: tonight's events had
disappeared or shifted down, and starred tournaments 22 hours (and days) out
were listed above events starting in 22 minutes. "FAVORITES THAT START MORE
THEN 24 HOURS OUT, SHOULD NOT BE DISPLAYED." 17:04: "REGISTRATION CLOSED,
'RUNNING' TOURNAMENTS SHOULD ALWAYS 100% OF THE TIME BE ON THE BOTTOM AS WELL."
17:07: "MAKE IT SO 'FAVORITES' ONLY SHOW WHEN THEY ARE 18 HOURS AWAY FROM
STARTING, NOT 24."

## Cause

Migration 20261105183133 made a star follow the schedule, so one star lights
every future edition of that schedule. `prioritizeTournamentFavorites` (the
October 31 favorite tier) floated every starred row above the rest of the
board, and `dateSection` gave them their own "Favorites" heading. Tomorrow's
and later editions sat above tonight's board, and on the ALL tab they filled
the ten-event MTT cap, so tonight's events were cut off entirely.

## Fix

- `src/components/lobby/tournamentFavoriteOrder.ts`: a scheduled MTT favorite
  never floats; it keeps its place in the chosen order (by default the start
  clock). Seat-first favorites (Spins, Sit N Gos) still float below host pins.
  A starred MTT that has not started and starts more than 18 hours out is not
  displayed (`withoutFavoritesBeyondHorizon`), applied on the board's ticking
  clock in `LobbyTable` and before the ALL tab's cap in `ClubHomePage`.
- `runningLast`: a registration-closed MTT (status Running) is moved to the
  bottom after every sort path, pin and tier, under one "Running" heading.
- The "Favorites" date heading is gone from the MTT board.

Pinned by `tests/a-favorite-never-jumps-the-tournament-clock.law.test.ts`;
`tests/unit/tournamentFavoritePriority.test.tsx` and
`tests/unit/allTabScope.test.ts` updated to the new rule in the same commit.
