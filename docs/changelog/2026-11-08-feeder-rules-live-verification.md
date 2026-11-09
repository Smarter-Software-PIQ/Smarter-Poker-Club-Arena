# Live verification: game status labels and the full-ring feeder start

2026-11-08. Production evidence for two changes Dan approved the same day,
read from production records (read-only). Times are UTC (Chicago is UTC-6).

| what         | where it lives                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client build | `20c0ab1` (published 20:41:46 by `publish-club-arena.yml` run 42521038609; served at both `ca-static.smarter.poker/build-info.json` and `smarter.poker/hub/club-arena/build-info.json`)         |
| Migration    | `20261108193515_a_full_ring_feeder_starts_with_the_last_two_to_sit` (applied 20:38 by Apply Merged Migration run 42521078335; recorded in `schema_migrations`; its `@live-proof` returned true) |
| Changes      | PR #10072 (status labels), PR #10078 (feeder rules)                                                                                                                                             |

## 1. Lobby status labels

**Verified in the served bundle (phone and desktop load the same 209 scripts):**
grouped games print `${n} Tables` when there is more than one table and
`Running` otherwise, with no waitlist text; the card pill accepts only
`N Tables`; a standalone full table still prints `Waitlist ${n}` under the
`waitlist` key.

**Join Game puts a real player on the list - observed.** A real (non-horse)
player joined NLH 0.25/0.50 Classic at 21:10:18 while its only table was
9/9 and was put on the game's list (`cash_game_waitlist`). The same player
joined PLO6 0.10/0.25 Classic at 21:15:21.

**OPEN - signed-in phone and desktop render.** No supported test session is
available to this agent. The only approved test identity (the platform service
account, `daniel@smarter.poker`) signs in with a password kept in `.env.local`
on the owner's Mac, and the agent may not type a password into a sign-in form.
The Claude desktop browser pane is not signed in, and Claude in Chrome was not
reachable from the session. No token-based or magic-link test session route
exists that does not need a secret the agent may not read.

## 2. Full-ring feeder start - NLH 0.10/0.25 Classic (9-handed)

Main 1 `c5c742e5`, feeder `cd9f721b`. At 21:00 Chicago-hour pick change the
game became eligible for a second table.

| time                 | observed                                                                                                                                                                                                                                                                                                                                                                      | rule                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 21:03:56             | 4 on the list, Main 9/9: feeder opened, `feeder_start` held=2                                                                                                                                                                                                                                                                                                                 | four waiting opens it                                      |
| 21:03:56             | balance moves planned for `8ef81aac` (arrived 20:59:48) and `a0b37838` (arrived 20:39:51) - the two latest arrivals of the nine; the next latest arrived 19:31:16                                                                                                                                                                                                             | last two to sit                                            |
| 21:05:06             | both landed on the feeder: `8ef81aac` 78.66 Main seat 7 -> feeder seat 3; `a0b37838` 49.92 Main seat 8 -> feeder seat 4 (move receipts equal the source stacks)                                                                                                                                                                                                               | stack carried exactly                                      |
| 21:05:23 to 21:08:30 | six direct buy-ins refused with `SEAT_RESERVED: this seat goes to the next player on the must-move list` (Postgres log, via PostgREST: 21:05:23.057, 21:06:20.746, 21:07:22.263, 21:07:52.446, 21:08:30.727, 21:08:30.945). The horse fleet's heartbeat recorded `seat_reserved` refusals in the matching cycles (21:05:24, 21:05:59, 21:06:23, 21:07:23, 21:07:54, 21:08:34) | held Main chairs closed to direct seating, horses included |
| 21:05:06 to 21:17    | no direct join to Main 1 after the feeder start                                                                                                                                                                                                                                                                                                                               | newcomers go to the feeder                                 |
| 21:10:24             | feeder reached 7                                                                                                                                                                                                                                                                                                                                                              |                                                            |
| 21:10:25             | `feeder_start_chair_released` (feeder_players 7, gate 7, held 2 -> 1); must_move planned for `a0b37838` (first to move)                                                                                                                                                                                                                                                       | seven-player gate                                          |
| 21:10:26             | landed on Main seat 7 with 50.65 (receipt 50.65)                                                                                                                                                                                                                                                                                                                              |                                                            |
| 21:11:26             | feeder back at 7                                                                                                                                                                                                                                                                                                                                                              | gate re-checked after the move                             |
| 21:11:28             | second release (held 1 -> 0); must_move planned for `8ef81aac`                                                                                                                                                                                                                                                                                                                | one at a time                                              |
| 21:11:31             | landed on Main seat 8 with 83.91 (receipt 83.91); `feeder_start_ended` reason `complete`                                                                                                                                                                                                                                                                                      |                                                            |

## 3. Earlier gate-respecting moves (preserved)

- NLH 0.25/0.50 Classic: one must_move from its feeder to Main at 20:39:23
  (landed 20:39:56, 75.68), feeder at 7 or more.
- NLH 1/2 Classic: one must_move at 20:42:40 (landed 20:42:50, 971.26),
  feeder at 7 or more.

## 4. Closing feeders after the 21:00 pick change

NLH 0.50/1 Classic feeder `5c024808` and NLH 0.25/0.50 Classic feeder
`e4f292ea` stopped being picked and started breaking at 21:01:05 and 21:02:15.

