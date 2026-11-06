# 2026-11-05 - an expired release owner retires on any serving release

## What happened

Engine release transaction 42099609162-1 (target 57e0dd5b) announced an hourly
break at 20:27Z and did not reach cutover inside its 7-minute recovery window.
From then on it looped: systemd restarted the unit every 30 seconds (222
restarts by 22:52Z), each start logged `original owner recovery window
expired; no later window is authorized` and exited 75, and each recovery step
logged `exact failed routine custody is unproved; original owner retained`.

Because the unit was always `activating`, `newer_release_in_flight` treated it
as the live runtime owner, so every newer release (42103535706, 42110255207,
42113639293, 42117871256, 42120308115, which carried the satellite fixes,
#9543 and #9571) died with `fresh scheduled release cannot compete with active
runtime owner 42099609162-1`. Production stayed on 71087373 from 18:21Z. The
host crash restarter also exits early while any release unit is activating,
so it was switched off for the same 2.5 hours.

## Why the owner could never retire

`cmd_prove_expired_recovery_announcement` in `engine-release-seal.py` was the
only path that retires an announcement-only owner, and its first requirement
was that the sealed desired release equal `FAILED_ROUTINE_DESIRED` /
`FAILED_ROUTINE_IMAGE`, the Oct 29 eed06fe5 image frozen for run
41349091113-1. Production moved to 67bc0e85 at 05:21Z on Nov 5 and to 71087373
at 18:21Z, so from then on the proof failed on its first line for every
expired owner, the wrapper exited 75, and the unit template
(`StartLimitIntervalSec=0`, `Restart=on-failure`) retried it forever.

## What changed

- `engine-release-seal.py`: the expired-announcement proof reads the sealed
  desired identity (`state.desired.sha` / `imageId`) and proves the serving
  container against that. `failed_routine_runtime` takes a `desired` pair; the
  failed-routine commands bound to run 41349091113-1 keep their frozen default.
  `failed_routine_require` names the invariant that failed so the journal says
  why an owner was retained.
- `engine-release-transaction.sh`: `newer_release_in_flight` ignores a unit
  whose SubState is `auto-restart`. A live owner holds a process; a unit
  waiting out RestartSec between two failures does not.
- `install-engine-supervisor.sh`: the release unit template gets
  `StartLimitIntervalSec=20min` and `StartLimitBurst=5`, so a dead transaction
  parks in failed state instead of looping.
- `scripts/ci/read-scoped-release-recovery.py`: the retained-refusal source
  profile moves to the new seal and transaction digests; the previous profile
  joins the prior list.
- `tests/operations/expired-release-owner-retires.test.py` pins all four
  properties and runs in production-integrity-audit.

## Host actions taken the same day (engine-01)

- `systemctl stop club-arena-engine-release-v1@42099609162-1` with a
  retirement note in `engine-release-cancellations/42099609162-1.manual-retirement.json`.
- Drop-in `club-arena-engine-release-v1@.service.d/bounded-restarts.conf`
  (same StartLimit values as the template change above).
- `club-arena-engine-crash-restart.sh` only yields to a release or intake
  unit that holds a process.
- `MALLOC_ARENA_MAX=4` in the engine env file; 54 glibc arenas held 1.4 GB of
  fragmented native memory on 71087373.
