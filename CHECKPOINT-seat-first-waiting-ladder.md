# Seat-first waiting ladder and the under-300 board — 2026-11-08

Scope: cut combined Spin and regular Sit and Go starts to under 300 a day by
changing how horses seat, not by slowing play or restricting human seating.
Owner: this chat, as the delivering agent. Under the September 17 owner
instruction each authorized agent owns its own delivery, so "release owner" for
#10094 is this lane; there is no separate person to coordinate with, and the
04:00 daily preparation is owned by whichever Stage run reserves the date.

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

## What shipped — PR #10094, squash `744549f3791cc71040529f8aef36f5fe81a77a51`

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
  `smarter.poker/hub/club-arena/build-info.json` = `744549f379…`, built
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

## Still open, and why

| item                                                      | status                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine activation, serving SHA, SEALED receipt, full thaw | waits for 04:00 Chicago 2026-11-09                                                                                                                                                                                                                                                                         |
| Live horse-only ladder timings, board limits, human fill  | observable only on the new engine                                                                                                                                                                                                                                                                          |
| Countdown in a signed-in browser                          | NOT performed. Signing in needs credentials; Dan's personal account is forbidden for probes (10.10 rule 2) and the service identity lives in `.env.local`, which 10.84 forbids reading. No existing e2e covers the partner-hold countdown. The durable chain is proved above from schema and code instead. |
| The under-300 day                                         | the first COMPLETE Chicago day after a 04:00 activation is 2026-11-10                                                                                                                                                                                                                                      |

## How the number survives this session

`fn_ca_seat_first_daily_starts(date)` — read-only, one bounded Chicago day per
call, no writes — is read by the existing estate digest at 06:07 Chicago, after
the day it reports has closed. It prints total, human-triggered and horse-only
for Spins and regular heads-up against the 300 target, with satellite feeders
on their own line outside the comparison, and any unexpected format printed
rather than folded into the total. Its query body was verified against
production for 2026-11-07 and reproduces the baseline table above exactly.

No Claude scheduled task was created for any of this (10.85).
