# Lobby favorites and filters stop forgetting themselves (2026-11-05)

Dan: "WHEN A USER MARKS HIS FAVORITES FOR TOURNAMENTS OR CASH GAMES, OR SETS
THEIR FILTERS ... IT SAVES FOR A COUPLE HOURS, OR MAYBE A DAY, BUT THEN THEY
ALWAYS SEEM TO SILENTLY FAIL OR SILENTLY DEFAULT BACK ... ONCE SET, IT CAN
NEVER EVER EVER CHANGE UNDER ANY CIRCUMSTANCES UNLESS THE USER PHYSICALLY GOES
IN AND CHANGES IT."

## Why every earlier fix regressed

The saves worked. Each earlier fix hardened the save (ordering, retries,
cross-device rows) while the thing being saved was attached to something that
does not last. Three causes, measured on production the same day:

1. **Tournament stars were stored against one run.** `lobby-tournament-favorites`
   held tournament ids, and every scheduled event inserts a new `tournaments`
   row for each run. All 25 stored stars pointed at a completed, cancelled or
   about-to-finish run while 2 to 31 live runs of the same schedule showed
   unstarred. One player had re-starred "Afternoon Free Buy" on four separate
   days.
2. **Cash stars were stored against one table.** `favorite_tables.table_id` has
   `ON DELETE CASCADE` to `tables`. A cash game rebuilt by its owner (new row,
   same game) left the star on the closed table, and deleting the old row
   deleted the star.
3. **Filters were saved under "nobody" once the login token aged out.**
   `AdvancedFilters` and `lobbyViewPrefs` resolved the owner with
   `readLocalSession()`, which returns null once the hour-long access token has
   expired (normal on a phone or a backgrounded tab between refreshes). A filter
   tapped in that window was written to the signed-out key and never sent to
   `user_lobby_filters`, so the next fresh load showed the older choice.

## The fix

- `player_lobby_favorites` (migration `20261105183133`): one row per player per
  GAME - `schedule:<id>` for scheduled tournaments, the club + type + name for
  unscheduled series, the club + name for cash games. No foreign key to any
  table or tournament row. A guard trigger refuses every DELETE except the
  player's own unfavorite or account deletion, refuses identity UPDATEs and
  refuses TRUNCATE. Clients cannot write the table; `fn_set_lobby_favorite` is
  the only write path and `fn_my_lobby_favorites` returns every live row of
  every starred game. Every existing star was carried forward.
- `src/components/lobby/lobbyFavorites.ts` is the single client door; the lobby
  and Quick Join both read it, and a failed read keeps the stars on screen.
- Filter and view ownership now comes from the signed-in account in the user
  store, falling back to the token only before the store loads.

## Pinned

`tests/lobby-favorites-follow-the-game.law.test.ts` (registered in
`docs/laws.d/`). Dry-run against a local Postgres fixture: backfill, live-run
matching, rebuilt-table matching, refused cleanup delete and truncate, star
survives table deletion, unfavorite through a sibling run, account cascade.
