# Settlement Holds Its Hand Through Awaited Alerts

2026-11-12. Hold'em Strategy lane. Finding SWEEP-001 from the verifier's sweep
of `server/src/engine/ServerTableEngineSettlement.ts` after HVH2D-EXE-002.
Phase 2 hardening of that fix. No migration, no backfill, no replay.

## What Was Wrong

When a hand finishes, settlement sends a critical alert and waits for it in
two rare cases: an insurance fee larger than the stack it is taken from, and
an EV cashout redirect larger than the stack. While settlement waits, the
table can release the finished hand and clear its controller. The steps after
the alert looked the controller up again, found none, and quietly did nothing:

- the insurance stack changes were not applied to the hand's own state, and
- the seven-deuce bounty step was skipped entirely, so the bounty was not
  collected or paid on that hand.

This could only happen on a hand where one of those two alerts fired. It has
not been observed in production and its frequency was not measured.

## The Correction

Settlement now takes the hand's controller once, at the top, before it waits
for anything, and uses that same reference to the end. It never looks the
live field up again.

## Proof

`ASettlementHoldsItsHandThroughAwaitedAlerts.law.test.ts`: a real engine and
controller play a heads-up cash showdown in which the insurance alert fires,
answers a tick late, and the controller is cleared during that tick. The
insurance changes still reach the hand's state. Two source checks keep it
that way. All three fail on the previous source and pass now.

## Limits

The table broadcast sent right after the seven-deuce step still reads the
live field, so on such a hand the refreshed stack numbers can reach clients
with the next hand's first broadcast instead. Money and stored stacks are not
affected by that.
