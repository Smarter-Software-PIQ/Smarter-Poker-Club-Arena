# A Stuck Release Owner Is Named By An Alert

2026-11-06. Follow-up to #9630.

## What happened

On 2026-11-05 release transaction 42099609162-1 held the engine runtime owner
for 2 h 36 m. systemd restarted it 222 times, and five newer releases refused
with "fresh scheduled release cannot compete with active runtime owner". No
alert fired, because the owner is a host systemd unit and nothing published
it. PokerEngineCannotBeReplaced watches the engine's restart gate, which was
not the thing refusing.

## The change

`server/scripts/collect-monitoring-health.sh` (host, every 60 s) now also
publishes, from `systemctl`:

| Metric | Meaning |
| --- | --- |
| `club_arena_engine_release_units{state}` | release units by state: active, activating, auto-restart, failed |
| `club_arena_engine_release_owner_age_seconds{run,state}` | how long a non-inactive release unit has held its state |
| `club_arena_engine_release_owner_restarts{run,state}` | how often systemd restarted it |
| `club_arena_engine_release_collect_ok` | 1 when the units were read this run |

This half is not fail closed, like the client error half: a host without
`systemctl` drops these series and sets `_collect_ok` to 0. The money,
settlement and cron gauges are never withheld because of it.

New rules in `infra/monitoring/engine-freeze-rules.yml`:

- **EngineReleaseOwnerStale** (critical): a release unit has held one state
  for more than 75 minutes. A staged release waits for its break at most one
  hour under the hourly policy and about 30 minutes before 04:00 daily.
- **EngineReleaseOwnerLooping** (warning): three or more restarts. The unit
  template parks a run in failed after five starts in twenty minutes (#9630).
- **EngineReleaseOwnerBlind** (warning): the collector could not read the
  units for ten minutes.

`tests/monitoring/engine-release-owner.test.yml` replays the 2026-11-05 loop,
an honest one-hour wait (no alert) and a 75-minute owner (alert names the
run), and is run by `scripts/ci/test-fleet-throughput.sh` in CI.

## Delivery

The rules load through `deploy-monitoring.yml` on merge. The gauges start
when the next engine control generation installs the collector.
