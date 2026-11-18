# Seat-first waiting ladder and the under-300 board - 2026-11-08

Scope: cut combined Spin and regular Sit and Go starts to under 300 a day by
changing how horses seat, not by slowing play or restricting human seating.
Owner: this chat, as the delivering agent. Under the September 17 owner
instruction each authorized agent owns its own delivery, so "release owner" for
#10094 is this lane; there is no separate person to coordinate with, and the
04:00 daily preparation is owned by whichever Stage run reserves the date.

---

## SCOPE OF RECORD (2026-11-09, reset to the original assignment)

> **PICKING THIS UP IN A NEW CHAT? READ
> [`docs/HANDOFF-2026-11-09-seat-first-waiting-ladder.md`](./docs/HANDOFF-2026-11-09-seat-first-waiting-ladder.md)
> FIRST.** It is the full continuation document: every phase, every measurement
> with the time it was read, the exact current state, the open blockers, what
> was never tested, the traps that cost this lane hours, and the numbered
> execution plan. This checkpoint is the lane's record; that file is how to
> resume it.

**This section supersedes every later "Still open, and why" table in this
file.** Those tables stay as history; this is the only list of gates this lane
is closed against.

### What this chat owns, and what each one is accepted on

| # | deliverable | accepted when |
| --- | --- | --- |
| 1 | Combined Spin and regular Sit and Go starts under 300 per Chicago day | one COMPLETE Chicago day on the activated engine measures under 300 combined, with human-triggered and horse-only reported separately and no reading that turns an over-target day into a pass |
| 2 | One horse opens a board, 11 Spins and 6 regular Sit and Gos | the live board count converges on 11 and 6, satellite feeders counted in neither |
| 3 | The waiting ladder: Spin 60-80 then 30-60 minutes, regular Sit and Go 3-4 hours | boards advance on those rungs on the activated engine |
| 4 | A person who sits is joined in 3 to 7 minutes | the engine fills across the whole band, and the table's countdown is never later than the engine's own deadline |
| 5 | Horses are refunded exactly as humans, 100% of the time | already accepted: 390 of 390 horse entries refunded, 9,400.00 debited and 9,400.00 returned, to the chip, plus the SQL law that refuses horse status as a reason not to pay |
| 6 | Taken out of the horse auto-launch schedule | already accepted: the launcher opens one horse per board and no replacement while above target |

Everything in 1 to 4 is observable only on the activated engine. 5 and 6 are
closed.

### What remains

| item | state |
| --- | --- |
| Activation | not this lane's to perform. The 2026-11-09 preparation froze `blocked` on a defect another lane has since fixed; the next activation is the ordinary 04:00 window |
| Verification at activation | serving identity, SEALED receipt, complete thaw, convergence toward 11 and 6, feeders consuming none of that budget, occupied games keeping players and stacks, a reload keeping the countdown |
| The acceptance day | the first COMPLETE Chicago day after an activation that actually happened, reported by the digest the following day |
| Pre-change baseline | Chicago 2026-11-09 ran entirely on the old engine; its numbers are recorded as pre-change and are not an acceptance result |

### Dependencies are coordination points, not work for this lane

The 04:00 activation, its certificate and its receipts belong to the daily
release operation. This lane READS that operation's record (the selection
artifact, the certificate status, `/health`, the sealed receipt) and verifies
its own behaviour afterwards. It does not dispatch a release, re-run a
selection, write to the Backup host, apply a migration outside its own, or
build a second implementation of any of it. Where a dependency is missing or
wrong, this lane reports it to the owning operation with the evidence and
carries on with what it can measure.

### Unrelated work this lane adopted, and where it has gone

Preserved, handed over, nothing deleted:

| what | established owner | where the evidence is | ACK |
| --- | --- | --- | --- |
| The sparse-checkout defect that blocked the 2026-11-09 selection. This lane built a fix and opened a PR for a workflow it does not own; three other lanes did the same within seven minutes | the release lane (`stage-engine-release.yml`) | fixed on main by #10157 with its own law test; this lane's PR closed as superseded with the reason in its comment; the incident record is `docs/changelog/2026-11-09-the-daily-selection-could-not-read-its-own-helper.md` | superseded by the merge |
| The Backup refresh failure "standby cash cluster parent missing" | the Backup lane | diagnosis in the archived evidence folder; fixed on main by #10144 before this lane's note was read | the fix landed |
| Nine workflows red at their latest main run, and the audit meant to raise that issue being one of them | the BBJ sweep lane and the production-integrity owner | `COORDINATION-INBOX.md`, 10:43Z entry | one received: the tournament-lobby lane accepted the rematch-certification red as theirs, hand-started, not touching the release or publish gate. The BBJ shard and the detector remain open with their owners |
| A migration in production that main has never seen (`20261109040704`) | the Kings Club downline lane | `COORDINATION-INBOX.md`, 06:27Z entry, with the installed-set effect for the release owner | open |
| Cancelled feeders showing debits with no refund row; a feeder inheriting the heads-up ladder; a digest reader that coerces an unreadable answer to empty | their own lanes | "Observations outside this lane" below, unchanged | open, and deliberately not acted on |

The lesson this lane keeps: finding a defect in another lane's file is a
report, not an assignment. Four agents fixing one missing folder in seven
minutes cost more than the folder did.

## The measurement that started it (read from production, 2026-11-08)

Seven days to 2026-11-07, by Chicago day:

|                  | 7-day average | Nov 5-7 (clean days after the engine changeover) |
| ---------------- | ------------- | ------------------------------------------------ |
| Spins            | 4,228/day     | 5,914/day                                        |
| Regular heads-up | 3,772/day     | 5,625/day                                        |
| Combined         | ~8,000/day    | ~11,539/day                                      |

