# Wheel race releases on observed contention

The private full-wallet race held its first transaction for two seconds while inheriting a two-second financial lock timeout. Runner scheduling could therefore time out the second spin before the deliberately sleeping first owner committed, even though the unchanged financial transaction correctly serialized it.

The fixture now holds the first transaction on its input FIFO, observes the second backend blocked by that exact owner, then commits the first. It retains the real money RPCs, inherited lock timeout, statement deadline, one-debit result, zero remaining diamonds and unconsumed second ticket assertions. Failure cleanup rolls back and closes only the private fixture sessions. No production wheel function, money lock or payout rule changes.
