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

Now (migration `20261112154904`, ordinary: installs on merge):

- The migration ADDS two functions under their own names,
  `fn_cash_cluster_tick_uncapped(uuid, integer)` and
  `fn_cash_clusters_tick_all_uncapped(jsonb)`, built from production's own
  definitions by checked replacement (same SECURITY DEFINER, search_path and
  grants: service_role only). The originals are not touched and no overload is
  created (`tests/a-door-the-engine-calls-by-name-has-one-overload`). The
  uncapped tick has no table count of any kind. Tables open only through the
  unchanged OPEN rule (every table full, enough buyers, one opening at a time,
  two minutes after an abandoned feeder) and close through the consolidation rule.
- COMPATIBILITY CONTRACT: only this engine calls the uncapped functions
  (`ClusterController.uncappedTick`); every older engine calls only the
  untouched originals, so install order and engine rollback are both safe. The
  release gate's door check requires both new functions in production before
  this engine ships (`uncappedTickRpcName`, `uncappedTickAllRpcName`); should it
  ever run without them (PGRST202) it falls back to the capped tick. A law makes
  any later tick migration redefine the uncapped twin too. Dry run on
  PostgreSQL 17 against production's md5-identical definitions: compiles,
  originals unchanged, live-proof true, re-run refused.
- The ceiling trigger is a runaway guard measured in demand: a game already
  holding two live or opening, not-closed tables with nobody seated and no seat
  held cannot get a third (`table_refused_unused_tables`). No game with players
  is capped.
- The engine admits and seats every secondary table of an allowed game, Classic
  and Lightning; only an unread Lightning set keeps the old pick as a fail-safe.
- Kept: `cash_games_one_per_key` (one enabled must-move DEFINITION per club,
  variant, stakes and template: a duplicate-game guard, any number of tables open
  under it), stake ceilings, cash activity scale, slow-join pacing, post-human dwell.

## Every enabled Midway game inside the stake ceiling is in the plan

The relaunch plan pointed its "FLH 1/2" and "FLO8 1/2" entries at the 1/2-BLIND
fixed-limit games, which the lobby calls FLH 2/4 and FLO8 2/4. The lobby's FLH 1/2
and FLO8 1/2 (1/2 limits on .50/1 blinds) were not in the plan, so no horse could
sit there (measured 17:14Z on 08c27924: both empty while PLO4 1/2 and PLO5 1/2
Madness filled). Added, full time: FLH 1/2, FLO8 1/2, FLH .10/.25, FLO8 .10/.25,
NLH .05/.10, PLO5 .50/1, PLO6 .50/1. The 2/4 entries keep running and are renamed
to say what they are. PLO5 2/5 Madness stays out: above the Omaha stake ceiling.

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
- Tournaments: no new registration on a rest day, ticket or not.
- Measured before (2026-11-12 16:49Z): of 103 seated cash horses, 11 were outside
  their work hours, 1 was on its rest day and 4 were past their daily cap.

Tests: `HorseWorkSchedule.law.test.ts`, `HorseUnionCashPlan.law.test.ts`,
`ClassicHorseDemand.law.test.ts`, and updated wiring pins.
