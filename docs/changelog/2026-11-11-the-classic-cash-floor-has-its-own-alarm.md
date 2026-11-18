# The Classic cash floor has its own alarm

#10506 made `HorseFleetThroughputRelativeDrop` a Lightning measure, because `poker_hands_dealt_total` is mostly tournament hands and the seat-first ladder cut tournament volume. `HorseCashActionsStopped` pages only when Classic and Lightning stop together. A Classic cash floor that went dark while Lightning kept dealing was therefore measured nowhere.

Production Prometheus, the six days to 2026-11-11 17:50Z, outside the break and owner parks:

- A relative Classic arm, `sum(rate(poker_actions_fleet_total{format="cash"}[30m]))` against its own same-hour mean, ran 9 sustained false 30-minute runs, because the owner schedule moves the Classic floor from day to day. It is not used.
- The Classic cash rate never reached 0, and never fell under 0.1 actions/s, for 15 minutes. The quietest healthy hour reads about 0.7 actions/s.

`ClassicCashFloorDark` pages when no one, horse or human, has acted at a Classic cash table for 15 minutes outside the break or an owner park. It uses the existing zero-seeded series: no new counter and no change to the Lightning arm. Coordinated on #10506 before opening.
