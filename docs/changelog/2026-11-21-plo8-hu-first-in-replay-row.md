# PLO8 heads-up tournament first-in: the replay on recorded decisions ran and failed its bar (2026-11-21)

Option `omahaHiLoTournamentFirstIn` (default OFF, no switch row). Docs only: no source, no switch list, no database write.

## What was done

- Read-only count of what production holds: 361 PLO8 two-player tournament hands in 11 tournaments (2026-11-12 to 2026-11-20), all Horse against Horse, 499 first preflop Horse decisions, 430 at an effective stack of 20 big blinds or less.
- No audit of such decisions existed. One was written and declared before it ran (auditor `PLO8-HU-FI-A1`: HVH48 Auditor E's preflop rule with hi-lo equity from the engine's own evaluators and the two population numbers measured on the set), placed with `server/scripts/hvh48-audit-nodes.py --set E` unmodified, replayed off against on with `server/scripts/audited-node-option-replay.ts` and scored with `server/scripts/audited-decision-replay.ts --placed` (scorer `d6b032d3204`).
- The scorer's row, unedited, is now in `docs/horse-option-authority.d/omahaHiLoTournamentFirstIn.md`:

  `- Replay: fixed 0; newlyWrong 35; changed 248; unchanged 182; unjudged 213; set PLO8HU-FI PLO8 2-player tournaments 20bb; scorer d6b032d3204; source placed verdict-only; arm on vs off; replayed 430 of 430`

## Result

Evidence NOT MET stays. The declared bar asked for newlyWrong <= fixed; the row has 35 newly wrong and 0 fixed. All 35 are big-blind folds of a 2 bb raise that the audit priced as correct folds and the option turns into calls. The 191 small-blind changes are all unjudged (0 newly wrong). The verdict on the 35 rests on Auditor E's 0.72 out-of-position realization, a Hold'em constant not measured for PLO8; at realization 1 all 35 would be priced correct calls. The authority file states this limit and what would produce a passing row.

The option is not in `OPTION_SWITCH_OFF_ONLY`: no owner preflop hold applies to it. It stays off because its evidence is not met.

## Where the evidence is

`antigravity-coordinator-01UxDLnH/evidence/plo8-hu-first-in/` on the operations Mac: the declaration, the auditor, the export query, the audit summary and the scorer log (sha256 in the authority file). The hand export holds the Horses' own hole cards and was kept off the repository and off the archive.

## Test

`server/src/engine/EveryHorseOptionRecordsItsReplay.law.test.ts`.
