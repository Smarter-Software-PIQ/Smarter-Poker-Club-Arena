# Late Register prints on two lines

Dan, 2026-11-06: "FIX THE 'LATE REGISTER' BUTTONS. IT SHOULD SAY, 1ST LINE
'LATE REGISTER' 2ND LINE X LEVELS REMAINING (NO "") MAKE SURE THE FONT ON THE
2ND LINE IS SLIGHTLY SMALLER SO IT FITS."

The tournament lobby's header and footer late-registration plates rendered one
string, `Late Register (2 levels remaining)`, which wrapped wherever the fit
broke it: "LATE REGISTER (2 / LEVELS REMAINING)".

`TournamentRegisterButton` now takes an optional `subline`. With one, it prints
the label on line one and the subline on line two at 0.8em, no brackets; both
ride the same `--fit` so the pair shrinks together on a narrow plate. The
accessible name is "Late Register, 2 Levels Remaining". Minutes windows and the
add-on window use the same second line ("15 Mins Remaining", "Open Through
Add-On").

Checked: header (168px) and footer plates at 393px for 1, 2 and 30 levels,
minutes and add-on, all inside the painted face. Tests updated in the same
commit: `tests/components/TournamentRegisterButton.test.tsx`,
`tests/unit/tournamentSnapshotRecovery.test.tsx`.
