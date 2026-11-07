# Horses list for several games, a new table fills from its list, and a table breaks visibly

Owner, 2026-11-07: "GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS."

## Change #1 — Several waiting lists at once (engine)

**File:** server/src/services/HorseGameQueue.ts, HorseFleetManager.ts (syncHorseGameQueues)
**What existed:** one line per horse; a second row was cancelled. A game with any open chair cleared its horse line.
**What changed:** a horse lists for up to 2 or 3 games (fixed per horse), all comparable: same variant family (PLO4/5/6 are one family) with big blinds at most 2x apart. A horse seated at any table (including seats taken this cycle) leaves its other lists at once; the row of the game it sat in is left for the tick to mark 'seated'. A seated horse joins no list. A game that is no longer full keeps its line (adds nobody) so the line is called into the open chair.
**Why:** people already list for several games (cash_game_waitlist_one_open is per game and player; fn_cash_game_join caps nothing else). Same rules for horses.

## Change #2 — A table fills from its list, one name at a time (DB + engine)

**File:** supabase/migrations/20261107195847\_…sql (fn_cash_cluster_tick offer step); server/src/services/HorseListFeedsTable.ts and the seeding loop.
**What changed:** the tick calls a table's next name only when the last one has sat (no live hold) and 20 s after the last arrival, through fn_offer_open_seat (FIFO, same 'Seat Open' notice). The fleet sits no horse straight into a game whose list has anyone on it, or whose breaking table still holds players.

## Change #3 — An unpicked second table is broken, not drained (DB + engine)

**File:** same migration (BREAK step); HorseUnionCashPlan.horseCashPlanTablesAwaitingBreak; HorseSessionRotator.
**What changed:** a game with more live tables than its cap (the cap carries fn_cash_game_second_table_picked) breaks its newest table through the ordinary BREAK path once every person fits on the rest: 'table_break_started', 'break' moves ("This Table Is Closing. Moving To Main 1 After This Hand.") in roster order. Players without a chair stay dealt in and are first for each chair (must-move draws the breaking table first). The rotator no longer stands every horse up at a dropped second table; they are moved by the break.

## Hit and run

No new voluntary table leave. Leaving a list writes cash_game_waitlist only. A break move is forced and keeps the stack. The only voluntary exit left for those horses is engine.leaveTable, which applies the hit-and-run rule to horses and people alike.

**Tests:** server/src/services/HorseGameQueue.test.ts, HorseListFeedsTable.test.ts, HorseTableBreak.test.ts; tests/a-new-table-fills-from-its-list-and-a-table-breaks-visibly.law.test.ts.
**Real-time law:** no new UX; the existing 'Seat Open' notification and seat-move notices carry it, no snapshot diff.
