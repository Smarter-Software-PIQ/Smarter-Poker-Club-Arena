# tests/every-cash-game-minimum-is-50bb.law.test.ts

Dan 2026-11-08: "MAKE THE MINIMUM BUY INS 50 BB FOR ANY AND ALL CASH GAMES", and asked about Lightning, "Every game exactly 50 BB". The law pins that `fn_cash_template_defaults` writes 50 for every template, that `zz_cash_game_floor_from_template` forces the template's minimum onto every game snapshot write (so no creation override or edit can carry another), that `fn_update_managed_game` derives a table's minimum as big blind x 50, and that no screen offers a minimum buy-in control.
