# The night is reached gradually, and an owed leave plays on in its game (2026-11-14)

Follow-up to Dan's Lightning staffing order (2026-11-13 14:56 Chicago): "MOST
TABLES RUNNING FROM 5PM-11PM AND THEN SLOWLY DYING DOWN TO AND DROPPING DOWN TO
A HANDFULL OF TABLES FROM 3AM-8AM", and his 2026-11-14 09:42 instruction to
build every follow-up found while verifying it.

## What was measured (serving 06d45e7d5, 2026-11-14)

| Chicago hour | target bodies | live bodies | live seats | seat ceiling at :00 |
| ------------ | ------------- | ----------- | ---------- | ------------------- |
| 00           | 191           | 261         | 726        |                     |
| 01           | 134           | 274         | 584        | 261                 |
| 02           | 78            | 218         | 348        | 217                 |
| 03           | 30            | 113         | 143        | 39                  |
| 04           | 30            | 35          | 43         | 39                  |

- The curve fell from 35% at midnight to 16% at 02:00, then the night cap took
  the target to 30 bodies at 03:00. The seats-per-horse ceiling also dropped
  from 2.2 to 1.3 at 03:00, so the seat ceiling fell from about 217 to 39 in a
  single minute.
- The wind-down planner asked for about 100 stands per 30-second cycle from
  01:00 to 03:00, and the executor ran 4. The floor sat over its curve all
  night and then met the night cap as a cliff.
- Lightning PLO4 .50/1 sat at 0 players from 00:27 to 08:05, because its only
  open table was a feeder. Feeders ranked after every Main among the seeded
  Lightning starters, so the other four starters took each chair the ceiling
  freed.
- When Lightning NLH .25/.50 switched off at 03:33, nine held leaves were
  released, each left alone at a former anchor table. Their sessions closed
  as `system` with 0-3 of 10 owed hands played, while the same game dealt 23
  hands at another table over the next 45 minutes.

## What changed

1. **A gentler taper** (`StableHand.OCCUPANCY_CURVE_PCT`). The curve now reads
   22:00 37%, 23:00 33%, 00:00 28%, 01:00 22% and 02:00 16% (was 38, 36, 35,
   28, 16). The 5-11 PM peak is unchanged.
2. **The night is reached, not dropped into.**
   - From 02:00 to 03:00 the body target walks from the curve to the night cap,
     instead of landing on twice the cap at 02:59.
   - The seats-per-horse ceiling walks from 2.2 to 1.3 over the same hour.
     `hostSeatCeiling` and `seatsPerHorseBand` take the minute, and both the
     seeder and the controller pass it.
3. **Wind-down keeps up** (`StableHandExecutor.windDownCapForHost`). Each host
   runs one extra stand per ten planned, at least 4 and at most 10 per cycle.
   The planner still takes one seat per table per cycle.
4. **Every seeded Lightning game gets its turn**
   (`HorseUnionCashPlan.compareLightningStarters`). Among starter tables, the
   game with the fewest players goes first, whatever the table's role.
5. **An owed leave plays on in its game**
   (`ServerTableEngineBase.owedLeavePlaysOnInGame`).
   - Before a held leave that still owes hands is released for having nobody
     at its table, the engine asks `fn_owed_leave_plays_on_in_game`. The
     migration ships separately, after the seal.
   - While another table of the same game deals, the seat stops pending and
     keeps its blind off, and the game's consolidation moves it to that table.
     There the restored hold plays the count out.
   - The database bounds the wait and records every answer, so a waiver is
     visible in a table rather than only in a server log.
   - A missing function or an unreadable answer releases the seat as before.

Person and horse twins in the engine specs; nothing reads horse identity.

## Delivery order

The engine pull request ships in the daily 04:00 cutover. The door function
and its native qualification follow after that seal, so the night's Backup
certificate is not invalidated.
