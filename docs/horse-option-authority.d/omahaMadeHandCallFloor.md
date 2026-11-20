# omahaMadeHandCallFloor: Authority For The Live Switch

Built 2026-11-20 by EMERG lane RIVER-FLOOR (PLO-OWNER) on the owner's orders of 2026-11-20 12:44 PM Chicago ("ITS NOT LUCK! HES WINNING CONSISTENTLY AGAINST HORSES ON MULTIPLE CHANNELS!! FIND THE LEAKS AND FIX IT!") and 9:52 AM (the same play and decisions for all players, human or Horse). Evidence NOT MET under the machine-read replay bar (the audited-decision scorer was not run); the production-hand fit and validation and the exact journal replay graded PASS under declared criteria (below). This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot (`server/src/engine/HorseOmahaMadeHandCallFloor.ts`). An answer of the wager_rules node after every owner rule: heads-up on the turn or river, facing the street's first bet (the Horse has nothing in on the street; not a raise) of more than half the pot up to 1.05 pots, the node's final fold becomes the legal call (the whole-stack all-in when the call is the stack) when the Horse's made-hand cell (street, class, board paired or not) is in the measured set. Shipped cells: river flush on an unpaired board; turn straight on an unpaired board.

Public information only: the Horse's own cards, the board, the pot, the bets and the street's public actions. No opponent memory, account, name or person/Horse flag: the same rule against every bettor. PLO6, PLO8, hold'em and tournaments are untouched.

Receipt: `omaha_made_hand_call_floor` (noteFire and the decision rule receipt, before fold, after call). The response validator re-runs the floor on the request and admits wager_rules fold -> call only where it holds, for the exact chips owed.

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only; scopable per game (`horse.omahaGameScope.omahaMadeHandCallFloor`).

## What Was Measured

Criteria CRITERIA-RIVER-FLOOR-1 (sha256 cc3414731c233af8134b03d918bb12e68b78e1334c3ddc08bae80d31467adbe9), declared before the cell selection and every grade. Value per changed decision = EV of the call on the real cards in big blinds (river exact; turn exact over the river cards, no later betting).

| Step                                                                         | Data                                                                                                                           | Result                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fit (cell selection: n >= 5 and mean - 1 SE > 0, folds facing persons)       | production PLO4/PLO5 cash hands with a person, Oct 14 - Nov 16, 1,448 heads-up folds facing a person's half-pot-plus first bet | 2 cells IN: river flush unpaired board (n 5, +59.8 +- 52.5 bb per fold), turn straight unpaired board (n 5, +43.8 +- 35.1); every other class folded correctly in the fit window    |
| V1 held-out time, facing persons                                             | Nov 17 - Nov 20                                                                                                                | 13 changes, +625.1 +- 285.7 bb; without the most frequent bettor (6 changes) +380.2 (7); held-out bettors +119.0 (2); no street, game, size or Lightning/table split below -1 SE    |
| V1 facing Horses (internal chips, reported)                                  | Nov 17 - Nov 20                                                                                                                | 7 changes, -124.9 +- 85.1 bb                                                                                                                                                        |
| V2 exact journal replay (PROVE/rec and river-core third/rec, turn and river) | 3,255 facing decisions                                                                                                         | 0 illegal, 0 validator refusals, 0 fallback changes, every change a fold -> call/all-in in the cells; off arm action-identical to main; graded changes facing persons +409.6 bb (4) |

- Replay: NOT RUN (the audited-decision scorer was not run; the exact journal replay above is recorded in the EMERG archive, RIVER-FLOOR.md)
