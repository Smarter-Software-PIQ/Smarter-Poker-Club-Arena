# The PLO8 heads-up first-in option gets its authority file, and two Lightning options get paired runs (2026-11-20)

Coordinator swarm of session 01UxDLnH. Docs only: no decision changes, no option changes state, no migration.

## omahaHiLoTournamentFirstIn

`docs/horse-option-authority.d/omahaHiLoTournamentFirstIn.md` is new. The option (2026-11-14, `docs/changelog/2026-11-14-plo8-heads-up-tournament-first-in.md`) is registered in the live switch and default OFF, but had no authority file, so no switch row could cite it. The file records, with sources, what the repository already holds: what the option does, its receipt and law test, the declared offline evaluation (SUPPORTED on seeds 94101 and 94202, quoted exactly), and one league card run of 2026-11-20 (seed 20261120, +36.54 bb/100, stderr 4.92, mirror field), with room for the further seeds. Status: Evidence NOT MET, Replay NOT RUN. What is still owed to reach MET is listed in the file: a declared PASS-BAR, an audited PLO8 heads-up tournament decision set, the scorer's replay rows, the recorded order to activate, and a live read with a declared rollback trigger.

## Lightning paired evaluation: two default-off options, a few cells (no status change)

Run 2026-11-20 on a 2-core cloud container shared with other agents, from `server/`, one niced process at a time, on this branch's base `271183034`. Neither option has an authority file or a `docs/horse-default-on.d` entry, so the runs are recorded here. Nothing is switched on and no file claims evidence met.

Command, per one-cell range (`<c>` the cell index):

```
LIGHTNING_EVAL_CONFIG=full LIGHTNING_EVAL_CELLS=<c>:<c+1> LIGHTNING_EVAL_CANDIDATE='{"<option>":true}' LIGHTNING_EVAL_OUT=/tmp/lightning-eval/<option> \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"
```

Configuration `full` (development seeds 20261114, 20261115, 20261116; 1,000 hands per cell and seed; baseline the seven style options served on 2026-11-14). Cell indices of the declared 270-cell matrix: 0 = nlh 4p 50bb all_horse, 4 = nlh 4p 50bb tag_regular (counter), 7 = nlh 4p 50bb unknown, 10 = nlh 4p 100bb all_horse, 14 = nlh 4p 100bb tag_regular (counter), 17 = nlh 4p 100bb unknown. Every range completed (marker written): 0 illegal actions, 0 illegal amounts, 0 chip-conservation violations.

**Not a declared pass or fail.** The gated merge (`LIGHTNING_EVAL_MERGE`) refuses a directory that is not the whole matrix ("is incomplete: cells 1 to 9, 11 to 13, 15 to 16, 18 to 269 of 270 are missing"), and the protocol's decision rule reads the full matrix and then the selection and final seeds. The pooled tables below are the harness's own `mergeLightningEvalPairs` and `lightningEvalMergeMarkdown` applied to the completed ranges only, copied unedited; they cover NLH 4-handed only and say nothing about PLO4, PLO5, 5- or 6-handed tables or 200bb.

### lightningParticipationHoldem

