# Lightning games always run

The November 4 union cash schedule put every horse cash table on a Chicago
clock. Lightning games were caught by it: only one Lightning game was on the
schedule, and Lightning Feeder tables were excluded outright, so from 15:27 UTC
on November 5 the Lightning pools emptied and stopped dealing.

Dan's rule: Lightning tables always run. They play as Feeder games until enough
players are seated, and the Cluster turns to Lightning only when there are
enough players. There is never an on/off timer for these games.

Every table of a Lightning-enabled game (`cash_games.lightning_enabled`), Main
or Feeder, is now outside the clock schedule. The Cluster controller alone
decides Feeder versus Lightning by player count. The forbidden-variant and
stake-ceiling rules still apply, because they are not timers. The Classic
schedule is unchanged. If the Lightning game list cannot be read, seating keeps
the previous rule and the session rotator walks nobody out for the schedule on
that pass.

A law test pins every Lightning Main and Feeder as allowed at every hour of a
whole week.
