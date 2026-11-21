# A replayed hand has no forced posts in its history (2026-11-20)

## What was wrong

`HorseComplaintReplay.stateAt` rebuilds the public game state at a recorded
horse decision so today's brain (`HorseLogic.decide`) can be replayed there.
It built `gs.actionHistory` from every recorded row before the node. The hand
record holds the forced posts beside the actions: `ServerTableEngineHandEvents`
writes each `FORCED_BETS_POSTED` posting from `HandController.postBlinds` as a
row (`sb`, `bb`, `ante`, `straddle`, `post`, `kill_blind`), and the record also
carries `bomb_ante`, `return` and run-it-twice rows.

Live `HandController` never puts a forced post in `state.actionHistory` (the
comment in its option check says so: "Forced blind and straddle posts are NOT
recorded in actionHistory"). Live actionHistory holds exactly the `ActionType`
names: `fold`, `check`, `call`, `bet`, `raise`, `all_in` (performBettingAction,
including timed-out forced folds and checks) and `discard` (Crazy Pineapple).

So in a replay, a blind or ante poster's own posts read as prior voluntary
actions:

- `HorseLogic` `heroPreviouslyActed` (any own action that is not a fold or a
  check) was true for a big blind, small blind, straddler or ante poster on its
  first voluntary preflop decision;
- `HorsePreflopOrbitState` read a prior voluntary investment
  (`heroPriorVoluntaryChips` set to the post) that never happened, and its
  straddle detection (`detectStraddleSeat`) skipped every seat with a
  non-fold row, so a straddler's own `straddle` row hid it from detection and
  the "no preflop action yet" branch never ran once a post was listed.

## Live play was never affected

The live engine hands the brain `getState().actionHistory`, which never held
the posts. Only replays were wrong: complaint replays, audited replays and any
evidence built on `stateAt` for a preflop decision taken by a blind, straddle
or ante poster.

## The fix

`stateAt` now keeps a row in `actionHistory` only when its action is one live
`HandController` records (`isLiveActionHistoryAction`, keyed by `ActionType` so
a new live action name fails to compile until it is listed). Stacks, street
bets, pot, blinds and the blind seats still come from the snapshot and the
recorded posts exactly as before; only the history list changed. The other
readers of the recorded actions in the file (`replayBlindSeats`, `wagerFaced`,
`classifySpot`) do not feed the history the brain reads and already name the
actions they want.

Pinned by `server/src/engine/aReplayedHandHasNoForcedPostsInItsHistory.law.test.ts`,
which drives a real `HandController` to a big blind facing a raise, records the
hand the way the engine records it, and requires the replay to give the live
actionHistory, heroPreviouslyActed and preflop orbit state. It fails with the
filter removed. `HorseComplaintReplay.test.ts` pinned the old eight-row history
for the QQ big blind fixture (sb, bb and ante included); it now pins the five
voluntary rows.

## Re-run replay evidence on this fix

Replay evidence for preflop options decided by blind, straddle or ante posters
was measured with the wrong history and should be re-run on this revision:
`nashCallVsJam`, `huSmallBlindStealsVsTightBigBlind`, `v72DefenceByOpener`,
`huBbDefendsToPrice`, `huBbDefendsUnreadToPrice` and the HorsePreflop paths
(any option gated on `heroPreviouslyActed` or on the orbit state's hero prior
action).
