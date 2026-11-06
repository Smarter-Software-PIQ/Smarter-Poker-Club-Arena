# server/src/maintenance/aReservedHandThatNeverStartedDoesNotHoldTheRestart.law.test.ts

A tournament hand whose number was reserved and whose sequence-zero original was retained, but which the maintenance break held at the pause gate before it was dealt, is parked for the restart census, not `cards_in_air`: no card is dealt, no chip is committed and no writer is in flight, the next generation reclaims the same original, its time banks are still asked separately, and every other table with a hand controller still holds the restart gate shut
