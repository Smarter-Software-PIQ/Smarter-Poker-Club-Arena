# Break start follow-ups: busts first, a clean felt, Lightning and a measured wait

Follow-up to `2026-11-06-a-break-never-starts-in-the-middle-of-a-hand.md`.
Dan asked for every improvement found while verifying that fix to be built.

## 1. Why the 10:55 PM break ran almost ten minutes (found; already fixed on main)

Tournament `239ff085` finished its last hand at 03:55:29 UTC and dealt again
at 04:05:02. Every MTT on the platform resumed at :05 at the 02:55, 03:55 and
04:55 breaks, however early its last hand ended. The live engine's `/health`
showed why: `maintenance.schedule.frequency = phase1-hourly` with
`hourlyCashFreeze: true`. The temporary hourly maintenance break was still
running in production, and `MaintenanceBreak.tournamentBreakEndsAt()`
deliberately makes a tournament break that overlaps a maintenance break end
at the maintenance end (:05), so a five-minute break became ten.

Main already carries the owner's November 6 revocation
(`maintenanceSchedulePolicy.json` `phase1Status: "off"`, pinned by
`tests/daily-engine-maintenance.law.test.ts`). It activates with the 04:00
America/Chicago release. After that, the only break that can overlap
maintenance is 03:55 Chicago, which runs to 04:05 while the engine is
replaced, and that is by design.

## 2. Busted players are handled before the break

The post-hand park now sits after the bust handling too: the `seat_left`
publication, the elimination/rebuy wake (`handCompleteCallback`) and a cash
table's rebuy window. Before, a player knocked out on the last hand sat on an
empty stack through the whole break. Pinned in
`tests/a-break-never-starts-in-the-middle-of-a-hand.law.test.ts`.

## 3. A countdown starts on a clean felt for every client

`src/lib/breakCountdownResync.ts`: the first time a tournament or maintenance
countdown is known on a table page, it asks the engine for one snapshot (keyed
by the countdown's end, so exactly once per break). A client that missed the
hand-free broadcast (replaced socket, background tab, late spectator) no longer
keeps a finished hand on the felt. Wired in `TablePage.tsx`; pinned by
`tests/unit/breakCountdownResync.test.ts`.

The centre clock's last-hand text was already right: "Break: Waiting /
Finishing Hands" until every table finishes. "Last Hand" is reserved for the
add-on window (Dan 2026-11-01). The "Paused" in Dan's screenshot was a real
countdown over a stale felt, which items 2 and 3 address.

## 4. A release never voids a Lightning hand

Lightning hands have no table engine, so the maintenance restart gate could not
see them, and a release could void a fast-fold hand dealt before the 03:58
announcement. `MaintenanceBreakDeps.lightningHandsInFlight` (fed by
`LightningHosting.totalHandsInFlight()`) keeps `readyForRestart()` shut until
it reads zero. An unreadable count counts as a hand still in the air. Published
as `/health maintenance.lightningHandsInFlight`. Pinned in
`MaintenanceBreak.test.ts`.

## 5. The last-hand wait is a number

`GameServer.breakLastHandWait` records, for each break, how long every
tournament took from the last-hand call to its countdown (`maxMs` is the
slowest, `lastMs` the latest, plus a count). Published on `/health` as
`breakLastHandWait` and on `/metrics` as
`poker_tournament_break_last_hand_wait_seconds`. It is measurement only and
can never throw into the break (an exception there broke seven break tests
before it was made defensive). Pinned by
`server/src/BreakLastHandWaitMetric.test.ts`.
