# Finding: 36 disabled games in retired test clubs fail every cluster tick

2026-11-08. Recorded during the feeder-rule verification; not caused by it and
not fixed here.

- Since 20:30:03 UTC (eight minutes before migration `20261108193515` was
  applied), 36 disabled cash games write a `controller_tick_error` to
  `cash_cluster_events` roughly every 5 seconds:
  `CLUB_RETIRED: gameplay and cashier records are read-only` (SQLSTATE 55000).
  About 580 errors per game in the first 49 minutes.
- They belong to four retired test clubs, nine games each: Crest Cert Template
  c4770672 (`0be5ee41`), 6dc7e348 (`96bd011b`), 32085314 (`a15f7d9e`) and
  fba91d7b (`b3ec63d3`).
- No enabled game has logged a tick error since 20:38 UTC.
- Effect: event-table growth and tick time spent on games that can never run.
  The cause to look at is the tick pass still selecting games in a retired
  club, so each one's first write hits the retirement guard.
