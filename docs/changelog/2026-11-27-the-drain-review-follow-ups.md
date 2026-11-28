# The Drain Review Follow-Ups

2026-11-27, HORSE DECISIONS lane. The three findings that docs/changelog/2026-11-27-a-withheld-cycle-keeps-the-drain.md left unchanged ("Review Findings Not Changed"), fixed at the root.

## What Was Wrong

1. **The tie-break counted seats the engine lets leave.** `readHandsOwedByTable` counted an open session with an incomplete hit-and-run count as owing, whatever the seat's stack. A Horse that had fallen below its baseline (or whose countdown the engine never acknowledged) owes nothing to the engine and leaves at the next sweep, yet its table was ranked behind tables that really empty in one sweep. A session that had finished the countdown but still owed the Charles big-win hands was not counted at all.
2. **`no_rejoin_while_named` failed after a drain ended legitimately.** It counted any Horse seat that joined within 10 minutes after an owed beat that named the table. Once the drain un-named a table (the start was made, or a person sat down), the walk and break moves seat Horses there again, as they should, and the check read that as churn. On the window from the 2026-11-28 01:02Z release: 16 by the old form, 0 by the new one.
3. **Waits that began before the release were only minimums.** The live check could see a wait only from the first beat in its window, so every game already owed at the release was reported with a minimum wait.

## Why

1. The read filtered on the session row alone (`closed_at IS NULL`, `hr_completed = false`, `hr_hands_required > hr_hands_played`). The engine's rule (`fn_cash_session_hands_owed`, 20261111174148, over `fn_cash_hit_run_hands_remaining`, 20261106203853, and `fn_cash_big_win_hands_remaining`; `ChipContinuity.hitRunHandsRemaining` in the engine) also needs the engine acknowledgement and the seat's current stack.
2. A 10-minute window after a naming is not "while named". A beat is also written at the END of the cycle that decided and seated, so a Horse seated by the cycle that ended the drain joins before the beat that un-names the table.
3. The heartbeat carried the owed list but not when each game first joined it.

## The Fix

1. `cashHourlyTables.sessionHandsOwed` (pure) is `fn_cash_session_hands_owed` in TypeScript: the larger of the countdown (acknowledged, not completed, hands left, stack above baseline) and the big-win count (acknowledged, hands left, chips at the table). `readHandsOwedByTable` reads the open sessions and the seats' current `table_seats.stack` and counts a seat only when it owes hands by that rule; a session with no live seat counts 0, as the engine's `hitRunHandsOwed` does. A failed read still returns null (no preference).
2. `no_rejoin_while_named` counts a Horse seat only when a beat with a start owed named the table at or before the join, no beat from that naming to the join un-named it, the newest beat before the join is under 65 s old (`VARIETY_DRAIN_FRESH_MS`), and the first beat after the join still names it. Still one read-only `WITH` statement.
3. `HorseVarietyFirst.varietyOwedSince` (pure) keeps each owed game's first-owed time across cycles: a seating cycle keeps it for every game it publishes, stamps a newly owed game, and forgets a game it no longer publishes; a withheld cycle forgets nothing (the rule of `drainCycleOutcome`). The fleet holds one memory, assigned only from it, and the heartbeat carries it as `detail.variety_owed_since`. The live check times a wait that began before the window from it (never earlier than the game's last dealt hand before that wait) for `owed_starts_made` and `owed_waiting_now`, and keeps the minimum label only for waits without it. Heartbeat detail only, no migration.

## Pinned By

- `server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts`: "the tie-break counts only seats the engine treats as owing" (a table whose only owing Horse is below its baseline counts 0) and "the heartbeat carries when each owed game was first seen owed".
- `tests/unit/varietyDrainLiveCheck.test.ts`: "a Horse seat counts as a re-join only while the table was still named" (the 10-minute window form is gone) and "a wait that began before the window is timed from the first-owed time on the heartbeat".
