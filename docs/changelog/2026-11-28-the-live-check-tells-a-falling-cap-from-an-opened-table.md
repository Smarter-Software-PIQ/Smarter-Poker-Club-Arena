# The Live Check Tells A Falling Cap From An Opened Table (2026-11-28)

## What Was Wrong

The variety drain's live check (`scripts/sql/variety-drain-live-check.sql`, R11 of `docs/HORSE-DECISIONS-REGRESSION-METHOD.md`) failed two rows every night with nothing wrong:

- `tables_within_cap` failed whenever the room held more counted tables than the hour's cap ("23 counted, cap 18").
- `cap_every_cycle` failed on every heartbeat that read more counted tables than its cap ("12 of 12 heartbeat(s) over the cap they read").

On the 10 PM CST seal of 2026-11-27 and the 1 AM CST seal of 2026-11-28 the old rule failed 137 heartbeats (read at about 1:25 AM CST). Not one was a table opened over the cap:

| Beats | What Happened                                                                                                                                                  | New Reading                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 3     | The hour turned and the cap fell under the room: 11:00:16 PM 40 of 29, 12:00:16 AM 29 of 25, 1:05:19 AM 25 of 18                                               | INFO (`cap_wind_down`: "the cap fell") |
| 133   | The room stayed level or fell while it wound down to the new cap                                                                                               | INFO (`cap_wind_down`)                 |
| 1     | 12:16:13 AM, 25 to 26 at cap 25: a person left the person-started table "PLO4 0.25/0.50 Classic Feeder" at 12:16:12 AM and its Horses stayed until 12:17:30 AM | PASS, named in the evidence            |

The wait rows had a second fault. A wait that began before the window was timed from `detail.variety_owed_since` whenever the heartbeat carried it, and lost its "minimums" label. The fleet keeps those times in memory and restarts with the release, so after the 1 AM seal all nine owed games carried one instant, 1:05:15 AM: the restarted fleet's first cycle, not when any game began to wait.

## Why It Broke

The rows equated "over the cap" with "opened over the cap". They were written and first read during rising-cap hours (the afternoon and evening of 2026-11-26 and 27), when the two are the same thing. The hourly cap (`fn_cash_hourly_table_range`) falls from 40 at 10 PM CST to 7 at 6 AM. The policy never closes a dealing table when the cap falls; it stops admitting new ones, and the room winds down as tables empty. So after every fall the room is above the cap by design, and a row that fails every night trains its readers to ignore it.

The wait label trusted any first-owed time. Nothing in the check asked whether that time could be older than the fleet that wrote it.

## The Fix

`cap_every_cycle` now fails on what it was written to guard: a table entering the counted room while the room is at or above the cap, with no person behind it. For every pair of consecutive heartbeats that carry the room (the old fleet's last reading before the release is the first pair's earlier beat), the count rose and ended above the cap of both readings and of every hourly cap in force between them. The tables above that level entered at or above the cap. Each needs a person-side cause in that interval:

- a person left a person-started table whose Horses stayed (`cash_hourly_table_origins.human_started`; `fn_cash_hourly_table_capacity_census` leaves such a table out only while a person sits), read from the table's hands (`has_human`) and seats; or
- a person was on a game's waiting list (a person is never gated by the hourly policy).

A rise with no such cause is a FAIL that names the beat. A rise a person explains passes and is named in the evidence.

`tables_within_cap` applies the same rule from the newest heartbeat to this moment. Over the cap it is FAIL when a table entered at or above the cap since that heartbeat, when `cap_every_cycle` fails, or when the count is above every cap of the last 24 hours; otherwise INFO.

`cap_wind_down` (new, INFO) reports the wind-down: how many heartbeats read more counted tables than the cap, how far over, the count at the first and the newest (falling, level or rising), and each fall of the cap.

The wait rows use a first-owed time only when it is at or before the release. A later one keeps the "already owed at the release: their waits are minimums" label.

## Proof It Still Catches A Real Open Over The Cap

`tests/unit/varietyDrainLiveCheckCap.pg.test.ts` runs the shipped statement on a real PostgreSQL against a seeded room. It still fails when:

- a Horse-started table is seated while the beat before it read the room at the cap (18 to 19 at cap 18);
- a table enters across a falling cap from a full room (40 of 40 to 41 of 29);
- a table enters while the room winds down (24 to 25 at cap 18);
- two tables enter in one cycle from one below the cap (17 to 19 at cap 18: one of them is over);
- a table enters after the newest heartbeat (18 of 18, then 19 now);
- the 12:16 AM rise happens at a Horse-started table instead of a person-started one, or the only name on the waiting list is a Horse.

Run against production for every seal whose heartbeats carry the room (4 PM, 7 PM and 10 PM CST 2026-11-27, 1 AM CST 2026-11-28; 917 readings at about 1:25 AM CST), the new rule finds no unexplained rise and classifies the 137 old failures as in the table above.

## What It Cannot See

- Two heartbeats show only the net change. A table opened over the cap in the same 30 seconds as another closed does not show.
- The heartbeat carries the room only in cycles with a start owed. With nothing owed, `tables_within_cap` is judged against the caps of the last 24 hours alone, and its evidence says so.
- First-owed times do not survive a restart, so every wait already running at a release is a minimum until the fleet carries those times across it.
