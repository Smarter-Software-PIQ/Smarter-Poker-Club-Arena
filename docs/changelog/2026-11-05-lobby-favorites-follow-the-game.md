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
4. **A stale replay could overwrite a newer choice.** A device holding an
   unconfirmed older change re-sent it on its next open, over whatever the
   player had chosen since on another device.
5. **Sanitizing wrote over saved values.** Values this build could not show
   (a preset or sort from another build) were dropped on load and the
   sanitized copy was written back on the next save, erasing them.

## The fix

- **Identity, never a name** (migration `20261105183133`):
  - a scheduled tournament is starred by its schedule, so every run inherits it
    and renames keep it (measured: schedules produce one tournament type and
    their names change only by the club editing the event);
  - a Sit N Go, Spin or unscheduled satellite is starred by its catalogue
    definition: club, union, type, game, variant, buy-in, fee, field and table
    size, speed, stack, spin type, format flags, and for a satellite the
    recurring event it feeds (measured: one live game per definition; the same
    name appears as up to four games across clubs);
  - a cash game is starred by its `cash_games` definition, which every live
    table belongs to and a rebuilt table keeps (measured: a table named
    "PLO5 1/2 Madness" belongs to the game "PLO5 1.00/2.00 Lightning Games",
    and a Classic game replaced a Madness game under the same name, so name
    matching would have starred the wrong game).
- `player_lobby_favorites` has no foreign key to any game row, so finished
  runs, closed tables and deleted tables never remove a star; a game with
  nothing live simply lights nothing until it runs again.
- **Owner-only, enforced by the database** on favorites, saved filters and page
  preferences: every insert, update and delete must be the signed-in owner's,
  except the cascade from deleting the account; TRUNCATE is refused. Measured
  first: only the player's own browser writes these tables, and their past
  deletions came with account deletions.
- **Newer choice wins, enforced by the database.** Every write carries the time
  the player made the choice, a replay keeps its original time, and an older
  choice never overwrites a newer one. After a replay the lobby reads the
  account back so the screen shows the newer choice.
- **Saved values are preserved.** Writes keep the stored value for anything
  the player did not change, so a value this build cannot show survives.
- Filter and view ownership comes from the signed-in account (user store),
  token only as a pre-load fallback.
- `src/components/lobby/lobbyFavorites.ts` is the single client door; the lobby
  and Quick Join read it; a failed read keeps the stars on screen.

## Pinned

`tests/lobby-favorites-follow-the-game.law.test.ts` (registered in
`docs/laws.d/`) and the native proof `scripts/dev/test-lobby-favorites-postgres.sh`
(27 checks, run in CI by `lobby-favorites-are-durable.yml`): carry-forward,
renames, no merging across clubs, variants, stakes or schedules, satellites,
finished runs and deleted tables, owner-only writes, refused server-side
rewrites and truncates, stale replays, and account deletion.
