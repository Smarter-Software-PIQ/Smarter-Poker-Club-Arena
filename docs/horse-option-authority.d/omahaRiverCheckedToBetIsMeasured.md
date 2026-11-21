# omahaRiverCheckedToBetIsMeasured: Authority For The Live Switch

Built 2026-11-20 by EMERG lane OFFENCE-BUILD (PLO-OWNER lead-2) on the owner's order of 2026-11-20 3:05 PM Chicago. It replaces, in its heads-up river spot, the kind-keyed omahaCheckedToBetIsPriced family (retired by OFFENCE-BUILD: it read the opponent's kind in the decision). This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot (`server/src/engine/HorseOmahaRiverCheckedToBet.ts`). In the wager_rules node, after omahaRiverFirstToActBetIsPriced and before the river current-nuts floor: on the river, heads-up, nothing to call, after the opponent checked (the Horse closes), the node's final check is priced beside the engine's bet sizes with the card-impact model and the measured pooled curve of heads-up river bets made after a check (production hands with a person seated, 2026-11-13..17, every player pooled, no responder above 20% of a cell). The check is valued at the higher of the model's showdown share and its kind-free production calibration; the called branch at the lower of the model's equity and its calibration (the exact nuts keep the model's). The best bet replaces the check only when it beats it by more than the comparison's standard error. It changes only a check into a bet.

Public information only: no opponent memory, account, name or person/Horse flag. Receipt `omaha_river_checked_to_bet_measured`. Default OFF (read `=== true`), switchable live, scopable per game (`horse.omahaGameScope.omahaRiverCheckedToBetIsMeasured`).

## What Was Measured

Archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/OFFENCE-BUILD.md: heads-up river bets after a check are folded to 54% / 67% / 75% / 87% at 0.27 / 0.42 / 0.65 / 1.0 of the pot. Grade: CRITERIA-OFFENCE-omahaRiverCheckedToBetIsMeasured.md (sha256 ae35c7c200396cd2f2329676fe38f9340b4b76de19ac577a08388e65d53d965b, declared before the replay); results in OFFENCE-BUILD.md.

- Replay: NOT RUN (no audited-decision scorer row is recorded for this option; the exact journal replay, Nov 18-20 journals, is recorded in the EMERG archive, OFFENCE-BUILD.md)
