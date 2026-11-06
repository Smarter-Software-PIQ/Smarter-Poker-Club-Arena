# Classic 1/2 No Limit and Classic 1/2 PLO run 9 AM to 4 AM

Dan, 2026-11-05 15:38 Chicago: "WE NEED TO HAVE AT LEAST ONE 1/2 NO LIMIT GAME, AND AT LEAST ONE 1/2 PLO GAME RUNNING DURING ALL HOURS EXCEPT 'NONE PEAK TIMES' LIKE 4AM TO 9AM. MAKE SURE THAT THERE IS ALWAYS A MINIMUM OF ONE GAME RUNNING", then "NOT LIGHTNING GAME, REGULAR CLASSIC POKER".

## Change

Classic NLH 1/2 and Classic PLO6 1/2 (the enabled Classic 1/2 PLO game) move from the `prime` window (18-23, Fri-Sat 17-24) to a new `nine_to_four` window: 09:00 through 03:59 Chicago, every day. A window whose start is after its end now runs through midnight (`scheduledHorseCashGames`); equal ends still never run. Madness PLO5 1/2, Lightning, fixed limit and every other game are unchanged. The law test pins both games on the schedule at every hour of an ordinary week outside 4-9 AM, and off it inside.

## Rake forecast

Measured on production over the seven days to 2026-11-05 (`hand_history.rake_amount` by hour, hours with at least 20 hands): Classic NLH 1/2 raked 128.2 per active hour (143 hours), Classic PLO6 1/2 raked 209.0 (129 hours). Each game gains 94 scheduled hours a week (39 to 133), so about 94 x 337.2 = 31,700 a week more. Against the 160,400 planning total recorded in `2026-11-05-horses-start-fewer-lightning-games-people-start-the-rest.md`, the week forecasts about 192,100, under 200,000 with about 7,900 of headroom. Scheduled Classic and Madness table-hours go from 1,539 to 1,727 a week; no hour exceeds 16 tables.

No dealing speed, rules, fee, wallet, tournament, Lightning or human-access change. No migration.
