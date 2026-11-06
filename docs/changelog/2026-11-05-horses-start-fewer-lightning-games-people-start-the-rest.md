# Horses start fewer Lightning games; people start the rest

Owner order, November 5, 2026, 14:32 Chicago: "THERE IS NO CAP OR CLOCK THAT SHOULD BE WATCHING THIS, JUST HAVE AND LAUNCH FEWER LIGHTNING GAMES, TO OFF SET THE TOTAL RAKE COLLECTED... LIKE NO LIGHTNING GAMES GET STARTED BY HORSES IN A FEW GAMES STAKES, UNLESS HUMANS SIT DOWN, IF A HUMAN SITS DOWN, THEN MORE HORSES CAN SIT AS WELL... FIGURE OUT THE RIGHT ALGO TO INSURE THAT THE GAMES STILL RUN, BUT NOT ALL THE TIME, AND WE STAY UNDER THE 200K MARK."

This replaces the one-horse-table-per-game cap proposed earlier the same day, which was never merged.

## The rule

There is no per-game cap and no clock. Speed, rules and styles are unchanged.

- **Every Lightning game stays enabled and open to people.** All 11 keep `always_on`, Lightning mode and their feeder behaviour.
- **Horses start two Lightning games on their own:** NLH 0.25/0.50 and PLO4 0.25/0.50, listed in `horseUnionCashPlan.json` under `lightningHorseSeeded`. There, horses sit at any table at any hour, exactly as #9553 allowed.
- **Every other Lightning game is started by a person.**
  - While someone is playing at any of its tables, horses may sit at all of them, so the game fills and runs normally. A seat is the pool's anchor, so a pooled person counts.
  - While nobody is, horses do not seed it.
  - When the last person leaves, the session rotator walks its horses out through the normal `leaveTable` door at a hand boundary.
- **Who counts as a person.** Sitting-out and departing chairs do not start a game, and horses never do. If the read is incomplete, no horse is seated in a person-started game, and the rotator walks nobody out on that pass.

The Classic and Madness schedule is unchanged (3 overnight, 9 from 08:00, 11 from 12:00, 16 at prime time).

## Forecast

These are seven-day measured mean rates at normal speed and full participation, the same method as #9486.

- **Horses alone:**

  | Part                             |    Per week |
  | -------------------------------- | ----------: |
  | Lightning NLH 0.25/0.50, always  |      29,592 |
  | Lightning PLO4 0.25/0.50, always |      51,957 |
  | Classic and Madness schedule     |      59,570 |
  | **Total**                        | **141,119** |

- **Person-started Lightning and real-player play:** only while people play. Human-containing cash tables raked 19,289 from October 28 to November 4, which is taken as the planning reserve.
- **Planning total: about 160,400 a week, about 39,600 under 200,000.**
- **The adjustment lever:** if actual weekly rake runs high, move a horse-started game into the person-started list. That is a data change in `lightningHorseSeeded`, and it is not a cap or a timer.
