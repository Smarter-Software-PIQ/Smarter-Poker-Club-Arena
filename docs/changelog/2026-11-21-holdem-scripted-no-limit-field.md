# A scripted no-limit field for the two priced hold'em options (2026-11-21)

Hold'em Strategy lane. `holdemCommittedNoPairIsPriced` and `holdemDangerBoardEquityIsPriced` (both default OFF since #11545) could not be resolved on their six-seat Horse mirror cards: the mirror diverged on 20 to 132 of 6,000 pairs per seed and the pooled results were not significant (`-0.50 +/- 0.53` and `-0.75 +/- 0.63 bb/100`). This change adds league fields where each option actually acts, and measures it.

## What changed

- `server/src/benchmark/NlhScriptedField.ts`: a scripted no-limit field (`nlh_scripted_field_v1`), seated through the league's existing human-field mechanism exactly as the scripted fixed-limit field is. Each persona is a pure function of its own cards and the public state (no randomness, no Horse brain call). Preflop entry is sourced from the heads-up wide small blind persona (plays 80%, defends 60%, opens 2.5bb); every postflop threshold is labelled DESIGN VALUE.
  - `nlh_pot_barreler_v1`: bets the pot on every street with any two cards, dealt 40bb deep, so a Horse that floats the flop faces a turn pot bet at a stack-to-pot ratio near 1 (the committed branch). Calls a raise with one pair or better.
  - `nlh_value_barreler_v1` (harm control): the same, but bets only two pair or better.
  - `nlh_danger_board_bettor_v1`: never folds before the river; on a four-flush or four-straight turn or river bets half the pot with a straight or better (value) and with no pair (bluff).
  - `nlh_danger_board_value_v1` (harm control): the same, value only.
- `HorseLeague.ts`: four heads-up cards (`NLH_SCRIPTED_FIELD_CARDS`), arm A the option on, arm B off, hybrid cash persona, deal-seeded mood clock: `nlh_committed_no_pair_is_priced_vs_pot_barreler` and `_vs_value_barreler` (40bb), `nlh_danger_board_equity_is_priced_vs_danger_bettor` and `_vs_danger_value` (100bb). Each declares 6,000 pairs for the nightly.
- `HorseLeagueComputeWorkerClient.ts`: the nightly worker accepts the new field's results.
- Tests: `server/src/benchmark/NlhScriptedField.test.ts`.

Nothing switches an option on; both stay default OFF. No database read or write.

## Sizes, declared before the measured seeds were dealt

Probe on seed `20261115`, 3,000 pairs per card (engine `8d01508d3d4` plus this change, uncommitted):

| card                                                 | divergent pairs | bb/100 (A - B)    |
| ---------------------------------------------------- | --------------- | ----------------- |
| `nlh_committed_no_pair_is_priced_vs_pot_barreler`    | 23              | `+0.98 +/- 3.38`  |
| `nlh_committed_no_pair_is_priced_vs_value_barreler`  | 0               | inert             |
| `nlh_danger_board_equity_is_priced_vs_danger_bettor` | 21              | `-10.83 +/- 6.31` |
| `nlh_danger_board_equity_is_priced_vs_danger_value`  | 8               | `+1.62 +/- 0.74`  |

Declared measurement: every card at **120,000 pairs per seed**, seeds **20261120** and **20261121**, run with `server/src/scripts/horseLeagueCard.ts --pairs=120000`. At the probe's per-pair spread that gives about `0.5`, `1.0` and `0.15` bb/100 standard error per seed on the three cards that act. The size is not enlarged after a result is seen.

A first form of the committed-spot field (a turn jammer that put its whole stack in on every turn with any two cards, 100bb) was probed and dropped: 0 of 3,000 pairs diverged, because a Horse with no pair facing a 95bb jam into a 10bb pot folds whether or not the option prices it.

## Results

(Recorded below once the declared runs finish.)
