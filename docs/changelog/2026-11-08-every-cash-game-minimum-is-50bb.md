# 2026-11-08: Every cash game's minimum buy-in is exactly 50 BB

Dan: "MAKE THE MINIMUM BUY INS 50 BB FOR ANY AND ALL CASH GAMES." Asked whether
Lightning keeps its 100 BB minimum, he chose "Every game exactly 50 BB".

## Before (measured on production)

- Open games' rules (`cash_games.ruleset_snapshot->>'min_buyin_bb'`): 93 at 40
  (Classic), 35 at 100 (Lightning and some Classic), 29 at 50, 2 at 400.
- About 120 live tables in open games; 112 not at 50 BB.
- `fn_cash_template_defaults` wrote 40 for Classic and 100 otherwise; the create
  screen offered a 10-400 BB minimum slider; the game editor accepted any typed
  minimum; the club info page printed an unused club column (20 BB).

## The fix at the root

`atomic_table_buyin` enforces `tables.min_buy_in`, and each game's rules project
onto its tables, so the database is the rule:

- `fn_cash_template_defaults`: 50 for every template.
- `zz_cash_game_floor_from_template` (already forcing the template's ante, VPIP
  floor and bombs on every snapshot write) forces the template's minimum too.
  No creation override, edit or script can save another.
- `fn_update_managed_game`: a table's minimum is derived as big blind x 50.
- Open games re-saved through the trigger; their rules projected onto their live
  tables with `fn_cash_apply_ruleset`. The file asserts zero open games and zero
  live tables off 50 BB, or rolls back.

Screens: the create flow prints "Minimum Buy In: 50 BB" instead of a slider;
the game editor's minimum is read-only and follows the big blind; the club info
page prints 50.

Untouched: maximums, seated stacks (a player below 50 BB keeps the stack; the
next buy-in or rebuy is held to 50 BB), closed games, retired clubs, tournaments
and the closed Diamond Arena. The game server's `CASH_MIN_BB` fallback (40, used
only for a row with no minimum, which can no longer exist) is unchanged: it also
defines the horses' certified strength-benchmark populations. Horses read each
table's own minimum, so they follow 50 BB immediately with no engine release.

## Proof

A rolled-back dry run on production of the re-save and projection: 126 open
games re-saved, 111 table rows updated, 0 live tables left off 50 BB.
Pinned by `tests/every-cash-game-minimum-is-50bb.law.test.ts`.
