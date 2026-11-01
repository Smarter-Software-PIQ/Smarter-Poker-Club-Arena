# Scoped opponent eviction retires its dirty keys

HorseMind capped its scoped opponent rows but retained the evicted rows' dirty keys until a persistence export. Without an intervening persistence export, repeated eviction could accumulate orphan bookkeeping even after the corresponding observations were evicted.

Scoped eviction now removes only the evicted dirty keys, matching the existing pooled-player and pair-cache cleanup. Surviving observations remain dirty and exportable; a failed persistence request can still requeue surviving rows. No strategy, cache capacity, durable data, routing or hand state changes.

A regression crosses the existing capacity through real Omaha observations. It fails before the correction with 16,002 dirty keys for 12,001 surviving rows, then verifies surviving observations and persistence requeue behavior. This establishes a concrete memory-retention defect; it does not establish the cause of the production exit-139 incident or certify live memory stability.
