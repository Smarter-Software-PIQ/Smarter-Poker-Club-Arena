# Bomb Pots Every Thirty Minutes

Owner direction, 2026-11-06: "FOR BOMB POTS, LETS CHANGE IT SO THE SPINNING WHEEL ONLY APPEARS EVERY 30 MINUTES. SO 2 BOMB POTS AN HOUR."

The bomb pot wheel is the timed scheduler's announce: inside the last three minutes of a timed interval the clock becomes "Bomb Pot In 1-5 Hands" and the wheel reveals that count. One wheel per bomb, so the interval is the whole rule. Every cash game with bomb pots on, Lightning and must-move, every variant, now runs them every thirty minutes (1800 seconds), replacing the PLO twelve-minute and NLH ten-minute cadences.

Migration `20261106202537_bomb_pots_every_thirty_minutes` changes the four owners together, each guarded by an md5 of its installed image and an exactly-once anchor: `fn_cash_template_defaults` (new games default to `timed_30m`), `fn_cash_game_create_impl_20260905` (accepts the token), `fn_cash_cluster_open_table` and `fn_cash_apply_ruleset` (map `timed_30m` to 1800). It moves every open, non-retired bomb game's snapshot to `timed_30m` and projects only `bomb_pot_trigger_mode`/`bomb_pot_interval_seconds` onto their live tables; scheduler state, armed bombs, antes, boards and money are untouched. Engines read configuration at hand boundaries, so no engine restart is needed. The client vocabulary gains `timed_30m` ("Every 30 Minutes").

Regression: `tests/bomb-pots-every-thirty-minutes.law.test.ts`.
