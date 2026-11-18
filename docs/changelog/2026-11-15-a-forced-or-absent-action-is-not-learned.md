# A forced or absent action is not learned as a choice

A Horse's read of an opponent is built from the public action log: how often he plays a hand, folds to a bet, raises
when facing one. Actions the engine took for a player who was not there to choose are not his choices and must count
as neither a fold, a participation opportunity nor a raise opportunity. Two such actions still counted.

## What changed

- **A player who leaves while not on turn.** His fold is queued and the engine executes it when the action reaches
  his seat. It was recorded with origin `pre_action`, the origin of a fold the player armed himself, so every learner
  (the shared exploit counters, the database reducer, the style read's street tallies, the public stats) counted it
  as his own fold: a hand with no VPIP, a fold to a bet, a raise opportunity with no raise. It is now recorded
  `forced`, exactly as the fold of a player who leaves on his turn and a timeout already are. A fold a player armed
  himself and did not leave is still `pre_action`.
- **The style read's per-street raise tallies** (`postflopAggressionIncrements`, the raise-frequency input of style
  options #4 and #4b) skipped only `forced` actions, so a timed-out (`unknown`), fallback or unattributed fold facing a
  wager still counted as a raise opportunity with no raise. They now admit exactly the actions the exploit counters
  admit (`learnablePublicAction`).
- Lightning timeouts were already recorded `forced` by f24da6f1 (`LightningHandHost.timeoutAct`); that is not
  repeated here. Rows the database learned before that change keep what they learned (no replay).

## Not changed

The counting rule of the exploit counters and its database twin; no migration. Every voluntary action counts as
before.

## Proof

`aForcedOrAbsentActionIsNotLearned.test.ts` (12 tests) and `LeaveMeansNow.behaviour.test.ts` (the leaver's fold is
`forced`; an armed fold without a leave stays `pre_action`). Before this change 5 of them failed.
