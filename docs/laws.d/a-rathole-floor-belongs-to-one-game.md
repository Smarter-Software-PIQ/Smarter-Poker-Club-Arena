# tests/a-rathole-floor-belongs-to-one-game.law.test.ts

Dan, 2026-11-18: a stack won in one cash game (PLO5 1/2 Madness) may not be carried into another cash game at the same variant and stakes (PLO5 1/2 Lightning Games). The law reads the latest definition of fn_cash_rejoin_floor, fn_cash_session_close and fn_cash_game_barred_seconds and requires that the rathole floor and the VPIP bar are matched by `game_scope` (the cash game, from fn_cash_game_scope_of_table) and never by club + variant + sb + bb, and that the horse fleet's rejoinTableKey produces the same key.