Of 55,998 games completed that week, SEVEN had a person in them.

2026-11-03 produced zero Spins and zero heads-up (none created, none started)
and 2026-11-04 was a fraction of normal; both drag the seven-day average down,
so the three clean days are the real rate.

**Naming, because it changes what "Sit and Go" means here:** every game the
platform plays in volume as `tournament_type = 'SNG'` is a HEADS-UP match -
2 seats, 32 boards, 17,363 started in three days. The 6-max and 9-max Sit and
Gos are satellites and ran eleven times in the same three days.

## Baseline for the acceptance comparison (2026-11-07)

| kind                        | starts | human-triggered | horse-only |
| --------------------------- | ------ | --------------- | ---------- |
| Spin                        | 6,670  | 1               | 6,669      |
| regular heads-up            | 5,847  | 0               | 5,847      |
| satellite feeder (separate) | 4      | 0               | 4          |

12,517 combined against a ceiling of 300.

## Cause

Two things multiplied.

1. The board was every price point on every activated owner: 64 Spin configs
   and 32 heads-up configs across the house board and each owner. Measured
   2026-11-08: 134 open seat-first boards across two owners.
2. Each board opened with `seats - 1` horses - so a Spin appeared already one
   seat from dealing - and held that last seat for a randomised 90 to 350
   SECONDS. Every board therefore cycled about every six minutes.

The 90-350s window was itself a widening made on 2026-09-05 after a week in
which 31,153 Spins ran and four had a human in them. Widening the door from
150s to 350s changed nothing, because the problem was never the width of the
door.

## What shipped - PR #10094, squash `744549f3791cc71040529f8aef36f5fe81a77a51`

- **The ladder** (`server/src/config/seatFirstLadder.ts`): a board opens with
  ONE horse. Spin waits 60-80 min for the second and 30-60 more for the third.
  Regular heads-up waits 3-4 hours for the second and then deals. The top-up
  climbs ONE rung at a time (`GameServer.advanceSeatFirstRung`) and the board
  returns to waiting.
- **A person overtakes the ladder**: the field arrives 3-7 minutes after they
  sat, measured from their own seat rather than from a board window that is now
  hours away. The felt countdown moved with it.
- **The board is 11 Spins and 6 regular heads-up**, platform-wide, counted over
  REGISTERING rows with no owner scope. The catalogue is untouched; which price
  points are open is drawn fresh each tick. A count that could not be read
  opens NOTHING (10.86).
- **Satellite feeders are outside the six** and are SATELLITE rows.
- Retired surface removed from the pins: `fn_repair_seat_first_games` was
  dropped 2026-09-08 and is confirmed absent from production, so pinning its
  SQL window kept a dead rule looking live.

Seven test pins were moved in the same delivery, each one describing behaviour
this change deliberately replaces. None was weakened.

## Delivery and live proof

- All required checks green on `65a86485f9ccb017a54b2bcb35fe1a9121117a69`.
- Protected squash merge to main.
- `Publish Club Arena` 42530764300 terminal success.
- Client verified serving the merged revision at BOTH endpoints:
  `ca-static.smarter.poker/build-info.json` and
  `smarter.poker/hub/club-arena/build-info.json` = `744549f379...`, built
  2026-11-08T22:37:25Z.

## Engine: queued for 04:00 America/Chicago

The ladder is engine code. The release system answered twice on 2026-11-08 -
once at 21:23 UTC, a minute before the activation question was put, and again
after the merge at 22:32 UTC - with `OWNER_WINDOW_ID` empty and the verdict
`Routine engine updates are queued for 04:00 America/Chicago`.

No cutover window ending 18:20 Chicago existed. Under the November 6 owner
direction only the owned daily preparation can offer a replacement; hourly,
degraded and historical owner-window routes are revoked. `Backup Engine (Clone,
Stage, Certify)` for the merge ran successfully (42530764148). Current main
`e45f2b069a` CONTAINS the merge (verified by ancestry), so any candidate the
04:00 preparation selects carries #10094.

## Verified before activation

- **Equal refund treatment.** All 46 refund, entitlement and cancellation
  functions in production reference the horse flag ZERO times. The exclusion
  Dan reversed never reached the code. CLAUDE.md 10.5 now carries the hard rule
  and another lane shipped `a-refund-never-reads-horse-identity.law.test.ts`
  (#10107).
- **The countdown's durable source.** The felt countdown is computed from the
  hero's own `table_seats.joined_at` (a database column, read by the pre-start
  roster sync), anchored to the DATABASE clock through `fn_db_now` rather than
  the device's. Both confirmed present in production. A local fallback is used
  only for a buy-in made on that page before the first sync. So a reload or a
  reconnect recomputes the SAME instant rather than restarting a timer.
  Consequence of this change worth recording: the hold no longer depends on
  `start_time`, which the ladder now rewrites at every rung - under the old
  `max(windowEnd, partnerFloor)` a rung advance could have pushed a seated
  person's countdown OUTWARD mid-wait.
- **Nothing else fills these boards.** `HorseOverlayGuard` is MTT-only in the
  code (`format_contract in mtt-v1, mtt-v2`) and in both functions it calls
  (`fn_overlay_at_risk`, `fn_freeroll_fill_targets`). The recurring service is
  the only creator of SPIN and SNG rows.
- **Concurrency.** The launcher runs on the leader only; `withBoardTick` allows
  one tick per variant with the flag released in `finally`; one filler per
  board (`tournamentTopUpsInFlight`); and the seating RPC refuses a horse a
  second chair at a board it already occupies.
