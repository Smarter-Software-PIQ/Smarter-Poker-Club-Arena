# tests/an-owed-leave-alone-at-its-table-plays-on-in-its-game.law.test.ts

Dan, 2026-11-06 (Hit And Run): hands owed in profit are owed to the game, not the table, in a game that moves its players (migration 20261114160836, `fn_owed_leave_plays_on_in_game`).

A held leave alone at its table keeps its obligation while a compatible table deals. Compatible means the same cash game, club, variant and blinds, live, with two players in. The game's own must-move executor then moves the seat with its stack and session.

The keep:

- is engine-only;
- never applies to a forced exit or a Classic game;
- is bounded from the first keep: ten minutes while every compatible table is full, thirty while a chair is open;
- moves no chips;
- records every answer, with source, destination and reason, in the service-role-only `ca_owed_leave_decisions`.

The engine asks before the per-table waiver, and `scripts/qualify-owed-leave-plays-on.mjs` proves it before and after in CI. People and horses alike.
