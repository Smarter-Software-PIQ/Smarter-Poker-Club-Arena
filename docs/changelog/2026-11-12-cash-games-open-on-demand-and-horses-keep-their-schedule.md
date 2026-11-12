# Cash games open tables on demand, and horses keep their work schedule (2026-11-12)

## Owner orders

- Dan, 2026-11-11 17:17 Chicago: relaunch the 1/2 games and other games "WITH ZERO
  RESTRICTIONS ON THE AMOUNT OF GAMES THAT CAN BE OPEN", because the rake throttle
  that shut them down no longer applies.
- Dan, 2026-11-12 10:47 Chicago: "HORSES MUST BE FOLLOWING THERE 'DAILY WORK
  SCHEDULE' AND ALSO THERE DAYS OFF. MAKE SURE THIS IS FULLY FOLLOWED AND
  IMPLEMENTED."

## No count limits how many tables a game opens

Before: `fn_cash_cluster_tick` cut every game to `floor((cap_mains + 1) * 0.2)`
(one table) with a three-hourly hash pick for a second or third; under that the
tick never passed `cap_mains + 1`; and `trg_tables_cluster_table_ceiling` refused
any table past `cap_mains + 4`. The engine mirrored the picks by withholding horses
from unpicked secondary tables (`second_table_not_picked`) and admitting at most
one or two secondaries per game in the cash plan.

Now (window migration `20261112154904`, installs inside the daily engine break with
the engine change in the same pull request):

- The tick has no table count for any game. Tables open only through the
  unchanged OPEN rule (every table full, enough buyers, one opening at a time, two
  minutes after an abandoned feeder) and close through the consolidation rule.
- The ceiling trigger is a runaway guard measured in demand: a game already
  holding two live or opening tables with nobody seated cannot get a third
  (`table_refused_unused_tables`). No game with players is capped.
- The engine admits and seats every secondary table of an allowed game, Classic
  and Lightning; only an unread Lightning set keeps the old pick as a fail-safe.
- Kept: `cash_games_one_per_key` (one enabled must-move DEFINITION per club,
  variant, stakes and template: a duplicate-game guard, any number of tables open
  under it), stake ceilings, cash activity scale, slow-join pacing, post-human dwell.

## Horses keep their work schedule and days off (`HorseWorkSchedule`)

A horse is on duty only when it is not its rest day, its daily cap is not played
out, and it is inside its work hours (weekly regular pattern or daily window).

- Seating: no rest day or daily cap waiver for a person short at a table; the
  four work-hour widenings (rescue, PLO Lightning, opening feeder, dealable
  minimum) are removed (`ploActivityPool` deleted).
- Waiting lists: an off-duty horse leaves every game list and does not answer a
  seat call.
- Going home: the rotator sends every off-duty cash horse home through the
  ordinary leave door; HIT AND RUN and the big-pot orbit decide when, never
  whether. `StableHand.forceLeaveReason` had no caller, so before this nothing
  ever sent a horse home at the end of its shift, its day or its cap.
- Tournaments: no new registration on a rest day.
- Measured before (2026-11-12 16:49Z): of 103 seated cash horses, 11 were outside
  their work hours, 1 was on its rest day and 4 were past their daily cap.

Tests: `HorseWorkSchedule.law.test.ts`, `HorseUnionCashPlan.law.test.ts`,
`ClassicHorseDemand.law.test.ts`, and updated wiring pins.
