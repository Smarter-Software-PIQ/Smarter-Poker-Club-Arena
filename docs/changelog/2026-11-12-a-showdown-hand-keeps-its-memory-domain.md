# A Showdown Hand Keeps Its Memory Domain

2026-11-12. Hold'em Strategy lane, assigned by the owner. Finding HVH2D-EXE-002
of the two-day Human vs Horse study. Engine source:
`server/src/engine/ServerTableEngineSettlement.ts`. No migration, no money
movement, no backfill, no learner replay.

## What was wrong

On ordinary cash tables, every hand that reached a showdown between two or
more players was written to hand history without its public memory domain. In
one production hour on release 08c27924 that was 589 of 589 such hands, against
0 of 1,493 cash hands that ended without a showdown. Tournament and Lightning
hands were not affected. The opponent-memory learner skips a hand without a
valid domain, so on cash tables Horses' exact opponent profiles were learning
only from hands in which nobody showed cards. Present since the domain was
introduced on 2026-11-07.

## Cause

Settlement awaits the Bad Beat Jackpot drill on a cash showdown. During that
await the dealing listener releases the hand and clears the hand's controller.
The post-hand tasks then read the blind snapshot from the live controller,
found none, and wrote no domain. A hand with no showdown has no such await.
The all-in runout witness was read at the same late point.

## The correction

`settleCompletedHand` reads the blind snapshot and the all-in runout witness
from the hand's controller at its top, before any await, and passes them to
`postHandTasks`. `postHandTasks` no longer reads the live controller at all;
with no facts handed to it, it writes no domain rather than one taken from
whatever hand is live.

## Proof

`server/src/engine/AShowdownHandKeepsItsMemoryDomain.law.test.ts`, 3 cases. A
real engine and controller play a heads-up cash hand to showdown with the
drill answering a tick late and the controller cleared in that tick; the
post-hand tasks receive the blinds of their own hand. Two source cases pin
that `postHandTasks` contains no read of `this.handController` and that the
capture sits before the first await. With the source change reverted all 3
fail. Registered in `docs/laws.d/a-showdown-hand-keeps-its-memory-domain.md`.
The payload-retry harness now hands the facts down the same way settlement
does.

## Limits

- Hands already written without a domain stay as they are. Profiles begin to
  learn from cash showdowns with the release that carries this.
- The effect of the missing hands on any decision was never measured, so no
  improvement in play is claimed.
- Not live until an engine release contains it.
