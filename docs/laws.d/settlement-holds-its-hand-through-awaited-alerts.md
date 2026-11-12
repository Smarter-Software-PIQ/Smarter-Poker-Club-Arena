# server/src/engine/ASettlementHoldsItsHandThroughAwaitedAlerts.law.test.ts

`settleCompletedHand` takes the reference to the hand's controller once,
before its first await, and every later read in the method uses that
reference. It never reads `this.handController` again.

Why (SWEEP-001, 2026-11-12, same class as HVH2D-EXE-002): settlement awaits a
critical alert when an insurance fee or an EV cashout redirect is larger than
the stack it is taken from. While it is suspended the dealing listener can
clear the engine's controller. The code after the alert read the live field,
so on such a hand the insurance stack deltas were not applied to the hand's
state and the seven-deuce bounty block was skipped entirely.

The test drives a real engine and controller through a heads-up cash showdown
where the alert fires, answers a tick late and the controller is cleared in
that tick, and pins the source with comments stripped: the reference is taken
before the first await and no read of the live field follows it.
