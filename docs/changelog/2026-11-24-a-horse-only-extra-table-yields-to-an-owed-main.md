# A Horse-only extra table yields to an owed Main (2026-11-24)

Part 2 of `2026-11-24-an-owed-main-starts-before-an-extra-table.md` (#11909, migration 20261124072701).

## What was wrong

#11909 served from 16:00:37Z. At 17:22Z it worked at the margin (a cap rise 16 -> 17 went to an owed game), but 11 of the 17 counted tables were extra tables opened 13:15-15:00Z, before it served: NLH 1/2 Classic, PLO6 .50/1 Classic and PLO5 .10/.25 Classic three tables each, PLO4 .10/.25 Classic two. All held only Horses and no Horse left any of them in 60 minutes. #11909 stops NEW extra tables taking a freed slot; nothing freed one, so the 25 owed games could start only when the cap rose.

Root cause: the fleet kept every table it had once filled. Its walk refills a seat the moment one empties, the session rotator's departures are all paced to keep a healthy floor, and nothing knew that an extra table was holding the slot a game with no table is owed.

## Change #1 - which table yields (HorseVarietyFirst)

**File:** `server/src/services/HorseVarietyFirst.ts`
**What changed:** new pure `varietyDrainTable`, `owedStartsFit`, and a fresh-for-90-s publication (`publishVarietyDrain` / `varietyDrainingTable`). While a start is owed and the owed starts do not fit under the cap (the database opener's own sum: counted tables + empty opening feeders + owed starts against `table_cap`; an admitted owed start or a failed read fits), ONE extra table is released: the top of its game's ladder (the live feeder, else the highest Main above the lowest), because every Main draws upward from higher Mains and feeders (20261124003437/#11875/#11884) and the top is never refilled by the ladder. Never the game's lowest Main (Main 1), never a table with a person, never a game with a person on its list, never Lightning, never a game mid-break, only where another of the game's tables is occupied. Fewest Horses, then newest; the current one keeps draining while it qualifies.

## Change #2 - the fleet keeps no Horse there

**File:** `server/src/services/HorseFleetManager.ts`, `server/src/services/supabase/cashHourlyTables.ts`
**What changed:** after the variety hold, the fleet reads the cap and census (`readHourlyCashRoom`: `fn_cash_hourly_table_range`, `fn_cash_hourly_table_capacity_census`, both already granted to service_role), picks the table, adds it to `surplusTableIds` (the existing doors: the walk seats nobody there, a seat call there is not answered) and publishes it; the heartbeat carries `detail.variety_drain_table`.

## Change #3 - its Horses go home through the ordinary door

**File:** `server/src/services/HorseSessionRotator.ts`
**What changed:** one Horse per rotator cycle (90 s) at the published table leaves through `engine.leaveTable` (the door every rotator departure and a person use: `leave_pending`, cashed out at the end of the hand). Not while a stay clock, owed hands in profit (hit and run) or a big-pot orbit holds the seat; never beside a person; never at a table the cluster tick is breaking (the break moves its Horses, owner 2026-11-07). The empty table closes by its game's controller; the slot goes to the owed Main 1 (#11909 already keeps feeders off it).

## Unchanged

No migration, no cron, watcher or repair loop. Waiting lists for people (#11773), the cap, the floor clock, must-move and the upward ladder, breaks, Lightning pools, Main 1.

## Verification

`server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts` (selection rule, the fleet's wiring, and the real rotator driven through a fake PostgREST); fails on origin/main. tsc on every server config; the server tests that read the fleet, rotator, variety, waiting-list, feeder and ladder code; root laws touching the fleet.

## Method for the next agent

After a fix: look for the state the fix does not reach (here, tables opened before it served), find which existing loop keeps that state alive (the fleet's refill), and release it through the existing doors rather than a new loop. Then pin each rule with a test that fails on the old code.

## 2026-11-25: The Two Functions The Fleet Reads Are Declared

**File:** `scripts/ci/schema-manifest.d/an-extra-table-yields-to-an-owed-main.json`
**What changed:** `fn_cash_hourly_table_range` and `fn_cash_hourly_table_capacity_census` are declared in this change's own manifest fragment. Both are installed in production and granted to service_role, but the base schema snapshot predates the hourly cash caps, so the hosted phantom-reference gate refused the two literal `.rpc()` names.
**Why it broke:** the local pre-push run has database credentials, asks the live schema and passes a stale snapshot; the hosted run on a pull request has none and judges the snapshot alone. The same change therefore passed locally and failed on GitHub.
**How to check before pushing:** `env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY node scripts/ci/check-phantom-tables.mjs` must print 0 phantoms whenever a change adds a literal `.rpc()` or `.from()` name.
