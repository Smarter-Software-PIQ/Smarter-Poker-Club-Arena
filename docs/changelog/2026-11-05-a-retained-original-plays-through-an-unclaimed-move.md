# A retained original plays through an unclaimed table move (2026-11-05)

## What happened

Sunday Deep Stack Satellite 25 (`fbb86b2a`) stopped dealing on table
`aed78e3f` at 18:29 UTC with nine players seated, while its four other tables
kept dealing. The table's next hand (55430351) had been privately retained as
an F06 original (sequence 0, not yet started) when the balancer's seat-move
probe armed `tournamentMovePauseOwners`.

## Cause

Two owners each waited for the other:

1. The seat-move probe can claim a table only at a between-hands boundary
   (`isBetweenHands()` is false while a prepared or pending original occupies
   the table).
2. The retained original refused to start while any next-hand owner existed:
   the hand-for-hand loop parked it at the pause gate because
   `isHandForHandReleaseBlocked()` counts move owners, and the start check
   killed the engine with `retained_original_start_unproven` because
   `isNextHandPaused()` counts them too.

The probe timed out and retried; the watchdog rebuilt the table
(`tournament_table_zombie:dealing:permit=attempted` 18:39,
`start_wait_for_players` 18:49); the successor reclaimed the same original and
met the same probe. The table never dealt again.

## Fix

`ServerTableEngineBase.isNextHandPausedOnlyByUnclaimedTournamentMove()` is true
only when every next-hand owner is an UNCLAIMED tournament move. In that case
the retained original (fresh or reclaimed) neither parks at the gate nor is
fenced: it plays, and the move claims at the boundary the hand produces.

Unchanged:

- a CLAIMED move (seats may already be moving) still parks the original;
- admin, floor, maintenance, dealing halt, weekly payout, final-table deal,
  terminal close-out and hand-for-hand still park or fence it;
- the global maintenance freeze still refuses an already-started original;
- the F06 permit, private retention and financial boundary are untouched.

## Tests

`server/src/engine/OriginalControllerRuntime.test.ts`:

- a fresh retained original under an unclaimed move deals and completes, the
  move owner is still waiting afterwards;
- a reclaimed (successor) unstarted original under an unclaimed move resumes;
- an admin pause beside the move still fences the original;
- a claimed move still parks it.

The first two fail on the previous code (kill / park), the last two pass on both.
