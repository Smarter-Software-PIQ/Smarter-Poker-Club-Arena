# omahaTurnStrongHandRealizationIsMeasured: Authority For The Live Switch

Built 2026-11-19 by EMERG lane OPEN-ITEMS on the lead's order of 10:55 PM Chicago (BLEED-NOW item 5.2: Horses fold strong made hands to a person's turn bet). This file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

Acts only with `omahaFacingBetIsPricedByEquity` on, inside that rule's verdict (`server/src/engine/HorseOmahaFacingBetEquity.ts`). PLO4/PLO5 cash, Lightning, heads-up, turn, facing a person's bet or raise, the node's final answer a fold: when at most 10% of the two-card holdings the unseen cards allow beat the Horse's best hand on the board as it stands (its own cards and the board), the calibrated public equity is multiplied by the realization measured for exactly those calls (1) in place of the flat turn 0.64. The fold becomes the call only when that beats the price by the same measured turn margin (0.047). Tables, multiway pots, the flop and the river are priced exactly as before. It changes only a fold. PLO6 is untouched. Default OFF in source (read `=== true`).

The response validator admits the call where the rule could have made it (the same pure verdict with the strong-hand realization), for the exact chips, because the switch delivers the option inside the worker.

Receipt: `omaha_turn_strong_hand_realization_priced` (with `omaha_facing_bet_equity_call`).

## What Was Measured

Deciding rule of the folds (exact replay with fires, 28 journaled turn folds of the class, live option set of 2026-11-19): `omaha_facing_bet_ev_fold` on 28 of 28.

Constant (public information only): chips the Horses' own heads-up turn calls of the class won back over their calibrated public equity, Nov 17-18 Chicago: Lightning 1.02 (44 calls), tables 0.36 (26 calls). Held out Nov 19: Lightning 0.73 (15 calls). Shipped: Lightning 1 (capped), tables unchanged.

Graded offline against the opponents' real cards (never an input), heads-up turn folds facing a person's bet, verdict with this option on:

| Set              | Folds | Flips to call      | All-in EV of the flips, bb                | Graded at the flat 0.64, bb |
| ---------------- | ----- | ------------------ | ----------------------------------------- | --------------------------- |
| Fit, Nov 17-18   | 163   | 23 (22 Lightning)  | +721.1 (mean +31.4, SE 10.6, 13 positive) | +186.1 (mean +8.1, SE 5.6)  |
| Held out, Nov 19 | 66    | 10 (all Lightning) | +232.9 (mean +23.3, SE 20.0, 5 positive)  | -6.6 (mean -0.7, SE 12.8)   |

The flat rule alone flips 4 (fit) and 6 (held out, +138.4 all-in). Verdict on the held-out day: non-negative, INSUFFICIENT (under 2 SE). Evidence NOT MET for a default-on; a lead switch decision only.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (no server/scripts/audited-decision-replay.ts --row run is recorded; the graded fit and held-out verdict runs are in archive repairs/EMERG/OPEN-ITEMS.md and work emerg/open-items/work/rz.py)
