# 2026-11-18 - The F06 permit is reserved under the rest (hand delay, lane D2)

Dan 2026-11-17: finish a hand, move the button and start the next in under a
second, two at most. Dan 2026-11-18: "i just don't want any 'un intended
delays'". Every intended beat keeps its length; nothing else may separate
them.

## What was unintended

Graded on production with `scripts/sql/hand-gap-unintended-delay.sql`
(30 minutes, 2026-11-18, Lightning excluded), the gap minus owed beats was:

| shape | hands | unintended p50 | cause |
| --- | --- | --- | --- |
| cash fold | 353 | 4 ms | none |
| cash showdown, chips on the river | 38 | 2 ms | none |
| cash showdown, river checked | 45 | 502 ms | unplayed sweep (#11302) |
| tournament fold | 781 | 491 ms | F06 round trips after the rest (this change) |
| tournament all-in showdown | 259 | 1004 ms | both |

A tournament deal ran `fn_f06_hand_number_state`, `fn_f06_begin_hand` and the
seq-0 `fn_f06_retain_hand_continuation` one after another AFTER the 1.5 s
rest had fully elapsed.

## The change

- A tournament table with F06 admission stops `F06_RESERVE_LEAD_MS` (1000 ms)
  short of the end of the rest (`awaitNextHandRestLead`, which also starts the
  blind read). dealHand reserves the permit, waits out what is left of the rest
  (`awaitNextHandRest`), re-applies the last look (`handRestStillAllowsTheDeal`:
  running, lease, every next-hand pause owner, hand-for-hand release, terminal
  close-out, balancing moves), and only then builds, retains and starts the
  hand. The deal still never starts before the rest ends.
- A permit reserved under the rest and not dealt (maintenance, hand-for-hand,
  balancing move, final-table deal, terminal close-out, weekly payout, admin,
  Cluster halt, a stop) leaves through dealHand's existing finally and is
  released exactly once through `fn_f06_cancel_prepared_hand`; a lost receipt
  is replayed with the same identity by the next attempt (2026-10-15 door).
  The loop then goes round through the same pause handling, with no hand to
  present.
- `F06HandPermit`: a `fn_f06_begin_hand` refusal that names a reason
  (`PRE_INSERT_REFUSALS`, every reason SQL returns before its insert) is proof
  that no permit exists. It used to leave the permit `unknown`, so a table
  refused for a break's `source_excluded` replayed the same begin, got the same
  refusal and looped on its error backoff. The slot is now free and the next
  attempt reads the exclusion fresh and holds for the break.
- NOT moved: the seq-0 retention. A retained prepared original that meets a
  polled hold is fenced (`retained_original_start_unproven`), so it stays after
  the last look. It is the one round trip a tournament deal still makes after
  the rest, and it sits inside `ENGINE_BETWEEN_HANDS_BUDGET_MS`.

## The standard

`owedBetweenHandsMs` / `ENGINE_BETWEEN_HANDS_BUDGET_MS` (handCompletionSpec),
the law `server/src/engine/noUnintendedDelayBetweenHands.law.test.ts`
(waterfall per shape, measured deal timing, every await on the path named),
and the production grade `scripts/sql/hand-gap-unintended-delay.sql`.

## Proof

- Native PostgreSQL: `scripts/ci/test-f06-permit-reserved-under-rest-postgres.py`
  installs production's exact bodies (md5 of `pg_get_functiondef` equal to
  production on 2026-11-18) and proves the permit lifecycle, 25 cases.
- `server/src/engine/ThePermitIsReservedUnderTheRest.test.ts` drives the real
  dealHand through every hold, a lost release and a reasoned refusal.

## Expected

Tournament fold p50 3.85 s -> about 3.55 s (rest 1.5 s + one retention trip,
about 0.15-0.2 s, instead of three trips); tournament all-in showdown about
1.0 s lower with #11302. Cash unchanged.
