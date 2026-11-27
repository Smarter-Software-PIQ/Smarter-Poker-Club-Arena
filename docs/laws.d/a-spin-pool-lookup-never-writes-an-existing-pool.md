# tests/a-spin-pool-lookup-never-writes-an-existing-pool.law.test.ts

fn_spin_reserve_pool is a lookup: when the club's pool row already exists it returns the owner without an INSERT, because a BEFORE ROW INSERT trigger fires even on ON CONFLICT DO NOTHING, and the retired-club guard on spin_bonus_pools made every spin draw queue behind the clubs row (nine fn_spin_draw_and_settle_atomic lock-timeout 500s on 2026-11-26); only a missing pool is inserted, and the function stays service_role only.
