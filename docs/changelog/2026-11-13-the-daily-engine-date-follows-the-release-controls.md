# The daily engine date follows the release controls

**2026-11-13 - EngineCutoverMissed `0cadf63e-73f9-4c9a-b5d3-aa672421a371` (fired 2026-11-12 and 2026-11-13)**

## What failed

The 4 AM engine update missed on 2026-11-11 and again on 2026-11-13. Each time the daily preparation run stopped at its 03:30 cutoff with `Release controls changed during reservation; keep serving.`

- On 2026-11-13, owner-window bookings #10672 and #10691 changed `server/release/owner-maintenance-windows.json` after Stage run 43366032752 had reserved the date at 04:31Z.
- That file is part of the release-authority projection.
- The cutoff correctly refused to execute the new release controls under the old reservation.

## Root cause

The election in `stage-engine-release.yml` handed the date to the earliest eligible run, whatever release controls it carried. The later runs triggered by those merges carried the new controls, the exact controls the cutoff binds. But they had already deferred to the earlier owner. So one release-control merge during the five-hour reservation stranded the whole day.

## Fix

An earlier run reserved under different release controls than this run's source is no longer an owner. The first run carrying the controls the cutoff binds now owns the date.

- The cutoff refusal is unchanged, so nothing ever runs under older release authority.
- A projection that cannot be read keeps the earlier run as owner, as before.
- No timer, retry, watcher or second dispatcher is added.

Pinned by `tests/the-daily-date-follows-the-release-controls.law.test.ts`, which executes the real election script against a real Git history.
