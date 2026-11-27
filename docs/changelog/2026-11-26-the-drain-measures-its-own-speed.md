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

## Found Live On The 1 AM Seal: A Wait Ended When A Game Left The List

The first read of `owed_starts_made` on a seal that carries #12150 (the 1 AM CST seal `f2b854319ea9`, read at 11:20 AM CST Nov 27 over 1,185 heartbeats) reported 114 owed games started with a median wait of 2 minutes. That was false.

Why it broke: a wait was an island of consecutive heartbeats on which a game was owed, so a game counted as started the moment it left the owed list. One game, PLO4 1.00/2.00 Lightning Games, left and re-entered the list 104 times while it was dealing on its one table. Every exit read as a start. The other games were each owed in one unbroken run. The metric measured list membership, not starts.

The fix: a wait now ends at the game's first cash hand dealt (`hand_history`, any table of the game), which is what a start is. An owed heartbeat within 3 minutes after a hand of that game is a game that is dealing, not waiting, and is not counted. Measured this way the same window had 11 real starts with a median wait of 429 minutes, and 18 games still waiting (matching the heartbeat's owed count exactly).

Also fixed: a wait that began before the window (a game already owed at the release) is cut at the window start. Both rows now say how many waits began before the release, and that those waits are minimums.

What the drain did in that window: nothing, correctly. No game ever had a second occupied table (hand history per hour, 1 AM to 11 AM CST), so there was no Horse-only extra table to release. Overnight the cap had free room (8 to 15 tables allowed, 6 to 8 dealing), so the starts were held by Horses on shift, not by table slots. From 10 AM the cap was full (17 of 17), with every counted table the only table of its game.

Law: `tests/unit/varietyDrainLiveCheck.test.ts` ("a wait ends at the game's first dealt hand", "a wait that began before the window says it is a minimum"). Both fail on the previous SQL.