- **Restart persistence.** The rung lives in `start_time` in the database, so a
  restart neither resets an elapsed wait nor deals early, and a failed rung
  write keeps the old window.
- **Stake rotation.** Rotation only ever considers configs with NO open
  instance, so an occupied board is never a rotation candidate.

## Still open, and why (SUPERSEDED by SCOPE OF RECORD above)

| item                                                      | status                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine activation, serving SHA, SEALED receipt, full thaw | waits for 04:00 Chicago 2026-11-09                                                                                                                                                                                                                                                                         |
| Live horse-only ladder timings, board limits, human fill  | observable only on the new engine                                                                                                                                                                                                                                                                          |
| Countdown in a signed-in browser                          | NOT performed. Signing in needs credentials; Dan's personal account is forbidden for probes (10.10 rule 2) and the service identity lives in `.env.local`, which 10.84 forbids reading. No existing e2e covers the partner-hold countdown. The durable chain is proved above from schema and code instead. |
| The under-300 day                                         | the first COMPLETE Chicago day after a 04:00 activation is 2026-11-10                                                                                                                                                                                                                                      |

## How the number survives this session

`fn_ca_seat_first_daily_starts(date)` - read-only, one bounded Chicago day per
call, no writes - is read by the existing estate digest at 06:07 Chicago, after
the day it reports has closed. It prints total, human-triggered and horse-only
for Spins and regular heads-up against the 300 target, with satellite feeders
on their own line outside the comparison, and any unexpected format printed
rather than folded into the total. Its query body was verified against
production for 2026-11-07 and reproduces the baseline table above exactly.

No Claude scheduled task was created for any of this (10.85).

---

# Second pass, 2026-11-08 evening: two defects found before activation

## 1. The cap would have closed the regular heads-up board completely

`seatFirstBoardRoom` counted open boards by `variant` alone. A satellite feeder
carries `variant: 'sng'` in BOTH shapes it takes, and the common one is not the
one the name suggests:

| shape                                                      | rows in 10 days |
| ---------------------------------------------------------- | --------------- |
| `tournament_type: 'SATELLITE'` (createSatelliteHeadsUp)     | 11              |
| `tournament_type: 'SNG'` + `satellite_target_id` (6/9-max)  | 1,111           |

Measured on production 2026-11-08, REGISTERING `sng` rows:

| variant | type | max_players | satellite_target_id | rows |
| ------- | ---- | ----------- | ------------------- | ---- |
| sng | SNG | 2 | null | 36 |
| sng | SNG | 9 | set | 59 |
| sng | SNG | 6 | set | 1 |

So the shipped count would have read **96 against a target of 6**:
`room = max(0, 6 - 96) = 0`, permanently, with 60 feeders open and the regular
heads-up board shut. The exact opposite of the rule the target was written for.

Fixed in #10119, squash `ad998fc9a6932d002db12cfa7d410d36ab258918`, by counting a board only when it is not a feeder, using exactly
the test `fn_ca_seat_first_daily_starts` uses, so the engine and the report
cannot disagree about what the six are:

```ts
.eq('variant', variant)
.eq('tournament_type', variant === 'spin' ? 'SPIN' : 'SNG')
.is('satellite_target_id', null)
.is('satellite_target', null)
.eq('status', 'REGISTERING')
```

Pinned by a new case in `theSeatFirstBoardWaitsForAPerson.law.test.ts`.

## 2. The daily number never reached the digest

The digest section shipped in #10110 was dispatched to prove it end to end. It
printed `(seat-first starts unreadable today)` and `starts rpc 500`: UNKNOWN
rather than an invented zero, which is 10.86 rule 1 working, but UNKNOWN is not
the number.

Cause, read from the plan and both log streams rather than guessed: the day
filter `(started_at AT TIME ZONE 'America/Chicago')::date = d` is not sargable,
so it scanned all 991,799 rows of a 1,541 MB table - 247,595 shared buffers,
2,843 ms warm, 13,831 ms cold for two days - against `service_role`'s ~8 s
statement budget.

```
postgres_logs  02:11:05Z  duration: 13831.491 ms  plan: ... fn_ca_seat_first_daily_starts
edge_logs      02:15:30Z  POST | 500 | /rest/v1/rpc/fn_ca_seat_first_daily_starts
```

Fixed in #10123, squash `bd6e4c6ea5575848b65547a521d3e29f046fd6e0`, at the root, with no retry: a half-open timestamptz day range,
an index on `tournaments(started_at)` built CONCURRENTLY through the door's own
exception, and the digest now carrying PostgREST's message beside the status.
The function migration asserts the 2026-11-07 counts before committing, and the
new body was run inline against production first and returns the shipped
numbers exactly.

# Acceptance evidence gathered this pass

## The browser session IS reachable and permitted

Both of them, as `KingFish` (ID 25450):

- the owner's own Chrome, `smarter-poker-auth` present and unexpired, the
  Kings Club lobby rendering authenticated content;
- the Claude browser pane on the same machine, signed in independently, which
  also emulates phone width.

The two `/auth/login?redirect=...` tabs sitting in Chrome are stale leftovers,
not a current restriction. Recorded because the previous pass concluded this
verification could not be performed at all.

Pre-activation reading from the player's own eyes, Spins tab, 375 px and
desktop: a long list of Spin boards, **every one showing 2/3 Seats Available**.
That is the shape Dan objected to, captured before the change.

## The client half is already live

`https://ca-static.smarter.poker` and the hub both serve `ca_sha
8aede69fbf2ba4744fdc7a91ec2c509b09220855`, which contains #10094, and the
published `TablePage` chunk carries the new hold arithmetic verbatim:

```js
Math.min(t+42e4,t+18e4+3e4)
```

