# A seeded Lightning pool fills to two rings (2026-11-17)

**Owner decision.** Dan, 2026-11-17 about 15:00 Chicago, asked whether horse-seeded Lightning games should be filled past one ring: "Fill each to 10-12". Every current horse-seeded Lightning game is kept and grows. That leaves fewer free horses for Classic, which he chose.

## Cause

The latency_regression alerts (idle_to_match and fast_fold_to_next_hand, p95 9-21 s, firing 3-16 times an hour for 40 hours) were not engine latency.

- The engine's own legs are fast: fold_ack 1-2 ms, ack_to_idle about 85 ms, match_to_hand 300-590 ms. The median wait is about 2 s.
- Every alerting cluster held exactly 6 players, all horses. `LIGHTNING_STARTER_PLAYERS = 6` stopped the starter priority at one six-max ring, and the vibe target left the game there.
- With 6 players, one hand is dealt at a time. A new hand needs 4 idle players, so a folder waits for the hand in the air to end.
- Lightning PLO4 .25/.50 (705270cd), idle_to_match p95 by pool size:

  | Players in pool | p95    |
  | --------------- | ------ |
  | 6               | 20.9 s |
  | 17              | 4.6 s  |
  | 41              | 2.6 s  |

- Cluster c79d8ec2 did not go quiet because of 20261110214134. Its p95 stayed at 17-27 s until it emptied after 08:00Z.

## Change

- `LIGHTNING_SEEDED_POOL_PLAYERS = 12` (HorseUnionCashPlan.ts). Every seeded game is six-max, so 12 is two full rings: two hands in the air whose folders regroup with each other. A target of 10 or 11 would leave the second ring short.
- A starter table must have a free chair. A full Main hands the start to the game's feeder, which the ClusterController opens on the full table's buyer probe.
- The starter table's seat target is raised to cover the players the game is missing, capped at its chairs. It is only ever raised, and it is applied before the fleet seat budget.

## Unchanged

- The 70-90 s per-arrival pace (fn_ca_horse_roster_seat_guard -> fn_lightning_horse_admit_paced). Filling 6 -> 12 takes about 6 x 80 s.
- Gradual fill, the seat ceiling, the work schedule, bankroll and every other admission rule.
- The matcher and the alert rule.

## Tests

`server/src/services/aSeededLightningPoolFillsTwoRings.test.ts`: 5 of 7 cases fail on the pre-fix source and all 7 pass with the fix. It also pins the paced door's 70-90 s body.
