# omahaHiLoTournamentFirstIn: PLO8 out-of-position realization measured, replay re-run (still NOT MET)

Docs only. `docs/horse-option-authority.d/omahaHiLoTournamentFirstIn.md`.

The first replay of this option (#11597) failed its PASS-BAR with fixed 0 and newly wrong 35. All 35 were big-blind calls priced with Auditor E's out-of-position realization 0.72, a Hold'em constant never measured for PLO8. Under a declaration written before any number was computed (sha256 `ae2867be...`, operations Mac evidence folder `plo8-oop-realization/`):

- Production held 14 qualifying PLO8 two-player tournament pots (declared minimum 400), so the realization was measured on the league engine: 24,000 hands at 8, 12, 16 and 20 bb, big blind with the option on, small blind today's brain, every pot re-settled hi-lo. R = 1.0133, standard error 0.0364, 4,004 pots (12 bb 0.978, 16 bb 1.046, 20 bb 1.001; 8 bb has no uncommitted call). Constant: 1.01.
- Auditor PLO8-HU-FI-A2 (A1 with only that constant changed) on the same 430 decisions and the same replay (harness at `5bfaa38d0e0c`, scorer `d6b032d3204`): fixed 0, newly wrong 0, changed 248, all unjudged. The replay bar passes; there is no audited gain. The first row stays in the file beside the second, each labelled with its constant.
- Found while measuring: the league pays every PLO8 pot to the high hand only (`playHand` settles with `scoreOmahaHi` and has no low half). The three significant league runs for this option (+36.54, +35.80, +38.92 bb/100) therefore measure a high-only game. The measurement script re-settled hi-lo and checked its high-only re-settlement against the league's net on all 24,000 hands (0 mismatches).

Status stays Evidence NOT MET: no activation order is recorded, and no league row measures the hi-lo game. No hold lifted, no switch row written, no source change.
