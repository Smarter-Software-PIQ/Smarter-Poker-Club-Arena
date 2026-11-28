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

## Found Live On The 7 PM Seal: The Drain Freed Slots For Games That Cannot Start

### What

On the 7 PM CST seal (fd425990c0b8), from 8:05 to 9:47 PM CST, the drain released Horse-only extra tables 11 times, and several were un-named and refilled (one feeder went through 4 naming runs and 6 Horse re-joins). The owed starts never dropped. 215 of the 342 heartbeats from the seal to 9:57 PM CST owed exactly two games, both 5/10 fixed-limit Classic games (cluster 0736e5db, a hi-lo game, and 580989b9, Hold'em), each with one live, empty Main 1 that has never dealt a hand since it was created on Nov 3; 117 beats read `nothing_owed`.

### Why The Starts Fail

No Horse can fund a 5/10 seat. A 5/10 seat needs 20 buy-ins of 100 big blinds behind it (`StableHand.isLicensed`: 20,000 chips) and the Horse's own temperament on a 1,000 reference buy-in (`HorseBankroll.canSit`: 12,000 to 40,000). Read live: the Horses that play this host's games draw on two member-club wallets; of 642 Horses in one, 2 hold 20,000 or more (the richest 25,795, and one of those two is tagged for tournaments only), and of 500 in the other none does (richest 17,947). An empty table also needs two sittable Horses (the lone-seat rule). The host's 2/5 fixed-limit games deal, seated by Horses holding 9,000 to 13,000. So the walk reaches the admitted 5/10 Main 1 and seats nobody, for a reason of the game's own. That is a Horse bankroll and game catalogue matter (the Horse bankroll and stake supply owners, and whoever decides which stakes are offered), not this lane's code.

### Why The Drain Broke

The drain did not know why a start failed. Each run: owed 2, the cap full, a table released, its Horses left, counted 39 under cap 40, the walk tried the owed game and seated nobody, the game rested for `VARIETY_START_REST_MS` (5 minutes), the owed list went empty, a decided cycle with nothing owed cleared the drain's memory (`drainCycleOutcome`), the released table was un-named and refilled, the rest ended, owed 2 again, a new table released. About every 8 minutes a real slot was freed and given back for games that cannot start. The live check did not see it: #12297's fourth condition on `no_rejoin_while_named` ("the first beat after the join still names it") excused exactly these re-seats, which were the 11 joins it removed.

### The Fix

1. The walk reports why (`HorseFleetManager`, the variety block of the seeding loop). An owed start reaches it only when the hourly projection admitted the table. A door refusal for the hourly cap is `cap_blocked`; nobody seated with no cap refusal and no floor-wide stop is `own_reason`. Floor-wide stops still note nothing.
2. `VarietyStartMemory` records it. `own_reason` rests the game as before and marks it; the mark outlives the rest and goes when the game starts, when an attempt is refused only by the cap, or when the game is neither owed nor resting (`forgetAllBut`, once per cycle). `cap_blocked` rests nothing and clears the mark.
3. `drainOwedGames` (pure): the drain's owed set is the published owed games minus the marked ones. The cap read, the admitted check, the shortfall, the decision and `drainCycleOutcome` all use it, so a game that cannot start never drives a release, and its rest never empties the drain's owed set while a cap-blocked game is still owed. `drainCycleOutcome`'s rules are unchanged (a withheld cycle forgets nothing).
4. The holds are unchanged: a marked game stays on `detail.variety_owed_games`, so the fleet's hold and the database's feeder opener keep the next slot that frees by itself for the owed games. That is how a marked game gets its next try once Horses can fund it, and the 5-minute rest after each failed try still lets depth proceed. The cost is that the two games keep two slots of headroom reserved while not resting, as they did before this fix.
5. The beat says it: `detail.variety_drain_why` is `owed_cannot_start` when starts are owed and none is cap-blocked (`drainWhyForBeat`), and `detail.variety_cannot_start` lists the marked games. Heartbeat detail only, no migration.
6. The live check: the fourth condition is removed from `no_rejoin_while_named`; the other three stay. On the window from the 7 PM CST seal (342 beats to 9:57 PM CST) it FAILS with 12 Horse seats, which is correct until this fix serves. Once it serves, a table can still be un-named and refilled once for a game the fleet has not yet tried (it cannot know before the first try), and that one re-seat counts.

### Pinned By

- `server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts`, "found live on the 7 PM seal": the walk says why a start failed and an own-reason failure outlives its rest; the drain owes only cap-blocked games and the beat says `owed_cannot_start`; the measured sequence (two games fail for their own reason, a table released for a cap-blocked game survives their rest, nothing new is released for them after the rest, and nothing is released once only they are owed); the fleet wiring. All four fail on origin/main.
- `server/src/services/theDrainSaysWhy.law.test.ts` and `aPlanGameWithNoTableStartsFirst.test.ts` updated for the new inputs.
- `tests/unit/varietyDrainLiveCheck.test.ts`, "a Horse seat counts as a re-join only while the table was still named": the re-seat excuse is gone (fails on #12297's head 37ecc795).
