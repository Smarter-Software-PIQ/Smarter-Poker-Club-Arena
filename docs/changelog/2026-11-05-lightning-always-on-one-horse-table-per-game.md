# Lightning is always on, with one horse table per game

Owner order, November 5, 2026 (14:04 Chicago): "LIGHTNING MUST ALWAYS BE ON—24 HOURS A DAY, EVERY DAY." He added that "Lightning always on" does not automatically mean every one of the 11 tables must be filled with horses around the clock, and asked to "Separate the controls for game availability, feeder operation, and horse allocation" and to "Reduce unnecessary horse-occupied tables and duplicate horse-funded capacity."

## What was wrong

- From 15:25Z the Classic-only cash schedule (#9486) withheld horses from Lightning games. Every Lightning pool emptied by 15:27Z and has had no open slot since.
- The correction (#9553, merged, not yet live) goes the other way. It lets horses fill every Main and Feeder of every Lightning game around the clock. Measured that way, Lightning ran about four hands at once per game with about 22 horses in each pool.

## What changes

The three controls are separate:

- **Game availability.** Unchanged. All 11 enabled Lightning games stay enabled, in Lightning mode (`always_on`), open to every real player on every table.
- **Horse allocation.** Horses take seats only at each Lightning game's stable Main 1, at every hour of the week. There is no clock and no timer.
  - A seat is the pool's anchor (`fn_table_seats_lightning_anchor_guard`), so each horse pool is at most one six-seat table: one hand in flight, continuously.
  - Main 1 hosted pool anchors in all 11 games on November 5 (10:00Z to 15:00Z), so horses can still enter.
- **Feeders and further Mains.** These are not horse-funded. The session rotator walks surplus horses out through the normal `leaveTable` door at a hand boundary.

The Classic and Madness schedule is unchanged (3 overnight, 9 from 08:00, 11 from 12:00, 16 at prime time). Lightning entries leave that clock.

## Forecast

Measured November 5, 10:30Z to 11:30Z, same hour for every Lightning game: rake from `rake_records`, hands in flight from `lightning_hand` (formed to settled).

| Lightning game | Measured rake/hr | Hands in flight | One hand in flight, /hr |  /week |
| -------------- | ---------------: | --------------: | ----------------------: | -----: |
| FLH .25/.50    |              115 |            3.05 |                      38 |  6,334 |
| NLH .25/.50    |              247 |            3.68 |                      67 | 11,276 |
| NLH .50/1      |              510 |            4.05 |                     126 | 21,156 |
| NLH 1/2        |              959 |            4.05 |                     237 | 39,781 |
| PLO4 .25/.50   |              271 |            3.72 |                      73 | 12,239 |
| PLO4 1/2       |              842 |            3.15 |                     267 | 44,907 |
| PLO5 .25/.50   |              247 |            3.65 |                      68 | 11,369 |
| PLO5 .50/1     |              400 |            2.92 |                     137 | 23,014 |
| PLO5 1/2       |              324 |            1.15 |                     282 | 47,332 |
| PLO6 .25/.50   |              308 |            4.30 |                      72 | 12,033 |
| PLO6 .50/1     |              512 |            3.78 |                     135 | 22,756 |

- **Lightning at one hand in flight:** about 1,501 an hour, **252,196 a week**.
- **Classic and Madness schedule** (seven-day rates, #9486 method): **59,570 a week**.
- **Projected total: about 311,766 a week, against the 200,000 target.**
- **The remaining conflict:** continuous Lightning in all 11 games at its minimum horse footprint forecasts about 52,000 a week over the target on its own, before any Classic table. This change does not switch Lightning off to hide that.
- **Assumptions:** rake per hand stays at the measured rate, and one hand at a time runs at the measured Lightning hand length. The two-second next-hand fix changes the Classic hand rate by well under 1% (about 0.2 s on a cycle of about 45 s). Real-player activity adds to this total.

Rake already recorded is unchanged.
