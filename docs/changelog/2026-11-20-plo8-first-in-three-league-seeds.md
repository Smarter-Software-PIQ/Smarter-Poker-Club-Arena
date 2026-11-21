# The PLO8 heads-up first-in option is significant on three league seeds

2026-11-20, Antigravity Coordinator (Claude session 01UxDLnH).

`docs/horse-option-authority.d/omahaHiLoTournamentFirstIn.md` now records all three runs of the card
`plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb` made with the single-card runner (PR #11534), arm A
`{"omahaHiLoTournamentFirstIn":true}` against arm B `{}`, plo8, two seats, 12 bb, tournament, mirror field,
6000 pairs (12000 hands) each:

| seed | bb/100 | stderr | verdict |
| --- | --- | --- | --- |
| 20261120 | +36.54 | 4.92 | SIGNIFICANT |
| 20261121 | +35.80 | 4.90 | SIGNIFICANT |
| 20261122 | +38.92 | 4.93 | SIGNIFICANT |

0 illegal actions and 0 truncated streets in every run. The runs read no database, so the solver stores were
empty; a nightly league row may differ. No 8 bb or 20 bb card exists for this option.

Nothing is switched on. The file stays Evidence NOT MET: the replay on real audited decisions is still not run,
and no audited PLO8 heads-up tournament decision set exists in the repository.

**Note (2026-11-21):** every PLO8 figure above from the evaluation league (`server/src/benchmark/HorseLeague.ts`, `playHand`) came from the high-only league, which paid every hi-lo pot to the high hand with no low half; it needs re-measurement on the league with hi-lo settlement (`settleLeagueShowdown`, `docs/changelog/2026-11-21-league-pays-the-low-half.md`).
