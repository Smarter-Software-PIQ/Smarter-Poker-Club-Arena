# The "Reg Closes In" compartment counts down at the table

Dan, 2026-11-10, with a screenshot of the Nightly 10K's spectating holder
reading "Reg Closes In / Open" under a running level 9: "THE 'REGISTRATION
CLOSES IN' BUTTON ISN'T WORKING OR FUNCTIONAL. IT SHOULD HAVE THE COUNT DOWN
CLOCK INSIDE OF IT."

## What was wrong

Not a dead button. `TournamentLateRegCallToAction` read the STRICT deadline,
`lateRegEndMs`, and printed the literal word "Open" whenever it answered null.

`lateRegEndMs` answers null for every ADD-ON event until the engine stamps
`addon_period_ends_at`, and `TournamentManagerBase.triggerAddOnPeriod` stamps
it only when the add-on window actually opens, which is after the entry levels
are already over. So for the whole of the registration window, the one stretch
where the clock is worth reading, the compartment had nothing to print.

Every add-on event was affected. The Nightly 10K in the screenshot carried
`add_on_available = true`, `addon_period_ends_at = null`, `late_reg_levels =
10` on level 10 of 10-minute levels: open, admitting, and showing no clock.

The lobby card beside it counted down correctly. It reads `lateRegCountdown`,
added for Dan's 2026-11-06 ruling ("FIX IT SO IT ALWAYS SHOWS THE COUNT DOWN").
The at-table holder was deliberately left on the strict deadline at the time
(2026-11-07 changelog) and so kept the defect the lobby had already fixed.

## The fix

`TournamentLateRegCallToAction` now picks its target the same way the lobby
card does in `mttPhaseText`: `lateRegCountdown` first, the strict `lateRegEndMs`
behind it, and only ever a target in the future.

- A running add-on event counts to its last entry level plus the engine's fixed
  60-second add-on window, breaks and the daily freeze included, labelled
  "Reg Closes In".
- Once the engine stamps the window the label becomes "Add-On Ends In" and the
  clock runs to the stamped end.
- While the hands drain past the estimate the compartment reads "Add-On /
  Starting" rather than inventing a second.

`lateRegEndMs` itself is unchanged, so the Details tab, the root ticker and
`tests/registration-stays-open-through-addon.law.test.ts` keep the strict
projection they rely on.

**An estimate may no longer retract the offer.** `lateRegCallToActionCopy`
returned null once the strict deadline elapsed, which hid the entry button
while `fn_tournament_late_registration_open` was still admitting players: a
stalled level clock or a drain longer than the projection took the offer away.
`tournamentEntryWindowOpen`, the mirror of the database predicate, is now the
only thing that withdraws it.

## Verified

- `tests/unit/tournamentSpectatingHolder.test.tsx`: three new cases on the
  production row shape, each confirmed to FAIL against the previous component
  and pass against this one.
- 112 tests green across the spectating holder, `lateRegCountdown`,
  `lobbyMttTitle`, `tournamentEntryWindowProjection`, `entryBundleStaysLean`,
  the add-on registration law and the no-waiting-list law.
- `tsc --noEmit`, eslint, prettier, `check:title-case`, `check:painted-text`.
