# The horse fleet alarms read the floor the owner planned

Three horse fleet pages were calibrated on the September estate (652-928 dealable tables, every horse cash hand on a ServerTableEngine table) and paged critical on the current owner plan working as specified.

Under the owner cash plan the Classic cash floor is withheld by schedule (`owner_union_cash_schedule`, 81 tables withheld on a healthy 2026-11-11 09:06Z heartbeat with reason `nothing_to_seat`), and Lightning carries most horse cash play on two host tables. `poker_hands_dealt_total` and `poker_actions_fleet_total` count ServerTableEngine tables only; a Lightning hand is counted in `poker_lightning_hands_total{outcome="settled"}`. Read 2026-11-11 13:40Z: 9 table-engine hands in 60 s against 199 Lightning hands in the same two minutes of `hand_atomic_commits` (96 + 103), matching the engine counter exactly per table.

Measured from Prometheus, 2026-11-05 13:00Z to 2026-11-11 13:00Z, with the existing break and floor-park guards:

| rule                                                | before (sustained 15 min or more)                                                | after       |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ----------- |
| HorseFleetCollapsed `poker_dealable_tables < 20`    | 16 runs, every day 09:00-13:00Z (3-7 dealable tables)                            | `< 1`: none |
| HorseCashActionsStopped `< 150` Classic actions/min | 35 runs, every day (Classic 28-111/min while Lightning settled 60-114 hands/min) | none        |

Hand history over the same mornings shows a healthy floor: 2026-11-11 12:00Z had 3,386 Classic cash hands and about 3,700 Lightning hands, more than either prior day.

Changes:

- HorseFleetCollapsed pages when no table can deal for 15 minutes. A small floor is the plan; a floor with capacity that deals nothing stays with SLOHandsAreNotBeingDealt, a wedged table with SLOTableHasStalled.
- HorseCashActionsStopped pages when horse cash play has stopped: no horse action at a Classic table and no settled Lightning hand. The two are different units, so no single floor is measured across them; an engine with no Lightning series reads it as 0.
- HorseFleetThroughputRelativeDrop and `sp:hands_dealt:same_hour_mean_6d` count settled Lightning hands on both sides, so play moving onto Lightning no longer reads as the floor draining.

Known residual: the owner's seat-first ladder cut horse Spin and Sit and Go starts from about 240 an hour to under 10 from 2026-11-09 20:00Z by design. Hands from those days sit in the six-day same-hour baseline, so the relative rule can still read the planned reduction as a drop until those days age out of the window (2026-11-16). That is the baseline doing what it documents, not a defect in this change.

Promtool 2.55.1 (checksum-verified darwin build) passes every monitoring test file the existing runner names; the new cases fail on the previous rules and pass on these. Monitoring configuration only, delivered through Deploy Monitoring.
