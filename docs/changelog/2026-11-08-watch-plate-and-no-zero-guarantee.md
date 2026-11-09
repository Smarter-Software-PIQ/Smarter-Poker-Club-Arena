# 2026-11-08 - WATCH wears the plate, and no event ever says "0 GTD"

Dan, verbatim: "MAKE THE WATCH BUTTON LOOK AND FEEL LIKE THE OTHER BUTTONS ON
THE PAGE. IT LOOKS VERY CHEAP, FLAT AND BORING. AND IF A TOURNAMENT, SIT N GO
OR SATELLITE DOESN'T HAVE A GUARANTEE, IT SHOULD NEVER SAY 0 GTD REMOVE THAT"

## WATCH

The tournament lobby's WATCH was a bare accent outline beside the painted Late
Register plate. It now renders through `TournamentRegisterButton`, the same
rendered chrome-and-blue-glass plate, type and press as Late Register. Class
`btn btn-watch` is kept so the e2e watch spec still finds it.

## "0 GTD"

The client never prints a guarantee label for `guaranteed_prize = 0`. The
"0 GTD" was inside the stored tournament NAME, copied from three owner-weekly
satellite schedules ("40 Chip Freezeout - 0 GTD (NLH) Satellite 5"). 11 rows
held it (8 registering, 1 running, 2 completed).

Migration `20261108201826_tournament_names_never_say_zero_guarantee.sql`:

- `fn_ca_text_without_zero_guarantee(text)` removes only a ZERO guarantee
  phrase; "1.5K GTD", "10 GTD", "1,000 GTD" are untouched (asserted in the
  migration).
- Trigger `ac_tournament_copy_never_says_zero_guarantee` applies it to name,
  description and short description on every insert/update, so every future
  spawn is stored clean.
- `fn_ca_text_without_dollar`, the one copy rewrite the lifecycle guard admits
  on a registered event, now also applies it; the guard still refuses every
  other name change.
- The 11 existing rows are rewritten once through that admitted edit. Names
  only; no money, status, guarantee or contract column is written.
