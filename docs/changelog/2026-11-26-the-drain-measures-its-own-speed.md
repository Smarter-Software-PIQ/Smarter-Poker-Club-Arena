# The Drain Measures Its Own Speed (2026-11-26)

Follow-up to `2026-11-26-the-drain-holds-through-an-undecided-cycle-and-paces-at-the-rotator.md` (#12150).

## What Was Missing

The live check proved the drain safe, not fast. It could not say how long a game owed a start waited, and it judged the hourly cap only at the moment it ran. Among equal choices the drain also picked a table without regard to Horses still owing hands in profit, which empty more slowly.

## Why

The heartbeat carried the owed games and released tables but not the cap it read, and nothing turned the owed lists into waits. The drain's choice had no input for hands owed.

## The Change

**Files:** `server/src/services/HorseFleetManager.ts`, `server/src/services/HorseVarietyFirst.ts`, `server/src/services/supabase/cashHourlyTables.ts`, `scripts/sql/variety-drain-live-check.sql`

- The heartbeat carries `detail.cash_room` (`cap`, `counted`) whenever the cycle read the hourly room.
- `readHandsOwedByTable`: open cash sessions with an incomplete hit-and-run count, per table; read once, only when a new table may be added and starts are short; a failed read is no preference.
- `varietyDrainTables` takes `owingAt`: among new candidates, the table whose Horses owe fewest hands goes first, then the fewest Horses, then the newest. Kept tables never change because of it.
- Live check rows: `cap_every_cycle` (FAIL if any beat read more counted tables than its cap; INFO until a build writes `cash_room`), `owed_starts_made` (games that started since the release, median and longest wait) and `owed_waiting_now`. Waits are islands over heartbeats that carry an owed list, so a withheld cycle never splits a wait.

## Baseline

On the 4 PM CST seal before #12150 (read 8:35 PM CST): 22 owed games started, median wait 119 minutes, longest 183; 2 still waiting, longest 79 minutes. The same rows after the seal that carries #12150 and this change are the measure of both.

## Hardening

`anExtraTableYieldsToAnOwedMain.law.test.ts`: the owing preference (with and without a read, a nonsense count, kept tables unchanged); the reader counts only open, incomplete, short sessions; the read runs only when a new table may be added; the beat carries `cash_room`. `tests/unit/varietyDrainLiveCheck.test.ts`: the new rows, the INFO verdict before the field exists, the cap comparison and the withheld-cycle-proof islands.