measured from the hero's own seat ref, not from `start_time`. So a rung advance
can no longer push a seated person's countdown outward.

## Equal refunds, behaviourally

Cancelled Spin and regular heads-up boards, seven days to 2026-11-08:

| | entries | debited | refunded | debited | refunded |
| --- | --- | --- | --- | --- | --- |
| horses | 390 | 390 | **390** | 9,400.00 | **9,400.00** |

Every entry refunded, in full, to the chip. No human sat in a cancelled
seat-first board in that window, so there is no human column to compare; what
the rule asked for - a horse refunded exactly as a human would be, 100% of the
time - is what production did.

## The engine serving now, and what activates

- serving `releaseSha 391f7bc0d57c71637bd4af5181f70520661e3593`
  ("Book the certified Horse fold provenance database and worker cutover
  (#9903)"), which does NOT contain #10094;
- `/health.maintenance.schedule`: daily, `startHour 4`, `startMinute 0`,
  `durationMs 300000`, `timeZone America/Chicago`, next announcement
  `1794218280000` = 09:58Z = 03:58 Chicago. The 03:58 notice and the
  04:00-04:05 window are the ones section 13 describes.

## Ownership of the cutover

There was no 6:20 PM window and there is no reservation yet. The Stage
admission step prints `OWNER_WINDOW_ID:` empty and "Routine engine updates are
queued for 04:00 America/Chicago", and its own window arithmetic opens the
reservation five hours before 03:30 Chicago - that is **22:30 Chicago tonight**.
The first eligible Stage run at or after that reserves the date and its head
SHA becomes the candidate, so everything that must activate has to be merged
before then. This lane owns #10094, #10119 and #10123 and the merge of each.

## What the cap does to the boards already open

Read from the code rather than predicted:

- `seatFirstBoardRoom` returns `max(0, target - count)`, and the launcher
  returns early on `room <= 0`, so **no new board opens** while the fleet is
  above 11 Spin / 6 heads-up.
- an existing board with `seats - 1` paid fills on the first tick and deals
  once (`target = min(seats, paid + 1)` reaches `seats`, `fillsTheBoard`);
- an existing board with fewer takes ONE horse and then writes the next rung
  into `start_time`, so it waits 60-80 min (Spin) or 3-4 h (heads-up) before
  the next seat.

Measured at 20:33 Chicago, excluding feeders: 42 Spin boards (20 at 2/3, 2 at
3/3, 20 freshly created) and 31 regular heads-up (11 at 1/2, 20 fresh). So the
immediate drain at activation is about two dozen games, and the rest climb out
over one ladder cycle. **No board is left launching games repeatedly**: each
launches once and is not replaced until the count falls under the cap, so the
fleet converges to 11 + 6 within roughly four hours of activation. Two
consequences worth stating rather than discovering:

- `spinSngBoardsOpen` already refuses new seat-first boards from 03:00 to 06:00
  Chicago, so the first board opened UNDER the cap appears at 06:00;
- during the drain there are transiently up to 42 one-horse Spins rather than
  11. Nothing deals early; it is self-correcting.

A zero-paid board does not jam the cap: of every seat-first board created in
the last 45 minutes, no COMPLETED or RUNNING one had zero paid, and no
zero-paid board was older than about five minutes.

## A person never waits out the horse ladder

`fillPartialSeatFirstGame` takes `if (!hasHuman && !windowClosed) return;`, so a
board with a person in it is processed whatever its window says, and
`seatFirstHumanPartnerHoldUntilMs` with a known seat time returns
`min(seatedAt + 7 min, seatedAt + 3 min + jitter)` - the board's own window does
not enter into it. So a person sitting on a board whose `start_time` is three
hours away is filled inside the 3-7 minute band after they sat, which is
Dan's rule. (The band was 3:00-3:30 as first shipped; widened to the whole
3:00-7:00 on 2026-11-09, see
`docs/changelog/2026-11-09-the-human-window-is-the-whole-three-to-seven.md`.)

## Still open, and why (SUPERSEDED by SCOPE OF RECORD above)

| item | status |
| --- | --- |
| Engine activation, serving SHA, SEALED receipt, full thaw | waits for 04:00 Chicago 2026-11-09 |
| Live ladder timings, 11/6 limits, human fill, drain convergence | observable only on the new engine; the lobby's SPINS and SIT N GO'S tabs are the player-visible count, and the DB query above is the exact one |
| The partner-hold countdown ON SCREEN | requires a seat, and a seat is a registration. The owner's instruction for this pass says observation may not initiate registrations or seating, so this lane does not buy one. The durable chain is proved from the published bundle and the engine's matching arithmetic above. A 30 second owner check settles it: sit in any Spin after 04:00, read "Deals In 7:00 At The Latest", reload, confirm it continues rather than restarting |
| The under-300 day | the first COMPLETE Chicago day on the new engine is 2026-11-10, reported by the digest on 2026-11-11 |

## Observations outside this lane, recorded not acted on

- **Cancelled satellite feeders and MTTs show debits with no refund row.**
  Seven days: 1,585 entries debited and not refunded, about 17,663.00 nominal
  (17,657.00 horse, 6.00 human). Horses 34.3% refunded, humans 33.3%, so this
  is NOT a horse-treatment problem. For cancelled satellite feeders alone: 655
  debited entries, 8,379.00, of which 34 refunded on the same tournament and 6
  elsewhere nearby. The ledger rows are audit-derived ("auto-audited
  club_members.chip_balance delta"), so the authoritative debit may be recorded
  differently and a feeder may refund through a path that writes no `refund`
  row. The cause is NOT established, so no number here should be treated as
  owed until it is. Different lane, different cause from the ladder.
- **`createSatelliteHeadsUp` now inherits the 3-4 h heads-up ladder**, because
  a satellite heads-up is `max_players: 2` and therefore seat-first. That path
  has created 11 rows in ten days and started none in five, so the exposure is
  nil tonight, but a feeder that waits longer than its target's start can never
  award its seat. Worth a bounded follow-up: cap a feeder's ladder at its
  target's start time.
- **`estate-digest.mjs` line 313** reads `res.ok ? await res.json() : []` for
  the notification recipients - the exact shape 10.86 rule 2 forbids. Left
  alone deliberately: it is not this lane's code and changing it would move
  notification behaviour on the night of a cutover.

No Claude scheduled task was created for any of this (10.85).

---

# Third pass, 2026-11-08 night: the reporting route proved, and the one risk left

## The digest now prints the number

Dispatched 2026-11-09 03:44Z, after #10128 applied:

```
### Seat-first board starts (Spins and Sit and Gos)

- 2026-11-07 (Chicago): 12517 combined Spin and regular Sit and Go starts
  against a target of under 300 - OVER target.
- 1 human-triggered, 12516 horse-only.
-   regular heads-up: 5847 starts (0 human-triggered, 5847 horse-only).
-   Spin: 6670 starts (1 human-triggered, 6669 horse-only).
- Satellite feeders, counted separately and outside the target: 4 starts (0 human-triggered).
```

Every intended format is covered, the human split is the same rule on every
line, feeders are separate and outside the comparison, and the integration is
proved by an actual run rather than reasoned about. The migration applied in
6,787 ms and the function answers as `service_role` inside the 8 s budget.

Two defects in the digest's own lane, seen and deliberately not touched on the
night of a cutover: it reports `in-app notifications: 0/1`, so it reaches its
issue but not the people it tries to notify; and `estate-digest.mjs` line 313
reads `res.ok ? await res.json() : []` for those recipients, which is the shape
10.86 rule 2 forbids.

## Concurrency, confirmed in the database rather than in engine memory

`fn_seat_horse_in_seat_first_game` opens with
`fn_ca_lock_tournament_seat_acquisition(p_tournament_id, NULL, p_user_id)` and
then refuses to buy a second entry for a user who already holds a
`tournament_players` row (`registered`/`playing`) or a live seat at that
tournament's primary table. So two concurrent launcher ticks cannot seat one
horse twice at one board even if both pass the engine's in-memory guards.

## The lobby before the change, from the player's own eyes

Signed in as KingFish, 2026-11-08 evening:

- **SPINS**: a long list, every board reading `2/3 Seats Available`.
- **SIT N GO'S**: heads-up boards (`2 Seats`) and satellite feeders
  (`9 Seats` / `6 Seats`, labelled Satellite) listed side by side - the same
  conflation the engine's board count had, which #10119 separates.

## THE ONE RISK LEFT: a certificate for the wrong half

**The daily selector does not take main's head.** It binds the newest cutoff
commit and then walks back to the newest commit carrying
`backup-engine/certified = success`
(`docs/ENGINE-RELEASE-RUNBOOK.md` 3.6 and 3.7).

At 21:45 Chicago the newest certified commit was `8a3f432b70` (17:53 Chicago),
later `311b30b9a7` (20:22 Chicago). **Both contain the ladder and neither
contains the feeder fix.** If nothing newer certifies before 03:30 Chicago,
that is what activates, and it is the one combination that must not ship:

- `seatFirstBoardRoom('sng')` counts 36 real heads-up boards plus 60 feeders
  against a target of 6, so `room = 0` and no heads-up board is ever opened;
- the 31 live heads-up boards each deal once and are not replaced;
- 59 of the feeders are 9-max satellites, which are NOT seat-first, so they
  never drain through the ladder and the count never falls.

The regular Sit and Go board would go to zero and stay there. Spins would be
unaffected (no Spin satellites exist, so that count is already clean).

The Backup run for `af9ea7bc2d`, which DOES contain the fix, was certifying at
the time of writing, with three newer runs queued behind it. Every future main
commit contains the fix, so this resolves itself as soon as any certify
succeeds. If none had by 02:45 Chicago the plan was one dispatch of Backup for
an exact SHA (the one route the runbook gives an agent besides a push), and
failing that, to let the engine keep serving rather than ship half the change.

### Why the certificate was six hours old

Backup `refresh` failed five times between 01:40Z and 02:17Z. Two distinct
shapes, which the script reports with one sentence:

| run     | export step            | shape                                   |
| ------- | ---------------------- | --------------------------------------- |
| 01:40Z  | 01:47:21 -> 01:48:55Z  | succeeded; the run failed later         |
| 02:04Z  | 02:04:05 -> 02:04:06Z  | **failed in one second**                |
| 02:06Z  | 02:06:27 -> 02:06:27Z  | **failed in zero seconds**              |
| 02:17Z  | 02:19:29 -> 02:19:29Z  | **failed in zero seconds**              |

An instant failure means the first command, `schema-evidence.py capture`, never
got an answer - the `pg_dump` beside it never ran. Checked and excluded:
`postgresql-client-17` is installed in the failing runs; all eight signatures
in `SIGNATURES` resolve in production and have definitions; `schema_migrations`
holds 6,980 rows with 6,980 distinct versions, no malformed row, longest
version 33 characters; and Postgres logged no error, refusal or connection
problem in those windows. So the psql process failed before the server saw it.

`server/standby/schema-evidence.py` line 157 prints the same sentence -
"Schema evidence refused; capture, signatures, migration set or dump binding
invalid" - for a query that could not run and for evidence that was genuinely
refused, which is 10.86 rule 1: the two outcomes have one name, and the reader
is sent to look at the schema when the schema is fine. Whoever owns that lane
should separate them; this lane did not change the release path on the night of
a cutover, and #10122 shows another lane is already working in that area.

## What the shipped constants predict, so Wednesday is a comparison rather than a re-derivation

From `server/src/config/seatFirstLadder.ts` and the 03:00-06:00 no-new-board
window, with no people playing at all:

| board            | opens with | rung 1      | rung 2     | full cycle | boards | starts/day |
| ---------------- | ---------- | ----------- | ---------- | ---------- | ------ | ---------- |
| Spin             | 1 horse    | 60-80 min   | 30-60 min  | ~115 min   | 11     | ~120-140   |
| regular heads-up | 1 horse    | 180-240 min | fills      | ~210 min   | 6      | ~36-41     |

So the horse-only floor is an ESTIMATE of about 160 to 180 combined a day,
against a ceiling of 300. It is arithmetic from the constants, not a
measurement, and it stays an estimate until a full Chicago day has been
counted. A human who sits is filled inside the 3-7 minute band rather than
waiting out the ladder, so an active day adds starts on top of that floor.

**The acceptance test is the combined total, under 300 per Chicago day.**
Corrected 2026-11-09, because the first version of this paragraph said a day
over 300 with a large `human_triggered` count was "the platform working, not
the change failing". That was this lane softening the owner's own acceptance
criterion, and the owner rejected it. There is no reading of the number that
turns an over-target day into a pass.

What the split is for is DIAGNOSIS, after the verdict, never instead of it:

- over 300, almost entirely `horse_only` - the launcher is still opening or
  cycling too much; the cause is in the ladder, the board targets, or
  something else creating seat-first rows;
- over 300 with a large `human_triggered` share - the horse floor is not the
  whole story and the cause has to be found before anything is changed, under
  the owner's standing instruction to identify the cause before changing the
  seating rules or restricting human play.

Both numbers are reported separately every time, and the day is reported as
missing the target whenever the combined count is 300 or more.

Measured baseline to compare against: 2026-11-07 was 12,517 combined with ONE
human-triggered start in the whole day.

---

## Where the acceptance evidence lives (2026-11-09)

`/Volumes/SmarterArchives 1/agent-evidence/seat-first-ladder-01BbZPDj-20261109/`

Note the ` 1`. The SSD remounted under that name because a stale root-owned
directory occupies `/Volumes/SmarterArchives`, which is read-only and holds
only symlinks into the real volume. Writing to the plain path fails with
"macOS denied access" and a new directory cannot be symlinked back into it, so
anything written there by hand is lost. Use the ` 1` path.

The folder carries, with a `SHA256SUMS.txt` written in the container before
transfer and verified after it (all five files OK):

- `acceptance-evidence.md` - every measurement behind this change, with the
  read time against each one;
- `check-candidate-contents.sh` - reads a candidate's TREE for the three
  behaviours; exit 0 present, 1 missing, 3 could not tell;
- `verify-cutover.sh` - the post-cutover checks from
  `docs/ENGINE-RELEASE-RUNBOOK.md` section 4.8, read-only;
- `occupied-snapshot.sql` - one row per occupied game with an md5 of its
  (player, seat, stack) multiset, for the before/after across the restart;
- `cert-watch.log` - the certificate and engine-phase readings through the
  night.

### Contents are checked separately from schema inventory

A candidate has to pass two independent tests and they fail for different
reasons. `scripts/ci/select-daily-engine.py` checks the INVENTORY: the
certified copy's installed migration set must equal production's set read at
selection time. That says nothing about whether the build contains this lane's
behaviour, and commit ancestry is not enough either, because a later commit
can revert the lines. So `check-candidate-contents.sh` reads the tree at the
exact sha for the ladder constants, both satellite predicates in
`seatFirstBoardRoom`, and the human window on the engine and the client side.

Measured 2026-11-09 06:30Z: `af9ea7bc2d` and `045886dd3c` were both certified
and both carried the ladder and the feeder exclusion while the human fill was
still 3:00 to 3:30. They failed the inventory test as well, for an unrelated
reason. Two tests, two verdicts, and neither implies the other.

### The client and engine corrections may ship apart

The client correction went live with `fc2bfba558` while the engine still
served `391f7bc0`. That gap is safe in both directions, because the engine's
hold is never later than the countdown the client paints:

```
serving engine   min(seated + 350s, max(windowEnd, seated + 90s) + 30s)
new engine       min(seated + 420s, seated + 180s + jitter)
client countdown seated + 420s
```

Both engines act at or before the displayed instant, so "Deals In m:ss At The
Latest" stays literally true across the cutover; the only visible effect is
that a board may deal earlier than the countdown promised, which the client's
own header already allows.

The deadline is anchored to `table_seats.joined_at`, a durable column, not to
page-load time: all 549 live seat-first seats carried a non-null `joined_at`
when this was measured. A reload or a reconnect re-reads the same instant, and
a ladder advance rewrites `start_time`, which the human branch no longer
consults.

The AI-opponent disclosure is untouched by all of this. It lives in
`src/components/legal/aiOpponentsDisclosure.ts`, is pinned by
`tests/ai-opponents-are-disclosed.law.test.tsx`, and none of the three commits
in this change touches it or any surface that carries it. It already covers
the ladder's hours-long waits in its own words: AI opponents "Join Waiting
Lists, Move Between Games And Keep Regular Hours".

# Fourth pass, 2026-11-09 to 2026-11-10: activation, and three defects found on the live engine

Owner: session 01BNteGYH1cLZBgWwC6SvW3W (continued the handoff of session 01BbZPDj).

## Activations, from the release owners' own receipts

| When (UTC) | Serving | Route | Result |
|---|---|---|---|
| 2026-11-09 19:28-19:41 | `bff6eed3` instance `1-cc09e13a` | owner window `2026-11-09-owner-asap-engine-1530z`, Stage 42683454803, receiver 42683596427 | `RELEASE_RESULT: sealed`, `VERIFIED: true`, `SHIPPED: true`; break ended 19:38:29.416Z |
| 2026-11-10 06:10-06:30 | (none) | owner window `2026-11-10-owner-asap-engine-0440z`, Stage 42766761198, receiver 42766862282, candidate `8589213e` | `failed:observe`, `SHIPPED: false`: "the engine did not present a restart certificate with enough proof time remaining"; `bff6eed3` recovered, no player moved |
| 2026-11-10 09:51-10:05 | `840429a3` instance `1-eaca1bce` | standing 04:00 America/Chicago daily, receiver 42794253316 | `RELEASE_RESULT: sealed`, `VERIFIED: true`, `SHIPPED: true` |

Contents checked from each tree, not ancestry (`check-candidate-contents.sh`, exit 0 on `bff6eed3`, `8589213e`, `840429a3`): the ladder, the satellite-feeder exclusion, the full 3-7 minute window; `840429a3` also carries #10181 (feeder bound) and #10234 (opened-board room).

## Cutover reconciliation (first activation)

Snapshot A at drain start 19:31:31Z (58 games) against the in-freeze snapshot 19:36:18Z (53): 5 games COMPLETED by their final drain hand, 27 changed by exactly one drain hand each; 32 hands, all created 19:31:32-19:32:24Z, **zero hands during the countdown or freeze**. The in-freeze seat and stack comparison is the host's sealed proof (receipts 1475/159). Files: SSD archive `seat-first-ladder-01BbZPDj-20261109/cutover-capture/`.

## Backup refresh and the installers

- Post-seal D2 refresh 42687157923 failed `database_refresh_failed` (two installs this lane re-dispatched overlapped its export); the receipt-bound recovery 42703827039 **passed at 22:34:19Z** (owned by the #10222 lane).
- Installers: this lane disabled Apply/Dispatch Merged Migrations 18:12Z-19:43Z for the first window and re-enabled them. Disabling left run 42680942075 queued with no job, which wedged the applier queue; fixed at the root by #10220 (`ad095029`: a run queued ten minutes with zero jobs is skipped by name). Deferred files reinstalled and handed back: `20261109170604` and `20261109195211` installed; `20261109163346` (42703 column, #10200) and `20261109180446` (lock timeout, #10204) returned to their owners; `20261109152550` absent from main. GZo later paused and restored both workflows for later windows (#10273, and 06:35:04Z on 2026-11-10).

## The countdown is durable

Published `TablePage-Mq3jc1g8-v6.js`: the deadline is `min(t + 420 s, t + 180 s + spread)` with `t` read from this player's own `table_seats.joined_at` on every load (`nf`) and the server clock offset from `fn_db_now` (`rf`); a reload re-reads the same seat time. Engine side: the hold is counted from `joined_at` and the fill gate serves a human whatever the board window says, so a reset of an empty board's wait cannot postpone a seated person. No human seated at a seat-first board between the two activations, so the behavioural measurement is carried into the acceptance day.

## Defect 1: empty boards filled the room (#10234, `89ad71df`, live in `840429a3`)

On `bff6eed3`, 21:03Z: 32 Spin and 16 heads-up boards REGISTERING, all with no entrant and no live seat; room read 11-32 and 6-16, the launcher opened nothing, no seat-first board started after 19:42:55Z. Fix: the eleven and six count boards with a live seat; `ensureBoardOpen` reopens an owner's empty board (opening rung written first, then one horse) before creating one. Law: `anEmptyBoardIsNotOneOfTheEleven.law.test.ts`.

## Defect 2: horse-less clubs starved the budget (#10340, open)

On `840429a3`, 14:37Z: the house opened 6 heads-up boards at 12:00:53Z but only 5 Spins by 14:09Z; the 48 old empty boards belong to four certification fixture clubs ("Cert HU ...") with zero horse members, so every reopen failed yet spent budget and rewrote a window. Fix: a reopen asks the owner pool first; no free horse spends nothing.

## Defect 3: the 30-minute Spin expiry cancelled every Spin before its first rung (#10342, open)

`fn_spin_expire_unfilled` cancels a Spin once a seated player has waited past `spin_fill_policy.unfilled_timeout_minutes` = 30. Measured 2026-11-10: 40 house Spins created 12:01-14:09Z cancelled after an average 38 minutes, **40/40 refunded in full (998.00 chips)**, no Spin started. Fix: migration `20261110144739_a_spin_waits_out_its_horse_ladder` (timeout 160, constraint `0 OR >= 150`, law tied to `SPIN_LADDER`); takes effect at install.

## Horse-only rungs, measured on `840429a3`

Heads-up boards opened 12:00Z with first windows 187-230 minutes ahead (rung 180-240). Spin opening windows 60-82 minutes (rung 60-80 plus the reopen tick). Satellite feeders since activation: 9 (one 6-max, eight 9-max), none heads-up, so #10181's bound has not yet been exercised by a heads-up feeder.

## The acceptance day

Not 2026-11-09 or 2026-11-10: each contains a known defect (the old engine, then defects 2 and 3). The acceptance day is the first complete America/Chicago day after **both** #10342 is installed **and** #10340 is serving, derived from the serving history and the install receipt; under 300 does not pass if the intended boards did not operate.

## Verified working access routes (2026-11-10)

- GitHub: `gh` in the Mac host terminal (`mcp__remote-devices__counselors__host_terminal`); the cloud container's `GH_TOKEN` is invalid. When the shared REST quota is exhausted, GraphQL keeps working (`gh api graphql`).
- Production reads: Supabase Management API `POST /v1/projects/kuklfnapbkmacvwxktbh/database/query` with `read_only: true`, using the Mac's `SUPABASE_ACCESS_TOKEN`; never a DB password.
- Schema comparison without a DB URL: `capture-via-api.py` (SSD archive) runs `schema-evidence.py`'s exact capture through that API and validates with the module's own `validate()`.
- SSD archive: `/Volumes/SmarterArchives 1/agent-evidence/seat-first-ladder-01BbZPDj-20261109/` (note the space and the 1); `check-candidate-contents.sh` now takes `REPO=` and defaults to the Mac checkout.
- Long scripts on the Mac: launch with `subprocess.Popen(..., start_new_session=True)`; the bridge kills foreground process groups after about 60 s.

## Fifth pass: activation of the corrected build and the acceptance day

### Defect 4 (fixed, #10385, merged a364cb39)
The discovery past-start walk topped a seat-first board up to its full seat count, so a Spin with one horse could skip a rung. The walk now leaves a seat-first board with any live seat to the ladder (`rosterByTournament.get(id) !== 0` → skip). Law: `server/src/aSeatFirstBoardClimbsOneRungFromEveryLane.law.test.ts`.

### Releases
- `05ab41c3` (0050z window, custodian root 01a1bbdd; Stage 42965274517, receiver 42965360845) SEALED 05:30:54Z Nov 11.
- `f7735cca` (receiver 42994475679) replaced it at 09:21-09:29Z Nov 11, inside the 3-6 AM Chicago closure; same SHA restarted as instance `1-54cc0104` at the 04:00 Chicago break and still serving at 06:01:43Z Nov 12.
- Both trees verified to contain the ladder, #10181, #10234, #10340 and #10385 (`check-candidate-contents.sh` exit 0).

### Acceptance day: 2026-11-11 America/Chicago (06:00Z Nov 11 to 06:00Z Nov 12)

#### Why this day qualifies
- `05ab41c3` SEALED 05:30:54Z, receiver 42965360845 completed 05:32:00Z (before the 06:00Z start), VERIFIED and SHIPPED.
- `f7735cca` replaced it at 09:21-09:29Z (receiver 42994475679, inside the 3-6 AM Chicago seat-first closure); restarted as instance `1-54cc0104` at the 04:00 Chicago break; serving unchanged through 06:01:43Z Nov 12.
- Both trees carry the full set, read from the trees: ladder, feeder exclusion, 3-7 min window (`check-candidate-contents.sh` exit 0), #10181, #10234, #10340, #10385. Migration `20261110144739` (Spin expiry 160 min) installed 2026-11-10 17:10Z.

#### Counting definitions
- Start: `tournaments.started_at` inside the interval (`fn_ca_seat_first_daily_starts('2026-11-11')`). Cancellations and replacement boards are counted separately and are not starts.
- Human-triggered: any seat held by a profile with `is_horse = false`; an unreadable profile is not a human.
- Waiting board at hour H: first live seat joined at or before H, not started and not cancelled by H.

#### Results
| | Starts | Human-triggered | Horse-only |
|---|---|---|---|
| Spin | 115 | 2 | 113 |
| Regular heads-up | 33 | 0 | 33 |
| **Combined (requirement under 300)** | **148** | **2** | **146** |
| Satellite feeders (separate) | 3 | 0 | 3 |

**Under 300: met, with the intended boards operating all day (below).**

- Replacement boards created: 128 Spin, 41 heads-up. Cancellations: 11 Spin and 6 heads-up, **all inside the 3-6 AM Chicago closure** (owner's 3 AM rule), 15 + 6 entrants refunded in full (420.00 + 202.00 chips), 0 zero-refunds. 7 feeder cancellations with no entrants. **No Spin expiry cancellation outside the closure: the 160-minute timeout is compatible with the ladder.**
- Board availability, reconstructed at every hour: 11 Spin and 6 heads-up waiting at 00:00-03:00 and 07:00-23:00 Chicago; 0 during the 04:00-06:00 closure; 10 Spins momentarily at 19:00 and 22:00 during replacement. Starts per hour 1-16 outside the closure. Hourly census (SSD `hourly-census.jsonl`, 09:31-19:31Z) agrees; feeders (75-76 waiting) never entered either count.
- Ladder, every horse-only start: Spin first rung 60.1-80.0 min, second 30.7-59.6 min (113/113 in band); heads-up rung 180.4-239.8 min (33/33); **0 jumps** (no two seats joining together); deal within 4.1 s of the last seat.
- Humans: 2 human seats all day, both the third (filling) seat of a Spin with two horses waiting; dealt 3 s after the person sat. **The 3-7 minute rule had no eligible traffic** (nobody sat at a board that then had to wait).
- Feeders: no heads-up satellite feeder created or started, so **#10181's bound had no eligible traffic**. The 9-max feeders that ran started at least 2,401 minutes before their targets.

### Evidence
SSD `acceptance-2026-11-11/` (`ACCEPTANCE-RESULT.md`, `hourly-census.jsonl`, `ladder*.json`). Hourly availability and ladder transitions recomputed from `tournaments`, `table_seats` and `tournament_cancellation_receipts` after the interval closed.

### Status
Acceptance complete. No open defect in this lane. Items with no eligible traffic on Nov 11: the 3-7 minute human countdown live observation and the #10181 heads-up feeder admission/departure bound (both are pinned by law tests and were verified at activation; neither had a live opportunity).
