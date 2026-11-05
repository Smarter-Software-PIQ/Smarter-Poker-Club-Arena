# The complaint replay sees the table the brain saw

Club Arena horse brain, complaint replay library (Phase 5.3), 2026-11-05.

## What was wrong

Replaying the first hours of the Hybrid's cash fold-to-3-bet decisions through
`HorseComplaintReplay.stateAt` reproduced the live action only 82% of the
time, and every miss ran the same way. Two inputs the live engine publishes on
every horse turn were missing from the rebuilt state:

1. **The dealt census.** The live engine sends `dealtSeatIds` (every seat that
   was dealt in). The replay left it out, so the brain read position from who
   was still live (the V13 ring compression): an under-the-gun opener whose six
   neighbours had folded was replayed as a cutoff, answered the 3-bet from a
   28% opening range instead of an 11% one, and called with AQo where the live
   horse folded.
2. **The forced posts and the uncalled-bet return.** The persisted hand carries
   the small and big blind posts (`origin: 'forced'`) and the "uncalled bet
   returned" event (`historyEvent`), which HandController never puts in the
   live `actionHistory`. Counted as the hero's own acts, a blind opener looked
   like it had acted twice before the 3-bet, so the V73 continue read never
   fired for a small-blind opener and it folded 88 to a 3.7x 3-bet the live
   horse called.

## What changes

`stateAt` now sets `dealtSeatIds` from the snapshot's seats and filters the
history to decision records (`isDecisionRecord`: not `origin: 'forced'`, no
`historyEvent`). On the same 207 post-switch cash 3-bet nodes the replay now
reproduces the live action 95% of the time; the rest are borderline hands
shaded by the live opponent reads, which the replay turns off on purpose.

Nothing in the horse brain, the engine or the database changes. The fleet's
play was never affected: this was the offline replay misreading the table.

## Law

`server/src/engine/HorseComplaintReplaySeesTheDealtTable.law.test.ts`
(`docs/laws.d/the-complaint-replay-sees-the-table-the-brain-saw.md`), pinned
clock, with the pre-law state replayed as the non-vacuity control.
