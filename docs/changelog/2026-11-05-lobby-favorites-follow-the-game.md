# Lobby favorites and filters are durable account preferences (2026-11-05)

Dan: favorites and filters are durable account preferences whose saved values
change only through the account owner's explicit action or authorized account
deletion.

## Root causes (measured on production)

1. **Tournament stars pointed at one run.** Every scheduled event creates a new
   tournaments row per run; all 25 stored stars sat on finished runs while 2-31
   live runs of the same schedule showed unstarred.
2. **Cash stars pointed at one table** (`favorite_tables`, cascade on delete),
   and a rebuilt table is a new row.
3. **Filters were saved under "nobody" once the access token expired**: owner
   came from the token's freshness, not the signed-in account.
4. **Every save rewrote the whole snapshot**, so a stale device or a replayed
   older save overwrote newer choices and settings nobody touched.
5. **A background reset**: switching to cash games rewrote the saved status
   filter to All.

## Identity (migration `20261105183133`)

- Scheduled tournament: its `tournament_schedules` id. Every run and every edit
  of the schedule keeps it; a different schedule with the same name stays
  separate.
- Sit N Go / Spin: the engine board, i.e. its catalogue name within the owner
  club and union. All 388,704 unscheduled SNG/SPIN rows in 30 days came from
  the engine catalogue (96 boards), which keeps a board by exactly that key.
  Stack, speed and clock edits keep the board; a buy-in change is a different
  board (as in the engine). A club's own one-off reusing a board's name does
  not inherit. A catalogue rename must add `lobby_game_aliases` rows; the law
  test pins the name templates.
- Satellite: the recurring event it feeds plus its format, never its name.
- Cash: the `cash_games` definition. Rebuilt tables keep it; a new definition
  reusing the old name does not inherit unless an alias says so.

A saved favorite is never removed by a finished run, a closed or deleted table,
an empty schedule, a filter or a failed read. With nothing live there is just
no lobby row to light; the saved choice stays selected and lights again.

## Ordering: server revisions, not device clocks

Each saved field (one filter tab, the tab, the Favorites chip, one sort, one
page preference, one favorite) carries a revision from one database sequence.
A change states the revision it was made against and applies only if that is
still current; otherwise it is refused as a conflict, the device shows the
account's value and reports "Changed On Another Device". The first change
accepted against a revision wins; a later change made against the same older
state is refused, never silently applied. Unfavorites are kept with their
revision, so an older offline star cannot return. A duplicate retry is refused
with a value equal to what was sent and reads as saved. Only changed fields
are sent.

## Ownership

Browsers can only read `player_lobby_favorites`, `user_lobby_filters` and
`user_page_preferences`. Writes go through `fn_set_lobby_favorites`,
`fn_save_lobby_preferences` and `fn_save_page_preferences`, which act for
`auth.uid()` only (derived by PostgREST from a verified JWT). A guard refuses
every other write, including service-role and cleanup paths, and refuses
TRUNCATE; rows are deleted only by the cascade from deleting the account
(possible only for the auth admin or a database superuser).

## Application

- `src/lib/preferenceSync.ts`: account-bound queue per owner and scope; sends
  only while that owner is signed in (store and live session); renews an
  expired session once before retrying; "Saving" until acknowledged, "Saved"
  after, "Not Saved / Retry" on failure, nothing pending discarded.
- Lobby filters, view and favorites use it; page preferences and the roster
  workspace use `src/lib/pagePreferenceSave.ts`. Pending changes survive
  logout and are sent only when their account signs back in.
- `PreferenceSaveStatus` shows the state on the lobby.

## Legacy favorites

`lobby_favorites_migration_report` records every legacy favorite as mapped,
duplicate or unresolved. Production before migration: 25 tournament entries
(19 distinct per player and schedule) and 12 cash entries, all resolvable.
Legacy sources are left untouched. Earlier cash stars deleted by the old
cascade cannot be recovered: `favorite_tables` recorded 13 deletions with no
way to tell an unstar from a cascade.

## Pinned

`tests/lobby-favorites-follow-the-game.law.test.ts`,
`tests/unit/preferencePersistenceScenarios.test.ts` (18 application
scenarios), and the native proof `scripts/dev/test-lobby-favorites-postgres.sh`
(42 checks, CI workflow `lobby-favorites-are-durable.yml`).

## Production proofs follow the new save path

The production browser proofs used to wait for a direct row write to
`user_page_preferences` / `user_lobby_filters`, which no longer exists. They
now accept a change only when the owner's own call to the save function
answers that the account holds it (`tests/e2e/support/preferenceSaveProof.ts`):
the tab proof, the seat-count and filter audit saves, the Notifications
filter, and the tournament favorite journey. The favorite journey now also
expects every live run of the chosen event's schedule to be starred with it,
and after the unfavorite and a reload, the game is kept as unstarred.

## Follow-up: the save queue survives a full browser storage

Production proof verify-lobby-filters (run 42121413754) showed "Changed On
Another Device" after quick sort taps. The gateway log for that run had every
save answered 200, yet the second tap went out against the revision from
before the first and the third tap was never sent. The queue kept its pending
choices and acknowledged revisions only in localStorage; when the browser
refused a write (storage full), the write was dropped and the next read
returned the older stored copy. preferenceSync now keeps a session copy of any
record the browser refuses, so the queue stays correct for the session; a
successful write or a removal retires it. Pinned by "a device whose storage
refuses writes" in tests/unit/preferencePersistenceScenarios.test.ts, which
fails on the previous code (nothing was sent at all).
