# server/src/engine/AShowdownHandKeepsItsMemoryDomain.law.test.ts

Settlement reads the facts it needs from a hand's own controller (the blind
snapshot behind the public memory domain, and the all-in runout witness)
before its first await, and hands them to the post-hand tasks. The post-hand
tasks never read the live controller: by the time they run, the dealing
listener may have released the hand and cleared it.

Why (HVH2D-EXE-002, 2026-11-12): a cash showdown awaits the jackpot drill, the
controller was cleared during that await, and every ordinary cash hand that
reached showdown was written without its public memory domain, which the
opponent-memory learner requires. Hands without a showdown were unaffected, so
the profiles were built from a sample selected by outcome.

The test drives a real engine and controller through a heads-up cash showdown
with the drill answering a tick late and the controller cleared in that tick,
and pins the source: no `this.handController` inside postHandTasks, and the
capture in settleCompletedHand sits before its first await.
