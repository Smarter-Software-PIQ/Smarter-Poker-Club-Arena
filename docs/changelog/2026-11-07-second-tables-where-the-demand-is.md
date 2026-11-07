# 2026-11-07 - Second tables where the demand is, a weekend, names on the list, live counts

Owner request 06:46 CST: "GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF
THESE".

1. **Second tables where the demand is.** `fn_cash_game_second_table_picked`
   weights the hour's rate by the game: NLH and PLO4/5/6 from 0.25 to 2 big
   blind x1.3 (cap 90); big blind 5+ or FLH, FLO8, PLO8, Short Deck, Pineapple a
   quarter. Integer arithmetic, mirrored exactly by `secondTableRateFor` /
   `secondTablePicked` (fixture read from production for every variant).
2. **The room has a weekend.** Bands gain `peak` (Fri/Sat 18-23 and the 0-3
   hours of those nights: 55% full, 70 second-table rate) and `dawn` (Mon-Thu
   4-9: 22% full, 15). Every band still seats 75% (pinned).
3. **A horse leaving a line puts its name down elsewhere.** When its patience
   runs out it is the first pick for another full game's line in the same
   cycle, never straight back into the line it left.
4. **Names behind the count.** `fn_cash_game_lobby` returns the waiting list
   in join order with display names (up to 30, live rows only); the on-table
   lobby shows a Waiting List section above the Must Move List.
5. **Live counts.** `trg_cash_game_waitlist_broadcast` sends `{game_id}` on
   `cash-game-waitlist` for every list change; the lobby re-reads its counts
   within a second. The poll stays as a net, at one minute (was 20 s).
6. **Must-move shows on Classic.** No code change was needed: the felt's move
   notice and the lobby's Must Move List follow the database, which has
   answered `never_moves_players = false` for every game since
   20261107070717 (verified on live Classic games).

## Delivery order

Items 4 and 5 are in `20261107140215` and install on merge (no engine needed).
Items 1 and 2 change the rule the engine mirrors, so `20261107124911` is
dispatched only after an engine containing this PR's `secondTablePicked` is
serving; until then the database and the serving engine keep agreeing on the
previous rule.
