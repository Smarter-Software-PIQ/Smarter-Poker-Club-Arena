# Rabbit Hunt: A Bought Run Out Is Kept In Either Write Order (2026-11-02)

- Migration `20261102181258`: when the engine's saved run out (`rabbit_hunt_offers`) is written after a reveal receipt, the reveals already recorded for that hand are kept for their buyers. Auto Run buys at hand end, so its receipt can land first.
- Index `idx_rabbit_hunt_reveals_table_hand` for the lookup. Idempotent in both orders; the first kept slice is never overwritten.
- Native PG17 coverage added to `scripts/ci/test-rabbit-hunt-enhancements.sh`.
- The two staff doors fail closed: `fn_is_platform_admin()` answers NULL for a signed-in account with no profile row, which `NOT` let through. Now `IS NOT TRUE`.
