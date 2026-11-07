# Late-reg countdown: breaks, the add-on minute, and every card that shows it

Dan, 2026-11-06, after the countdown fix (#9769, #9777): "GO AHEAD AND FULLY
BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND
TESTED BEFORE CLAIMING SUCCESS."

## What changed

**One projection, `src/components/lobby/lateRegCountdown.ts`.** Replaces the
`lateRegCountdownEndMs` added the same night (removed from `lateRegWindow.ts`,
which keeps only the strict `lateRegEndMs` the Details tab, the at-table call
to action and the root ticker rely on). It lives in its own module so the
ticker's entry chunk stays lean. It returns `{ endMs, phase }`:

- **Breaks.** The hourly synchronized break and the 04:00 Chicago freeze stop
  the level clock (the engine re-anchors `level_started_at` on release). The
  walk adds every pause still ahead. The break length is MEASURED: 152 breaks
  over 24 hours resumed a median 627 s after :55, and the Nightly 10K's clock
  stopped 01:55:00 to 02:05:04. At 03:55 Chicago the break runs to the
  maintenance end, so the freeze adds nothing on top for a break-taking event.
- **The add-on minute.** An add-on event's entry ends with its fixed 60-second
  add-on window (TournamentManagerBase.addOnBreakDurationMs), so the countdown
  runs to the last entry level plus that minute, then to the stamped end with
  `phase: 'add_on'`. While the hands drain after the last level it keeps
  counting to the level anchor plus the minute.
- **On a break**, it counts from the resume, not the frozen level clock.

Replayed against the Nightly 10K: from what the card had at 01:40 it now
projects 02:46:01; the real add-on window ran 02:46:49 - 02:47:49. Without the
break it said 02:36:01.

**Text.** `mttPhaseText` prints `Add-On Ends In m:ss` during the add-on minute
and `Add-On Starting` only when an add-on event is open with nothing honest
left to count (a drain longer than the estimate). `ClockFace` and
`tournamentClockLine` treat the add-on clock as a late-reg clock.

**Board status.** `tournamentStatus` passed `isInLateRegistration` a copy of
the row without the add-on fields, so from the last entry level to the end of
the add-on minute an add-on event read "Running" and dropped out of the
late-reg section while `fn_tournament_late_registration_open` still admitted
players. The add-on fields are passed through now.

**Lobby data.** The lobby query (ClubHomePage) and the tournament lobby page
read `on_break`, `break_ends_at` and `synchronized_breaks` (plus
`level_started_at` and `blind_structure` on the tournament lobby page).

**Tournament lobby card.** Counted nothing: a static "Open Through Add-On" or
"N Lvls Left". It now runs the same countdown every second ("Ends In",
"Add-On Ends In", "Add-On Starting"), and before the start says
"Through Lvl 9 + Add-On".

**Late-reg minutes on add-on events.** 118 of the next 120 add-on events carry
`late_reg_mins` (the writers derive it from the entry levels), but
`fn_tournament_late_registration_open` decides an add-on event's entry by its
add-on window alone. No screen prints those minutes while levels exist, and
the stored value cannot change admission, so it is left as written. The game
lobby panel's Late Reg row now says "9 Levels + Add-On" so it no longer reads
as if level 9 closed entry.

## Verified

- Unit: `tests/unit/lateRegCountdown.test.ts` (Nightly 10K replay, breaks,
  freeze across DST, drain, stamped minute, status), the add-on law test, the
  tournament lobby card render test and the game lobby panel render test.
- Rendered at 393px through the real `LobbyTable` with the four states.

## Found, not changed here

- The engine's break is five minutes from the last parked hand in code
  (GameServer.BREAK_DURATION_MS) but measures about ten from :55 in
  production. Engine behaviour; needs its own investigation.
