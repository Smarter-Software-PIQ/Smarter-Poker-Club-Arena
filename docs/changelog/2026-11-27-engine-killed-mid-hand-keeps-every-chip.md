# An Engine Killed Mid-Hand Keeps Every Chip (2026-11-27)

Code review finding 11: no test killed the engine in the middle of a hand and
checked what crash recovery does with the money.

## What recovery does

`checkCrashRecovery()` (server/src/engine/ServerTableEngineBase.ts) does not
resume a dead hand. It asks the database for a retained settlement submission
(cash tables with a verified lease), then finds the incomplete
`hand_state_snapshots` row, marks it complete and lets the dealing loop deal a
fresh hand from `table_seats`. Chips are safe because a seat's stack moves only
in the settlement commit; the voided hand's blinds and bets exist only in the
dead process and in the snapshot row, which is never read back as money.

## The test

`server/src/engine/anEngineKilledMidHandKeepsEveryChip.law.test.ts` runs the
real `dealHand`, `HandController`, `saveSnapshot`, `checkCrashRecovery` and
`loadSeatedPlayers` against an in-memory database that sits under the real
Supabase helpers. It kills the engine at six points (preflop after blinds,
after a raise and call, mid flop after a bet and raise, at an all-in before the
runout, after the hand finished in memory but before the commit, and after the
commit but before the snapshot was closed) and asserts per player conservation
(in-hand stack plus committed chips), refund exactly once, no settlement or
seat write by recovery, unchanged seats, an idempotent second recovery, and a
next hand dealt from the recovered stacks.

No engine defect was found, so no engine code changed. Mutation checks: making
recovery skip `completeHandSnapshot`, or write the snapshot's in-hand stacks
back to `table_seats`, turns the suite red.

## Behaviour worth knowing (unchanged, by design)

- A hand that finished in memory (for example an all-in that was won) but whose
  settlement commit never landed is voided: every seat returns to its pre-hand
  stack. No chip is created or lost.
- A settlement submission retained across a database freeze is resumed by
  `fn_ca_resume_hand_submission` inside the database, not by this path; that
  branch has its own tests and this suite covers only its "nothing retained"
  answer.
