# Classic games open tables without the supply throttle (2026-11-12)

Owner order (Dan, 2026-11-11 17:17 Chicago): relaunch the 1/2 games and other
games "WITH ZERO RESTRICTIONS ON THE AMOUNT OF GAMES THAT CAN BE OPEN", because
the rake throttle that shut them down no longer applies.

The schedule half of that throttle was retired by #10544 and #10556. The table
half was still live: `fn_cash_cluster_tick` cut every game's table cap to
`floor((cap_mains + 1) * 0.2)`, one table, and allowed a second or third only on
a three-hourly hash pick. The engine mirrored it by withholding horses from any
secondary table whose game was not picked (`second_table_not_picked`) and by
admitting at most one or two secondary tables per game in the cash plan.

Now:

- Migration `20261112154904` (window migration, installs inside the daily
  engine break) gives a Classic game its structural cap, `cap_mains + 1`
  (+1 with `allow_second_feeder`). Tables still open only through the OPEN rule
  (full floor, buyers on the list or eligible horses, one opening at a time)
  and still close through the consolidation break rule, so there is no
  open/close loop. Lightning keeps its previous allowance.
- `HorseFleetManager` no longer withholds horses from a Classic game's
  secondary tables; `horseCashPlanSecondTables` admits every live or opening
  secondary of an allowed Classic game. Lightning, or an unread Lightning set,
  keeps the single pick-gated secondary.
- Kept on purpose: `cash_games_one_per_key` (duplicate game definitions),
  `cap_mains` and the feeder topology (must-move ordering), stake ceilings,
  cash activity scale, slow-join pacing and the post-human dwell.

Tests: `HorseUnionCashPlan.law.test.ts` (every secondary admitted, nine tables
seatable, Lightning unchanged, breaking table never admitted) and
`ClassicHorseDemand.law.test.ts` (no hash-picked table count, migration shape).
