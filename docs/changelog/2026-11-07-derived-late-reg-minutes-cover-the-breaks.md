# Derived late-reg minutes cover the breaks

Dan, 2026-11-06: "FINISH THIS UP YOURSELF, STOP ASKING ME TO DO WORK YOU CAN DO!"
Found while making the lobby countdown honest (#9769, #9777, #9793).

## Cause, read from the database

`zzzzzzzzzz_tournament_level_clock_floor` (fn_ca_tournament_level_clock_floor)
runs last on every INSERT and rewrites `late_reg_mins` to the nominal length of
the entry levels. `fn_tournament_late_registration_open` closes an ordinary
event at whichever comes first of its levels and those minutes. The hourly
break stops the level clock (measured: about ten minutes; 152 breaks resumed a
median 627 s after :55), but the nominal minutes run on through it. So an event
whose window crossed a break closed entry before the last level it advertises.
130 upcoming events carried the derived value; the Sunday 200 Deep Stack (12
levels, 120 minutes, two breaks) would have closed about two levels early.

Not affected and not changed: Free Buys (their 60 minutes are the owner's hour,
set by the lock trigger as 12/60; it is the rule, not a derived cap),
levels-only schedules (minutes 0, owner 2026-10-28), add-on events (their
window alone decides admission), started events.

## Fix

Migration `20261107043847_derived_late_reg_minutes_cover_the_breaks.sql`:

- `fn_ca_late_registration_break_allowance(nominal)`: ten minutes per break
  the window can cross, settled over the window it grows to (60 -> +20,
  108 -> +30, 120 -> +30). Still a hard cap on a stalled level clock, which is
  what the minutes are for.
- The floor trigger adds it for break-taking MTTs (mtt-v1/mtt-v2,
  synchronized_breaks not false), never for Free Buys (flag or name with a
  zero buy-in). Patched in place with a drift guard (exactly one anchor) and a
  refusal if already applied.
- Upcoming rows still carrying the derived value move onto the rule through
  the guard's sanctioned `app.lock_level_clock` path.

## Proof before merge

- Production, read-only: the patch anchor matches the live function exactly
  once; the column types match; a self-aborting probe confirmed the guard
  admits the update only through `app.lock_level_clock`.
- PostgreSQL 16, with the live trigger and helper copied verbatim: the
  backfill moved only the derived break-taking row (Sunday 200 120 -> 150) and
  left a Free Buy (60), a no-break event, a started event and an explicit clock
  alone; new inserts gave 150 (12x10), 138 (9x12), 60 for both Free Buy forms,
  the nominal value for no-break and SNG events, 0 for a levels-only schedule;
  a second run refused; the live-proof expression returned true.
- `tests/unit/derivedLateRegMinutesCoverBreaks.test.ts` pins the shape.
