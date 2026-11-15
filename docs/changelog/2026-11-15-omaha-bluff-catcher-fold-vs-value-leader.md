# Omaha bluff-catcher fold only against a measured value leader

Date: 2026-11-15. Lane: PLO Strategy. Owner complaint: Horses call big river bets and raises with bluff catchers against a player who always has it. One new option, off by default (read `=== true`): `omahaBluffCatcherFoldVsValueLeader`.

## What happened

The unconditional bluff-catcher fold (`omahaBluffCatcherRaiseFold`) failed its evaluation: it folds on bet size alone, so it loses to players who bluff-raise. It stays off and unchanged.

## Root cause

The rule reads only public information and the Horse's cards, so it treats a player who raises only for value and a player who bluff-raises the same way.

## What changed

`omahaBluffCatcherFoldVsValueLeader`: the same bluff-catcher cells (`omahaBluffCatcherCell` in `server/src/engine/HorseOmahaBigBetCalls.ts`, unchanged, with every exception: the priced turn redraw, the measured postflop over-bluffer, chips behind the call) fold only when the player whose bet or raise the Horse faces is a measured postflop value leader, by the read the read-conditional defence added (`HorseMind.omahaReadConditionalOf`: `measured` and `valueLeader`; a presumed read never counts). Against an over-bluffer, a station or an unknown or presumed player the decision is today's. The option stands aside while `omahaBluffCatcherRaiseFold` is on and with the mind off. With it unset or false the brain plays exactly as before.

Receipts `omaha_bluff_catcher_fold_vs_value_leader` (the fold; `omaha_bluff_catcher_raise_fold` and `v81_omaha_big_bet_call_fold` count it as well) and `omaha_bluff_catcher_fold_vs_value_leader_withheld`. Ledger flag, reference-decision source reason, league cards `plo4_` / `plo5_omaha_bluff_catcher_fold_vs_value_leader`, evidence file `docs/horse-default-on.d/omahaBluffCatcherFoldVsValueLeader.md`.

## Evaluation

None yet: default OFF, unmeasured. Known from the tests: with the mind on, today's brain already folds the recorded river node (hand 59414191 continued, the set raised the pot), so the option's decision cases are the turn raise against top set; its river reach is not yet counted.