Cells 0, 10, 14, 17. Wall time per range: 332 s, 473 s, 371 s, 383 s. Cell 0 (50bb): 0 divergent decisions on all three seeds (the hold'em big-blind widening is zero at 50bb or less, `LIGHTNING_HOLDEM_BB_DEPTH_NONE_BB`). The whole VPIP gain at 100bb is big-blind calls (Q4 intended share 100%): +0.767, +0.4 and +0.5 points in cells 10, 14 and 17.

| variant | group             | pooled hands | cells | seeds                        | baseline bb/100 | candidate bb/100 | diff bb/100 | se per hand | se orbit block | se used | z     |
| ------- | ----------------- | ------------ | ----- | ---------------------------- | --------------- | ---------------- | ----------- | ----------- | -------------- | ------- | ----- |
| nlh     | primary           | 9000         | 9     | 20261114, 20261115, 20261116 | -19.6           | -19.2            | 0.4         | 1.4         | 1.4            | 1.4     | 0.29  |
| nlh     | counter_exploit   | 3000         | 3     | 20261114, 20261115, 20261116 | -23.8           | -28.2            | -4.4        | 3.6         | 3.6            | 3.6     | -1.23 |
| nlh     | field:all_horse   | 6000         | 6     | 20261114, 20261115, 20261116 | -20.0           | -19.5            | 0.5         | 2.0         | 2.0            | 2.0     | 0.23  |
| nlh     | field:tag_regular | 3000         | 3     | 20261114, 20261115, 20261116 | -23.8           | -28.2            | -4.4        | 3.6         | 3.6            | 3.6     | -1.23 |
| nlh     | field:unknown     | 3000         | 3     | 20261114, 20261115, 20261116 | -18.8           | -18.6            | 0.3         | 0.9         | 0.9            | 0.9     | 0.30  |

### lightningEarlyFoldNeedsFoldThrough

Cells 0, 4, 7, 10, 17. Wall time per range: 340 s, 135 s, 220 s, 179 s, 166 s. Divergent decisions per range (three seeds): 604, 574, 624, 924, 618. VPIP rose 0.5 to 0.83 points per range, and 40 to 75% of that gain is first-in limps (Q4: cell 0 limps +0.2 of +0.5; cell 4 +0.367 of +0.833; cell 7 +0.533 of +0.767; cell 10 +0.4 of +0.533; cell 17 +0.467 of +0.7). The bottom-quartile share of entering hands rose in every range (Q3, baseline to candidate: 13.2 to 14.1, 12.9 to 14.4, 11.3 to 12.4, 12.0 to 13.1, 11.2 to 12.6 percent).

| variant | group             | pooled hands | cells | seeds                        | baseline bb/100 | candidate bb/100 | diff bb/100 | se per hand | se orbit block | se used | z     |
| ------- | ----------------- | ------------ | ----- | ---------------------------- | --------------- | ---------------- | ----------- | ----------- | -------------- | ------- | ----- |
| nlh     | primary           | 12000        | 12    | 20261114, 20261115, 20261116 | -21.4           | -25.0            | -3.6        | 1.6         | 1.6            | 1.6     | -2.23 |
| nlh     | counter_exploit   | 3000         | 3     | 20261114, 20261115, 20261116 | -16.6           | -19.4            | -2.8        | 3.8         | 3.4            | 3.8     | -0.74 |
| nlh     | field:all_horse   | 6000         | 6     | 20261114, 20261115, 20261116 | -20.0           | -23.6            | -3.6        | 2.4         | 2.4            | 2.4     | -1.51 |
| nlh     | field:tag_regular | 3000         | 3     | 20261114, 20261115, 20261116 | -16.6           | -19.4            | -2.8        | 3.8         | 3.4            | 3.8     | -0.74 |
| nlh     | field:unknown     | 6000         | 6     | 20261114, 20261115, 20261116 | -22.9           | -26.4            | -3.5        | 2.1         | 2.1            | 2.1     | -1.66 |

Read: in these NLH 4-handed cells the option lost 3.6 bb/100 on the primary fields (more than two standard errors) and added mostly limps and weaker entering hands. That is a negative development signal for this option in NLH; it is not a full-matrix result. The owner's rule that a VPIP requirement is never met with strategically indefensible entries applies to the limps: they should be read before this option is considered again.

`lightningStyleReadSeparate` was not run (time; the coordinator limited this pass to two options).

**Note (2026-11-21):** every PLO8 figure above from the evaluation league (`server/src/benchmark/HorseLeague.ts`, `playHand`) came from the high-only league, which paid every hi-lo pot to the high hand with no low half; it needs re-measurement on the league with hi-lo settlement (`settleLeagueShowdown`, `docs/changelog/2026-11-21-league-pays-the-low-half.md`).
