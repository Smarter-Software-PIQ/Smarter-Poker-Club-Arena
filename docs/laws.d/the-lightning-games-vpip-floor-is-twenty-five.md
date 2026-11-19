# tests/the-lightning-games-vpip-floor-is-twenty-five.law.test.ts

Every Lightning game, No Limit or PLO, keeps a 25% VPIP floor, and that number
is the Lightning Games template's own answer rather than a value on a game or a
table.

Dan ruled on 2026-11-19 at 1:38 PM Chicago: "LOWER THE VPIP IN LIGHTNING GAMES
TO 25% ACROSS THE BOARD FOR ALL LIGHTNING GAMES, NO LIMIT OR PLO". Migration
`20261119195413` carries it.

A Lightning game is a `cash_games` row of the Lightning Games format
(`template_name` `madness`, historical `action`) in a variant Lightning deals:
nlh, plo4, plo5, plo6. Its floor was never stored as a setting.
`fn_cash_template_defaults` answered 40 for every non-Classic template, and
every other place copies that answer: `fn_cash_game_create_impl_20260905` into
the game's `ruleset_snapshot` (a caller who sends another floor is refused),
`fn_cash_game_floor_from_template` on every later snapshot write,
`fn_cash_cluster_open_table` into a new table's `maintain_percent_min`, and
`fn_cash_apply_ruleset` onto every open table of the game on every cluster
tick. The engine reads the table row. Twelve table rows changed by hand would
have been put back to 40 by the next tick, so the migration moves the template
and lets the copies follow.

Two things keep 40 on purpose. A legacy Action or Madness row in a variant
Lightning does not deal (plo8, flo8, flh, short_deck) is not a Lightning game.
And Madness without Lightning, a Classic game with `rules_profile`
`madness_without_lightning`, borrows the madness template's ruleset in the
floor trigger; that branch now states its own 40, so the PLO5 Madness games
keep the floor of 2026-11-17 and cannot follow Lightning down. The window (ten
hands), the judgement with no grace, the eviction and the two-hour bar did not
change.

The law reads the newest definition of `fn_cash_template_defaults` and
`fn_cash_game_floor_from_template` from that migration on, whichever file holds
it, and works the template's floor out of the SQL `CASE` arm by arm. A later
migration that re-seeds the Lightning format at another floor, moves a Classic
floor with it, or drops the Madness branch's own 40 fails here. On the
migration itself it pins both pre-images, recomputes the md5 of the two bodies
the file carries and requires the post-image checks to name them, requires the
rows to be chosen by format columns and never by a name, and requires the
install to refuse itself if the transaction wrote any game or table that is not
a Lightning row, changed any rule but the floor, or left an open Lightning game
or table on another number. On the client it pins `LIGHTNING_VPIP_FLOOR`, the
format card, the lobby note and the table badge, and that no Lightning engine
module states a floor of its own.
