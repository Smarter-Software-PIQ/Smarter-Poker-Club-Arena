# A feeder never outlives its target

2026-11-09. A regression the seat-first waiting ladder introduced, found by
this lane in its own change and fixed here.

## What broke

A heads-up satellite feeder is two seats. `ladderForSeats` reads seats, so it
called a feeder a regular Heads-Up and handed it the 3-to-4-hour rung. Before
the ladder, `createSatelliteHeadsUp` opened with the old 90-350 second window
and a feeder filled, played and handed its seat over in minutes. The ladder
replaced that one line with `seatFirstOpeningWindowMs(config.maxPlayers)`.

Two things make that wrong rather than merely slow.

**The ladder paces a quota a feeder is not in.** The rung exists so the room
stops running itself all day: one horse on each of eleven Spins and six Sit
and Gos. `seatFirstBoardRoom` deliberately excludes every row with a satellite
target from that count, so a feeder was being paced by an economy it is
explicitly not part of. That is this change disagreeing with itself.

**A feeder sold a seat in ONE event.** Waiting hours lets the target start
first, and then the feeder can never award what it sold. The existing
authority on that is `fn_ca_expire_empty_fixed_sng_satellite`, which cancels
an EMPTY REGISTERING feeder once its target's `start_time` has passed. The
ladder seats a horse immediately, so the feeder is no longer empty, that
reaper answers `not_empty_registering`, and the row stays. The ladder did not
only slow the feeder down; it put it out of reach of the thing meant to clean
it up.

## The fix

A feeder keeps the short window and is bounded by its target's own clock.

```
available = targetStart - requiredLead - now
wait      = min(90-350 s draw, available)
available <= 0  ->  null: do not open it, and do not keep it waiting
```

`requiredLead` is `SATELLITE_HU_TARGET_LEAD_MS`, the 30 minutes the platform
already requires for this format, passed in rather than duplicated, so there
is one number for one rule. Capping at the target's START would be too late:
the feeder still has to play out and hand the seat over, which is what the
lead is for.

The bound is re-derived on every rung from the target's CURRENT `start_time`,
in `GameServer.seatFirstNextWaitMs`, so a rescheduled target moves the bound
instead of leaving a feeder waiting against a clock that no longer exists.

An unknown or non-finite target clock returns `null`. Not knowing is never
permission, which is the same answer `fn_ca_expire_empty_fixed_sng_satellite`
gives as `target_clock_unknown`.

If the feeder check itself cannot be read, the rung advance falls back to the
LADDER rung and reports it. That direction is deliberate and stated in the
code: a mis-paced feeder is a rare row, while a regular board that loses its
rung is re-asked every twelve seconds and re-inflates exactly the volume the
ladder was built to cut.

## Exposure

None at the time of the fix. Zero heads-up satellite feeders were created in
the ten days to 2026-11-09, so no row had taken the wrong rung in production.
It is fixed before the behaviour is called delivered rather than after a
feeder fails to award a seat somebody bought.

## Tests

`server/src/config/aFeederNeverOutlivesItsTarget.test.ts`, seven cases over
the target's four states:

- **approaching** - a target hours away gets the short window, and the test
  pins that the heads-up rung is longer than the whole window so the
  regression cannot come back silently;
- **approaching but tight** - the wait is cut to the room left rather than to
  the band;
- **started** - a target at or past its start, or inside the required lead,
  yields `null`;
- **closed or unknown** - a non-finite target clock, now, or lead yields
  `null`;
- **rescheduled** - pushed back, the band applies again; pulled forward inside
  the lead, the feeder stops waiting;
- the whole band is reachable, so feeders do not mature in lockstep;
- at every draw, `now + wait + lead` never passes the target's start.
