# R8 density pre-flight: check a cell plan reaches 300 decisions per run before solving it

Part of the R8 plan approved by Dan on 2026-11-06 (option A, new evaluation
set). Offline tooling only: no engine behaviour changes, no database change.

## Why

Contract v3 needs at least 300 playbook decisions in every certification run
(each table, both kinds, and each league table's memory-off twin). R7's cells
were asked about 36 times per table at 2,000 pairs, about 180 at the contract's
10,000 pairs, so an R7-shaped plan would fail the floor after the solver hours
were already spent. The pre-flight measures demand first.

## What changes

- `HorseDecideOpts.onV31Demand` (evaluation control, registered in the data
  ledger): reports every certified-playbook consult with its lookup fields and
  whether it hit. It fires even when the dataset store is empty and changes no
  decision (pinned by test).
- `gtoV31DemandCell` in `GtoPostflopV31.ts` keys a consult exactly as a sealed
  cell for that spot is keyed (pinned against a loaded cell).
- `server/src/benchmark/GtoV31DensityPreflight.ts`:
  - `recordGtoV31Demand` plays the contract v3 scenarios of the chosen tables,
    both kinds plus memory-off twins, with the certification seed scheme, and
    counts the cells asked per run.
  - `scoreGtoV31CellPlan` scales to the contract's pairs per table and reports
    each run against the 300 floor, plus cells not reached in both kinds.
  - `proposeGtoV31CellPlan` fills every run to a target (default 450, 50% over
    the floor) before spending the rest of the budget on density, so a sparse
    table is not starved by a dense one.
- CLI `server/src/scripts/gtoV31DensityPreflight.ts` (`EQUITY_GOVERNOR=off`).
- A note at the `worker_required` miss in `GtoPostflopV31.ts`: public-hist215
  cells answer only inside a worker thread; anything that needs them to answer
  runs through `server/scripts/finite-evaluation-worker.mjs`. The pre-flight
  needs no answers and runs on the main thread.

## Result on the R8 cash scope (2026-11-07, 2,000 probe pairs per table)

Tables `cash_ev_2max_80bb`, `cash_ev_6max_80bb`, `human_cash_ev_6max_80bb`
(the 80 bb bucket holds every 61 to 110 bb stack, so 100 bb plays there),
single-raised pots, 100 cells:

| Run                                | Expected decisions at 16,667 pairs |
| ---------------------------------- | ---------------------------------- |
| paired replay, heads-up            | 8,609                              |
| paired replay, six-max             | 3,408                              |
| paired replay, human six-max       | 450                                |
| league, heads-up / memory off      | 7,708 / 7,542                      |
| league, six-max / memory off       | 3,217 / 3,200                      |
| league, human six-max / memory off | 467 / 450                          |

Every run clears 300; no cell is unreached. The plan is 70 flop, 23 turn and
7 river cells. A plan ranked by density alone left the human table at 42.

Caveat: demand is recorded with no playbook loaded, so the candidate plays
heuristics and later streets can differ once a playbook answers. It is an
estimate to choose cells, not a certification.
