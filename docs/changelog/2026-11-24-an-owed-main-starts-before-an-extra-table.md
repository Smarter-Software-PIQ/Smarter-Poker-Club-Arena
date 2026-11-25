# An owed Main starts before an extra table (2026-11-24)

## What was wrong

Short Deck, Pineapple, FLO8 and PLO8 cash (and NLH .05/.10, .10/.25, .50/1, PLO4 .50/1 and 1/2, PLO6 1/2, most FLH stakes) dealt no hand after their normal nightly close on 2026-11-23 (08:43-08:49Z). Each is an enabled plan game with an empty Main 1. The hourly cap (25) was full: ten games held 33-41 tables, up to four each.

- #11773 (owner ruling 2026-11-22, "a full game always has a waiting list, or one chair open") gives every full game a Horse waiting list.
- `fn_cash_cluster_tick_uncapped` (every 5 s) opens a waiting-list feeder whenever `fn_cash_hourly_feeder_admissible(game)` sees census + empty opening feeders < cap (20261118165301, 20261121174545). That question did not know about plan games with no table, and the tick runs six times per fleet walk, so every freed slot became another game's feeder, then Main 2/3.
- The 2026-11-18 rule (#11346, `HorseVarietyFirst`) held extra tables only in a fleet cycle whose cap already admitted an owed start (`varietyHoldsThisCycle`), so at a full cap it held nothing.

Diagnosis: `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-01BNteGZ/gm/DIAGNOSIS.md` (helper GM, read-only).

## Change #1 - the opener counts owed starts

**File:** `supabase/migrations/20261124072701_an_owed_main_starts_before_an_extra_table.sql`
**What existed:** `fn_cash_hourly_feeder_admissible` as 20261121174545 installed it (md5 a7f507e81cdf5e6005ae94405481a8e6): `census + opening feeders < cap AND floor clock free`, or a person on the game's line.
**What changed:** the same body redefined in full with one more term in the cap sum: `+ (SELECT o.n FROM owed o)`, the games the Horse fleet's newest heartbeat (at most 90 s old) lists in `detail.variety_owed_games`, other than this game, enabled, with no occupied table. An extra table opens only if every owed start still fits after it. Preimage pinned; definer, STABLE, search_path, owner and grants read back; probe executes the body before commit.
**Why:** root cause; the database's own extra-table question now asks the variety rule, so the 5 s tick cannot outrun the 30 s walk. No cron, watcher or repair loop.

## Change #2 - the fleet holds at a full cap and publishes the owed games

**Files:** `server/src/services/HorseVarietyFirst.ts`, `server/src/services/HorseFleetManager.ts`
**What existed:** `varietyHoldsThisCycle(plan, { withheld, admitted })` held extra tables only if `admitted(owedTable)` for some owed start.
**What changed:** `varietyHoldsThisCycle(plan, { withheld })` holds whenever the cycle is seating and a start is owed; new `varietyOwedGamesThisCycle` names the owed games (empty when withheld). The fleet clears them before the hourly read, sets them from the same decision as the hold, and carries them on the heartbeat as `detail.variety_owed_games` (no schema change: `fn_ca_fleet_state_upsert` stores `detail` as given).
**Why:** at a full cap the only things keeping an owed start out are the cap and the floor clock, both temporary; holding lets a held opening feeder lapse instead of keeping the reservation, and the database reads the same list.

## Unchanged

The waiting list (#11773), the cap and hourly ranges, the floor clock, a person on the line, every other tick branch, must-move, promotion, closures. Install order is safe either way: before the engine serves, no heartbeat carries the key and the opener answers as before.

## Verification

- `scripts/ci/test-an-owed-main-starts-before-an-extra-table-postgres.py` (PG17, production's rebuilt bodies; CI step "An owed Main starts before an extra table"): red on the installed body, green after the migration.
- `tests/an-owed-main-starts-before-an-extra-table.law.test.ts`, `server/src/services/anOwedMainStartsBeforeAnExtraTable.law.test.ts`, `server/src/services/aPlanGameWithNoTableStartsFirst.test.ts` (updated for the full-cap hold).
