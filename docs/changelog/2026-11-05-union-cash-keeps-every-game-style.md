# The union cash schedule keeps every game style, with fewer tables

Owner order, November 5, 2026 (11:17 Chicago): "YOU WERE NOT SUPPOSED TO SLOW HOW LONG IT TAKES EACH HAND TO FINISH ON THE CASH TABLES! YOU WERE SUPPOSED TO DECREASE THE AMOUNT OF CASH TABLES THE HORSES ARE PLAYING!!! FIX IT SO THAT ALL CASH GAME OPPERATE AT THE SPEED AND STYLE THAT THEY WERE SUPPOSED TO, AND JUST REDUCE THE AMOUNT OF TABLES THE HORSES ARE PLAYING AT TO KEEP THE RAKE UNDER 200K A WEEK ON AVERAGE!!! FIX THIS NOW"

## What was wrong

No table's dealing speed changed. Measured from `hand_atomic_commits`, every Classic table dealt about 1-1.6 hands a minute both before and after the November 4 schedule went live at 15:25Z on November 5. The schedule (#9486) kept only Classic games and dropped every Lightning game (8-13 hands a minute each) and Madness FLO8, so the cash floor's average pace fell from about 4-6 hands a minute per table to about 1.2.

## What changes

Lightning and Madness games are back on the schedule, and the table count stays well below the old floor (34 tables on November 4-5, 62 the night before):

| Local time (Chicago)                     | Tables | Added at this point                                                                                        |
| ---------------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------- |
| 00:00-08:00                              |      4 | Classic NLH .10/.25, NLH .25/.50, PLO4 .10/.25, Lightning NLH .25/.50                                      |
| 08:00-12:00                              |     11 | Classic PLO4 .25/.50, PLO5/PLO6 .10/.25, FLH/FLO8, Madness FLO8, Lightning PLO4 .25/.50                    |
| 12:00 until prime                        |     13 | Classic NLH .50/1, PLO4 .50/1                                                                              |
| Sun-Thu 18:00-23:00; Fri-Sat 17:00-24:00 |     21 | Lightning PLO5 .25/.50, PLO6 .25/.50, NLH .50/1; Classic NLH/PLO6 1/2; Madness PLO5 1/2; fixed-limit slots |

Lightning PLO4 1/2 (about 1,000 rake an hour, the most expensive single table) leaves the prime slot. A Lightning game is now on the schedule every hour of the week, which the law test enforces.

## Rake forecast

Using the same measured mean rake per table-hour as #9486 (`rates-seven-days.json`, October 28-November 4), the ordinary week forecasts **164,604** in scheduled cash rake, 1,936 table-hours. Human-containing cash tables generated 19,288.66 in the same seven days (overlapping the schedule), so the expected weekly average stays under 200,000. This is a forecast, not a hard cap on human-generated rake.

No dealing speed, timer, fee, wallet, tournament or human-access behaviour changes. No migration.
