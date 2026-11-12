# The 1/2 games relaunch full time, the floor runs at triple the rate, and a game never breaks right after a human leaves

Dan 2026-11-11 17:17: "1/2 GAMES NEED TO START BACK UP AND RUNNING FULL TIME
AGAIN. I KNOW WE SHUT THEM OFF BECAUSE WE WANTED TO STAY UNDER A 'CERTAIN RAKE
AMOUNT'. BUT THAT CHANGES... RELAUNCH ALL THE 1/2 PLO AND HOLDEM CASH GAMES,
AND OTHER GAMES WITH ZERO RESTRICTIONS ON THE AMOUNT OF GAMES THAT CAN BE
OPEN. TRIPLE THE CURRENT RATE. (AND GAMES SHOULD NEVER BREAK RIGHT AWAY AFTER
A HUMAN LEAVES... 20-30 MINUTE MINIMUM TIME TO BREAK A GAME)"

What changed:

- Every game in the Midway union cash plan now runs on the `always` window;
  the window-count bound (the old 1,727 weekly table-hours budget born of the
  200,000 rake target) is retired. The plan grows to 21 games: Classic
  PLO4 1/2, switched off under the throttle, is back in the plan and
  re-enabled in the database (migration 20261111233000). PLO5 1/2 keeps its
  one game - PLO5 1/2 Madness, live full time - because the owner's
  one-game-per-stake rule (2026-10-23) is a database constraint
  (cash_games_one_per_key) allowing one enabled game per club, variant,
  stakes and template.
- The weekly rake target is tripled to a 600,000 forecast. A target remains a
  forecast, never a ceiling on human play.
- The cash activity scale relaunches at triple the reduced rate: 0.2 -> 0.6
  from 6 PM Chicago, November 11 (`RELAUNCH_CASH_POLICY_START_MS`,
  HorseCashSchedule.ts). The stage ladder is kept so dated replays stay true.
- A game never breaks right away after a human leaves. The plan remembers,
  per table, when it last saw a playing human; the higher-stakes human
  exception now outlives the last playing human by a deterministic per-table
  20-30 minute dwell, and the lone-horse stand honors the same dwell, so the
  horses play on and the fleet keeps seating for at least that long.
- Unchanged: the stake ceiling and forbidden variants, Lightning's own rules,
  the one-primary / second / third table selection, tournaments, Spins,
  Diamond Arena policy, and every human-access rule.
