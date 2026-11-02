# tests/engine-release-abandoned-routine-cycle.law.test.ts

An expired routine cycle whose owner recorded a durable terminal failure is retired by the next transaction only when the canonical failure receipt matches its exact identity, no transaction is live, and none of the dead owner's native units remain enabled; every missing proof fails closed and the owner stays authoritative.
