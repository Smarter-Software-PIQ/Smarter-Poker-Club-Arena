# Hold'em priced options: replay rows and verdict (both stay OFF)

Docs only. `holdemCommittedNoPairIsPriced` and `holdemDangerBoardEquityIsPriced` (PR #11545, `d6748b1c0e`; league runs recorded in PR #11584) now carry a Replay row on real audited decisions and a dated verdict in `docs/horse-option-authority.d/`. Both remain Evidence NOT MET, default OFF, with no switch row.

## What was measured

Audit set HVH48 Auditor D: Horse decisions in no-limit hold'em cash hands with a person dealt in, 2026-11-17 18:45 to 2026-11-19 18:45 America/Chicago. `3891` audited decisions, all placed; `2734` replayed (the Horse's own cards known) in `394` hands; seeds `1,7,42`; scorer `d6b032d3204`; checkout `5bfaa38d0e0`. One replay, base arm against one arm per option.

- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2733; unjudged 1; set HVH48-D Hold'em cash vs people 48h; scorer d6b032d3204; source placed verdict-only; arm committed vs off; replayed 2734 of 3891
- Replay: fixed 1; newlyWrong 1; changed 5; unchanged 2729; unjudged 3; set HVH48-D Hold'em cash vs people 48h; scorer d6b032d3204; source placed verdict-only; arm danger vs off; replayed 2734 of 3891

## Verdict

| Option                            | League (3 seeds, 36,000 hands)       | Significant | Replay                            | Verdict          |
| --------------------------------- | ------------------------------------ | ----------- | --------------------------------- | ---------------- |
| `holdemCommittedNoPairIsPriced`   | `-0.50 +/- 0.53 bb/100`, `z = -0.95` | no          | changed 1, fixed 0, newly wrong 0 | Evidence NOT MET |
| `holdemDangerBoardEquityIsPriced` | `-0.75 +/- 0.63 bb/100`, `z = -1.18` | no          | changed 5, fixed 1, newly wrong 1 | Evidence NOT MET |

Neither option has a significant league run, so neither has three significant positive runs. Neither shows measured harm: no league result is significant and no replay row has more newly wrong than fixed. No off-only lock is asked for.

What each still needs is written in its authority file. In short: a significant positive league result on a field where the option acts, and for the danger-board option a bettor-range measurement that is not conditioned on a call. Its `n = 50` showdown sample is call-biased, and all five decisions it changed in the replay are calls turned into folds.

## Limits

The base arm is the archived production switch rows of 2026-11-20T21:15Z plus the three rows the coordinator handoff lists as switched on afterwards; the database was not read. Opponent memory is off in replay. The audit is verdict-only. The replay work directory holds Horse hole cards and stays on the operations Mac.
