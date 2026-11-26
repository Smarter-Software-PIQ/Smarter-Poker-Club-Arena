# The cluster tick names the tables it planned moves from (2026-11-24)

## What was wrong

Incident 1e532243 (unintended delay between hands). The must-move tick reported only `{ moves_planned: n }`, so the engine raised the plan signal for the whole game (`noteMovesPlanned(gameId)`). At the end of its 1,500 ms rest, every cluster table whose rest straddled the plan went round its dealing loop once more (`seatBoundaryChangedUnderRest`). In practice that was the DESTINATION Main: a player leaves it, the vacancy wakes the tick at once, and the plan lands inside that Main's own rest. The second pass deals a roster identical to the one it threw away (two manifest captures with the same seats, occupancies and stacks) about 840 ms late.

On production in 14 h, this caused 41 of the 61 slow cash transitions. 39 of them were on the destination table (26 on Main 1, 13 on Main 2). It is the delay that refused Backup certification of 19203b9a1f0b (cash `showdown_checked_river`: 1 of 14 hands at +1,422 ms).

## Change

**File:** `supabase/migrations/20261124172239_the_cluster_tick_names_the_tables_it_planned_moves_from.sql`

**What existed:** the `fn_cash_cluster_tick_uncapped` production body, md5 `ff71ce506a92527349e8a6dfeae25c71`. It is kept verbatim as `scripts/ci/fixtures/cluster-tick-source-table-ids/production-preimage.sql`.

**What changed:** an anchored edit that adds three things:

- a `v_move_sources uuid[]` declaration;
- an append of `r.table_id` at the Step 2 must_move increment;
- `'source_table_ids', to_jsonb(v_move_sources)` on the sole `moves_planned` emission.

The edit refuses unless each anchor occurs exactly once and the body does not already carry the change. It then checks that the result replaces back to the exact pre-image, and that owner, ACL, SECURITY DEFINER, search_path, volatility, argument types, defaults and return type are all unchanged.

**Why:** this is the root cause. The engine (PR #11926, `tickPlannedSourceTableIds`) signals only the named source tables, so the destination Main deals on its rest.

**Not changed:** the balance (Step 3) and break (Step 5) plans. They increment `v_moves` only after the sole emission, so the tick has never reported them, and no signal was ever raised for them. Reporting them would be a new game-wide signal on today's serving engine.

## Proof

`scripts/dev/prove-the-cluster-tick-names-its-plan-sources.sh`, run in a throwaway local PostgreSQL:

- Applied to the exact production pre-image, the body diff is two added lines and one changed line, the authority is unchanged, and a second apply is refused.
- In the behaviour model, the key is missing before the migration and equals the inserted rows after it (`ok:3`). A tick that plans nothing emits no `moves_planned` action.

The law that runs it: `tests/the-cluster-tick-names-the-tables-it-planned-moves-from.law.test.ts`.
