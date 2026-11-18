# A rathole floor belongs to one game, not to a stakes level (2026-11-18)

## Ruling

Dan, 2026-11-18 01:12 CT: "WOOWOO CAN NOT TAKE HIS BALANCE FROM A PLO5 MADNESS GAME, INTO A PLO5 LIGHTNING GAME. THEY ARE NOT THE SAME GAME (EVEN THOUGH THEY ARE THE SAME GAME AND STAKES). DO NOT ALLOW THE GAMES TO CONVERT LIKE THAT AGAIN, HE SHOULD OF ONLY BEEN ABLE TO BUY IN FOR 400 MAX AT THIS 'NEW GAME'."

Global ruling, 01:54 CT: "HE SHOULD OF NEVER BEEN ALLOWED TO TAKE HIS STACK FROM A CLASSIC GAME TO A LIGHTNING GAME. THEY ARE DIFFERENT AND MAKE SURE THAT THIS IS A GLOBAL RULE THAT DON'T GET BROKE AGAIN FOR ANY STAKES. CLASSIC AND LIGHTNING ARE TREATED AS SPERATE GAMES EVEN IF THEY ARE THE SAME GAME AND STAKES." The source game is named "PLO5 1/2 Madness" but its `cash_games.template_name` is `classic`. The key is the cash game, so every template is a separate game at every variant and stakes level.

Also 01:54 CT: "ADMIN'S SHOULD NEVER REMOVE A PLAYER FROM A GAME". The removal below was the wrong remedy; the fix is the door, not a kick. (01:51 CT: "LET HIM PLAY AND FINISH TONIGHT".)

Follow-up, 01:15 CT: boot him off the table after the logic is fixed, with a message that he can buy back in for a maximum of 400.

## What happened (read from production rows)

- 05:31:25 UTC: WooWoo left `PLO5 1/2 Madness Feeder` (cash game `050f0735-1eac-45b3-90f8-3e50ab72dc04`) with 3,762.18. `fn_cash_session_close` wrote a two-hour rejoin floor of 3,762.18.
- 07:04:53 UTC: he sat in `PLO5 1.00/2.00 Lightning Games Feeder` (cash game `f67a1436-e842-4b49-8644-3e184bd77ba6`, buy-in 100-400). `fn_cash_rejoin_floor` matched the Madness floor because `cash_rejoin_constraints` was keyed club + variant + sb + bb, and every buy-in path (`atomic_table_buyin`, `fn_poker_diamond_buyin`, `fn_cash_effective_buyin`, `fn_ca_cash_entry_need`) raises the table maximum to `GREATEST(max_buy_in, floor)`. He was forced to bring 3,762.18 into a 400-max game.

The same key also meant a VPIP bar earned in one game barred the same stakes in every other game (Classic, Action, Madness, Lightning).

## Root fix

`20261118071741_rathole_floor_is_per_game_not_per_stakes.sql` (applied directly at 07:17:41 UTC while the player was seated - an active incident - and recorded here byte for byte; md5 `7284b7ff2db96cb88335fdf641e520a6`):

- `fn_cash_game_scope_of_table(table_id)`: the one definition of "which game is this table": `cluster:<cash_games.id>` for a must-move / Lightning cluster, otherwise the table's own scope.
- `cash_rejoin_constraints.game_scope` added and backfilled from each row's `source_table_id` (230 live rows, all had a source; 0 left unscoped), with index `(player_id, game_scope, expires_at)`.
- `fn_cash_session_close`, `fn_cash_rejoin_floor` and `fn_cash_game_barred_seconds` match on `(player_id, game_scope)` only. Grants are named in the file.
- The horse fleet's mirror (`server/src/services/HorseRejoinConstraints.ts`, read in `HorseFleetManager`) keys on the same string, so horses are neither refused at a door the database opens nor sized to a floor the database no longer applies.

Verified on production after apply: WooWoo's floor at the Lightning table read `NULL` (entry need 100.00, max 400.00); his Madness floor still read 3,762.18 at the Madness table, so the rathole rule inside a game is unchanged.

## The removal

- 07:22 UTC: removed through the engine's own `POST /admin/kick-occupancy` (occupancy `e06f4d34-8f38-47f0-9b4d-a2c5dff6c06b`, seat 4). The engine finished the Lightning hand in progress and cashed him out at 07:23:14 UTC: 2,856.13 returned to his wallet. `fn_unaccounted_seat_exits()` shows nothing for this exit.
- The kick's cash-out wrote a 2,856.13 floor scoped to the Lightning game only (the new key working). That one row (`80f5450b-6e60-4fcf-b605-307263c5380e`) was deleted so his buy-in back into Lightning is the table's 100-400, per the ruling. His Madness floor was left in place.
- Notification `f616a799-5816-4072-a09e-4231f0fae741` sent to his inbox: removed because the Madness stack carried into Lightning, the two are separate games, 2,856.13 returned to his wallet, he can buy back into Lightning for a maximum of 400.

## What the removal actually did (read after the fact)

The kick's own cash-out wrote a 2,856.13 floor for the Lightning game (correct under the new key: it is the same game). WooWoo re-sat at 07:23:33 UTC, 19 seconds after the cash-out and before that row was deleted, so the door required 2,856.13 and he re-entered with it. The notification promising a 400 maximum reached him after he had already re-sat. Per the 01:51 and 01:54 rulings he was left to play.

## Global sweep (2026-11-18 07:55 UTC)

Every public function joining on variant + stakes across games was read: `fn_cash_apply_ruleset` and `fn_cash_game_join` (route a join to a game's canonical Lightning game; the player buys in fresh there, no stack carries), `fn_poker_diamond_plain_cash_table` (a table matching its own game), `fn_lightning_match_plan` and `fn_sp_digest_player_totals` (seating order and reports). None moves a stack or a floor between games. Engine and horse code reach the floor only through `fn_cash_rejoin_floor` / `rejoinTableKey`; the client reads `fn_cash_effective_buyin`.

## Pins

- `tests/a-rathole-floor-belongs-to-one-game.law.test.ts` (registered in `docs/laws.d/`) reads the newest definition of each reader and writer and refuses the stakes key coming back.
- `server/src/services/HorseRejoinConstraints.test.ts` carries WooWoo's case as a regression: a Madness floor does not exist at the Lightning key.
