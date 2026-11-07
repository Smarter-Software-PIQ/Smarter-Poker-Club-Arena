# The lobby card always shows the late-reg countdown

Dan, 2026-11-06, with a screenshot of the Nightly 10K reading "Late Reg Open"
beside the 25 Chip Daily Rebuy counting "Late Reg Ends In 26:05": "the 10k
nightly isn't showing the late reg ends in, just late reg open. fix it so it
always shows the count down".

## Cause, read from rows

Production row `66eb539e` (Nightly 10K, 2026-11-07 01:00 UTC):
`add_on_available = true`, `late_reg_mins = 90`, `late_reg_levels = 9`,
`addon_period_ends_at = null`. `lateRegEndMs` returns the stamped add-on end
for every add-on event and null until the engine stamps it, which only
happens when the add-on minute begins. So a rebuy-and-add-on event had no
countdown for its entire late registration. The 25 Chip Daily Rebuy has no
add-on, so it took the level/clock path and counted.

Two smaller blanks had the same shape: a later level with no
`level_started_at` yet, and an unreadable blind structure, both answered null
even with a 90-minute clock configured.

## Fix

`lateRegCountdownEndMs` (new, `src/components/lobby/lateRegWindow.ts`) starts
from the strict `lateRegEndMs` and, only when that is null while late
registration is still ahead, estimates: the level/clock boundary that opens
the add-on minute, a missing level stamp from the actual start plus the levels
already played, and the configured minutes for an unreadable structure. Never
from a scheduled start that has not happened; never past the boundary, for a
finalized pool, or a closed window.

`mttPhaseText` (every lobby card and list row) counts to it. Its
Open/Closed wording still reads the strict deadline, so an estimate running
out never announces Registration Closed. `lateRegEndMs` is unchanged: the
Details tab, the at-table call to action and the starting ticker keep printing
no invented wall-clock time.

Pins: the Nightly 10K row in
`tests/registration-stays-open-through-addon.law.test.ts`; the level-stamp
estimate re-pinned in `tests/unit/mttScheduleUpgrade.test.tsx`.
