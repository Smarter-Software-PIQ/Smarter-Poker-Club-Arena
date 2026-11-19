# 2026-11-19 - The prepared hand is saved under the rest (hand delay, lane E1)

Dan 2026-11-18: "i just don't want any 'un intended delays'". After #11314 a
tournament deal still made one database round trip after the 1.5 s rest: the
seq-0 save of the prepared original (`fn_f06_retain_hand_continuation`, about
0.15-0.2 s on production). Every other step already ran under the rest.

## Why it could not move before

A saved original that never started had no way out. Its `never_started`
transition meets the immutable `retained` continuation disposition
(`f06_retained_submission_guard` -> `HAND_CONTINUATION_UNSETTLED`), so
`fn_f06_cancel_prepared_hand` refuses it, and the engine fenced itself
(`killForRestart('retained_original_start_unproven')`) whenever a pause met a
saved hand before its start. Moving the save under the rest would have widened
that window from one round trip to most of a second.

## The change

- SQL (`20261119053155_a_retained_prepared_hand_is_cancelled_under_the_rest`):
  `fn_f06_cancel_retained_prepared_hand`, same identity, reply and receipt row
  (`f06_prepared_hand_cancellations`) as `fn_f06_cancel_prepared_hand`. Under
  the save's own lanes it deletes this generation's unstarted seq-0 capsule,
  writes the receipt and closes the permit `never_started`, in one transaction.
  A replay returns the same receipt; a save still in flight is refused by the
  save itself. Refused while the platform is frozen (the capsule stays the
  break's custody). `f06_retained_submission_guard` admits `never_started` for
  exactly that case (receipt present, no capsule left); every other path is
  unchanged.
- Engine: after the reservation dealHand awaits only the blind read, applies
  the last look once, then builds and saves the hand under the rest.
  `runOriginalController` finishes the rest after the save, applies the last
  look again and only then starts. A refusal (maintenance, hand-for-hand,
  balancing, final-table deal, terminal close-out, weekly payout, admin pause,
  Cluster halt, engine stop) releases the saved original exactly once
  (`F06HandPermit.cancelRetainedPreparedHand`, one exact replay on a lost
  reply) and the loop goes round to its pause handling. The old fence site
  (a hold past the last look) releases the same way. A release SQL refuses
  keeps the old custody: fenced while running, capsule left for the successor
  on a stop. A claimed (successor) original is never released here.
- Until the start, `publishedHandState` stays the rest's: a hand built under
  the rest is not on the felt early.
- Cash tables are untouched (they never reserve under the rest).

## Proof

- `scripts/ci/test-f06-retained-prepared-cancel-postgres.py` (native
  PostgreSQL; workflow `f06-retained-prepared-cancel-native-proof.yml`):
  production's exact bodies (md5 asserted), the migration byte for byte, 29
  cases - exactly-once cancel, replay identity, no strand, both race orders,
  every refusal, grants. Post-image md5: guard
  `9988e9e0293cb44a5a5634fbbbe86948`, function
  `f4dc105c38a0bc92cb969c7eed4f52d8`.
- `server/src/engine/ThePermitIsReservedUnderTheRest.test.ts`: every hold,
  before the build and after the save; lost reply; refused release while
  running and on a stop; the post-last-look hold.
- Law `noUnintendedDelayBetweenHands`: tournament gap <= rest + 80 ms at a
  mocked 150 ms round trip (was rest + 150 + 80), the save answered before the
  rest ends, and every await on the deal path named with its side of the rest.
  Its await scanner now sees names with digits (`cancelF06...` escaped it).

## Expected

Tournament fold p50 about 3.55 s -> about 3.35 s (the cash figure for the
same beats). Cash unchanged.
