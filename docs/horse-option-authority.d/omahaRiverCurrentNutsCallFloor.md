# omahaRiverCurrentNutsCallFloor: Authority For The Live Switch

Built 2026-11-20 by EMERG lane RANGE-MODEL-2 on the owner's orders of 2026-11-20 9:42 AM Chicago ("EVERYTHING DEPENDS ON THE MATH") and 9:52 AM ("THE SAME CORRECTIONS AND ADJUSTMENTS ... AGAINST ALL PLAYERS, REGARDLESS IF THEY ARE HUMAN OR HORSES"). Evidence NOT MET under the machine-read replay bar (the audited-decision scorer was not run); the exact journal replay graded PASS under its declared invariant criteria (below). This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot (`server/src/engine/HorseOmahaRiverCurrentNutsCallFloor.ts`). The outermost answer of the wager_rules node: on the river, facing a wager, the node's final fold becomes the legal call (the whole-stack all-in when the call is the stack) when the Horse holds the exact current nuts (every unseen two-card holding enumerated, exactly two hole and three board cards, `HorseRiverNuts.hasRiverNuts`) and a full chop with every live opponent still returns the call: (pot + paid) / (live opponents + 1) >= paid. The call's expected value is then never negative, whatever the bettor holds. It changes only a fold.

Public information only: the Horse's own cards, the board and its known dead cards. No opponent memory, account, name or person/Horse flag: the same rule against every bettor. PLO6, PLO8, hold'em and tournaments are untouched. Near-nut hands are not floored (in Omaha a small share of beating two-card holdings compounds over every pair of a holding and a narrow value range concentrates it: a range question, not an invariant).

Receipt: `omaha_river_current_nuts_call_floor` (noteFire and the decision rule receipt, before fold, after call). The response validator re-runs the floor on the request and admits wager_rules fold -> call only where it holds, for the exact chips owed.

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only; scopable per game (`horse.omahaGameScope.omahaRiverCurrentNutsCallFloor`).

## What Was Measured

Why: lane RANGE-MODEL's facing-bet range read (omahaFacingBetRangeByBettorFrequency, failed, not shipped) folded the current river nuts in hand 60226889 (a nut straight no unseen holding beats). Live production (LIVEGRADE grades, Nov 17 - Nov 20 4 AM, 552 Horse river folds): 0 folds of the current nuts.

Criteria CRITERIA-RANGE-MODEL-2-A (sha256 406e9b77ed055a50c3cdeb354890295eb3c297e0c323b77cd46270f9e7494740), declared before the replay. Exact journal replay (PROVE/rec Nov 18-19 turn+river PLO4/PLO5, 1,063 facing decisions; river-core third-day PLO5 river, 1,067):

| Arm Pair                                 | Changes                                                        | Illegal | Refusals | Fallbacks | River Nut Folds |
| ---------------------------------------- | -------------------------------------------------------------- | ------- | -------- | --------- | --------------- |
| Live set vs live set + floor             | 0                                                              | 0       | 0        | 0         | 0 and 0         |
| Stress: live + frequency read vs + floor | 1 (hand 60226889 fold -> call 32.12, the call production made) | 0       | 0        | 0         | 2 rows -> 0     |

Real chips to persons versus live: 0 (no change on the live set). Verdict PASS (invariant).

- Replay: NOT RUN (the audited-decision scorer was not run; the exact journal replay above is recorded in the EMERG archive, RANGE-MODEL-2.md)
