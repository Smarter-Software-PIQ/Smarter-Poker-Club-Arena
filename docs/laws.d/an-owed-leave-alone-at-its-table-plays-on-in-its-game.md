# tests/an-owed-leave-alone-at-its-table-plays-on-in-its-game.law.test.ts

Dan, 2026-11-06 (Hit And Run): hands owed in profit are owed to the game, not the table, in a game that moves its players (migration 20261114160836, `fn_owed_leave_plays_on_in_game`).

A held leave alone on a feeder keeps its obligation while a compatible live Main deals. Compatible means the same cash game, club, variant and blinds, with two players in. The seat stays sat out as its blind off and only its pending flag is withdrawn. The game's own must-move executor then moves it with its stack and session.

The keep:

- is engine-only;
- never applies to a forced exit or a Classic game;
- is bounded from the first keep: ten minutes while every compatible table is full, thirty while a chair is open;
- moves no chips;
- records each change of answer, with source, destination and reason, in `ca_owed_leave_decisions`, which `service_role` can only read.

The engine asks before the per-table waiver, and `scripts/qualify-owed-leave-plays-on.mjs` proves it before and after in CI. People and horses alike.
