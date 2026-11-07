# tests/an-unknown-finish-outcome-alarm-closes-on-its-single-receipt.law.test.ts

An unknown finish outcome closes only on proof that the finish committed exactly once: one counted terminal receipt written at or after the alarm, its prize and bounty pools equal to the tournament's, the payout rows conserving the prize pool to the cent, and the escrow terminally closed at zero - a second receipt is a double commit and keeps the alarm open, and elapsed time never closes it.
