# omahaRiverFirstToActBetIsPriced: Authority For The Live Switch

Built 2026-11-20 by EMERG lane OFFENCE-BUILD (PLO-OWNER lead-2) on the owner's order of 2026-11-20 3:05 PM Chicago (upgrade the Horses' offensive play, deny the equity, put the opponents in difficult spots; every decision derived from data and math by ranges). This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot (`server/src/engine/HorseOmahaRiverFirstToActBet.ts`). In the wager_rules node, before the river current-nuts floor: on the river, heads-up, with nothing to call and the opponent still to act (the Horse acts first: a barrel after a called turn bet, a lead after calling, a probe after a checked turn), the node's final check is priced beside the engine's bet sizes. The card-impact model supplies the opponent's range from his line this hand and the Horse's equity against the hands that continue; the share that folds, calls and raises at each pot share is the MEASURED pooled curve of river first-to-act heads-up bets (production hands with a person seated, 2026-11-13..17, every player pooled, no responder above 20% of a cell; constants in the file with their source sha256). The called branch takes the lower of the model's equity and its production-fitted calibration; a raise is charged as the bet lost. The best bet replaces the check only when it beats the check by more than the comparison's standard error. It changes only a check into a bet.

Public information only: no opponent memory, account, name or person/Horse flag; the same curve against every opponent (one function, `omahaRiverFirstToActResponseOf`, for a later per-opponent public read). PLO6, PLO8, hold'em, tournaments, multiway pots, the flop and the turn are untouched.

Receipt: `omaha_river_first_to_act_bet_priced` (noteFire and the decision rule receipt, before check, after bet).

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only; scopable per game (`horse.omahaGameScope.omahaRiverFirstToActBetIsPriced`).

## What Was Measured

Archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/OFFENCE-BUILD.md (steps 1-2): heads-up river bets by the first actor are folded to 39% at about a quarter of the pot, 59% at four tenths, 72% at two thirds and 75% at the pot; by the responder's own strength, everything but near-nut hands folds to bets of 0.7 pot or more. Every earlier offence option that failed was multiway, on the flop, or a raise priced unlike the call.

Grade: CRITERIA-OFFENCE-omahaRiverFirstToActBetIsPriced.md (sha256 9a7d1eacd8e6bbdcd430f16d9a1ce1ca23360422241e91e6eb5f9f28f2081552, declared before the replay); results in OFFENCE-BUILD.md.

- Replay: NOT RUN (no audited-decision scorer row is recorded for this option; the exact journal replay, Nov 18-20 journals, is recorded in the EMERG archive, OFFENCE-BUILD.md)