- 16 players left the two feeders: NLH 0.50/1 eight exits totalling 1,497.69
  (316.16, 86.11, 181.05, 211.25, 137.07, 195.45, 180.60, 190.00); NLH
  0.25/0.50 eight exits totalling 815.37 (98.50, 95.25, 67.92, 126.55, 32.75,
  139.41, 97.84, 157.15). `fn_unaccounted_seat_exits` reported 0 unaccounted
  exits for the window.
- The last player at each closing feeder moved to its Main by must_move with
  the exact stack: `4de21b58` 258.57 at 21:10:07 (NLH 0.25/0.50), `ae65dc7b`
  239.25 at 21:11:53 (NLH 0.50/1). Both feeders then closed. Later exits of
  those players were credited (still 0 unaccounted).

## 5. 6-max (unchanged rule)

PLO4 0.25/0.50 Classic opened a feeder at 21:01:26 after a one-buyer hold and
FLO8 0.25/0.50 Madness at 21:05:26. No balance move came off either Main and
no feeder-start row was written. First seat assignments, both by direct buy-in
(no offer, no move): PLO4 21:01:50.39 and 21:01:50.65, a third at 21:01:51.36;
FLO8 21:05:56.13 and 21:05:56.30, a third at 21:05:57.59. The tick promoted
each feeder after that, so the moment it was dealing heads-up was not
observable: horses filled a third chair within a second.

## Status

| transition                                                                        | evidence                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| four waiting opens the feeder                                                     | observed live                                                                  |
| the two latest Main arrivals move, stacks exact                                   | observed live                                                                  |
| held chairs refuse direct seating (horses)                                        | observed live (6 refusals)                                                     |
| newcomers go to the feeder                                                        | observed live (no Main joins during the start)                                 |
| 7-player gate before each held chair fills, one at a time                         | observed live (2 releases)                                                     |
| first-to-move order on release                                                    | observed live (both bumped players first)                                      |
| bumped player returns at once when a Main player leaves or busts (feeder under 7) | observed live on a leave (2026-11-09, section 6); bust-out path in local tests |
| real player's Join Game puts them on the list                                     | observed live                                                                  |
| 6-max opens with no bump                                                          | observed live                                                                  |
| 6-max deals heads-up at the start                                                 | not a requirement (section 6); two-seat start shown in local tests             |
| closing feeder players moved or cashed out with stacks accounted                  | observed live                                                                  |
| signed-in lobby on phone and desktop                                              | observed live (section 6)                                                      |

## 6. Update 2026-11-09 (UTC)

**Signed-in lobby, phone and desktop - observed.** Through the owner's signed-in
desktop browser pane (read-only; no game joined), Midway Union's cash lobby at
1024 px and at a 375 x 812 phone viewport printed only `N Tables` (2, 9, 13),
`Running` and `Seats Available` in Status, with no waitlist count. The page was
serving build `b001c48`, which descends from `20c0ab1` and has the same label
code. No standalone (non-game) cash table exists in production, so the
standalone `Waitlist N` label is covered by `tests/unit/lobbyWaitlistIsReachable.test.ts`
and the served bundle only.

**Bumped players return on a Main leave, feeder under 7 - observed.** NLH 0.50/1
Classic started a feeder at 00:00:02 (4 waiting; balance moves 316.91 and 212.90,
exact). A Main player left at 00:00:54.47 and a bumped player was planned back
0.2 s later, landing at 00:00:56 with 316.91; another Main player left at
00:08:09.58 and the other bumped player was planned back 0.3 s later, landing at
00:08:20 with 200.55. The feeder had fewer than seven both times (its first
release came at 00:58:40). The bust-out path (a busted player keeps the chair
through the rebuy window; the bumped player moves when they leave) passed in
local tests only.

**Second feeder start's gate releases - observed.** Releases at 00:58:40 and
01:01:11, each with the feeder at 7; the first released chair's mover busted on
the feeder before the boundary (move cancelled, chair stays open), the second
moved 189.75.

**Defect found and fixed in a follow-up (migration `20261109010155`).** A
bumped player already back on Main cashed out at 00:39:47 (306.46, credited),
rejoined at the feeder at 00:40:22 and was moved back past the gate at 00:40:23,
because `first_to_move` kept both ids for the whole feeder start. The fix ends
first-to-move once the player is back on a Main or gone from the game. See
`docs/changelog/2026-11-09-first-to-move-ends-on-return.md`.

**6-max requirement.** Dan's ruling (2026-11-08): no bump; two people on the list
start the feeder heads up, as today; any open Main seat goes to the first on the
list. The requirement is that two waiting players can open the feeder without
moving anyone off Main. Nothing requires a heads-up hand to be dealt before a
third player arrives. Production: three 6-max feeders opened with no bump (PLO4
0.25/0.50, FLO8 0.25/0.50 Madness, PLO5 1/2 Madness). Local tests: two waiting
players open the feeder, nobody is moved, it goes live with exactly two seated,
and an open Main seat is filled from the feeder at once.

**Chips.** `fn_unaccounted_seat_exits` stayed at 0 throughout. One transient
`lock timeout` tick error on an enabled game (NLH 0.10/0.25, 23:49:26) was retried
on the next tick; the 36 retired-test-club errors are recorded separately.

Separate finding, not part of this change: `docs/changelog/2026-11-08-retired-test-clubs-tick-errors.md`.
