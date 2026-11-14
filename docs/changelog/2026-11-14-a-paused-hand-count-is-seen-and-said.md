# A paused hand count is seen and said

Owner direction, 2026-11-14 01:24 America/Chicago ("FULLY BUILD, FIX AND ENHANCE
ALL OF THESE"), following the 2026-11-13 ruling that a Charles Rule countdown
pauses out of profit and resumes where it left off (migration
`20261114050737`, #10788).

## What changed

- **The player is told.** The hand the profit is lost with hands left: "You Are
  Out Of Profit. Your Hand Count Is Paused At 7 Hands. You Can Leave Now". The
  hand it picks back up: "You Are Back In Profit. 7 Hands Left Before You Can
  Leave" (`useCountdownPauseResume`). A pause already standing when the table
  opens is not announced again.
- **The paused count is shown.** Beside the hero's seat (`HeroVpipTracker`,
  "Hand Count Paused 7, Resumes When You Are Back In Profit") and between
  Lightning hands (`HitRunCountPill paused`), only while nothing is owed.
- **Where it is read from.** `fn_my_hit_run_status` already returns the kept
  total and hands played; a row that owes nothing, is not completed and has
  hands unplayed is a paused count (`pausedHandsOf`). A classic table's engine
  seat carries only hands owed, so while it says none the count is read from
  the database once when the table opens, then after each hand only while a
  count was just owed or is paused. Lightning already reads it every hand. No
  engine change.
- **Club Data shows paused players.** `ca_club_hit_run_status` returns
  `paused_rows` beside `rows` (migration `20261114072737`, function image
  only, md5-guarded). `rows` is unchanged, so a page on the previous client
  shows what it showed. The panel lists them as "Paused" and the pill reads
  "N Paused" when nobody owes hands.
- **The rule is a law.** `tests/charles-rule-countdown-resumes.law.test.tsx`
  pins that the newest image of `fn_cash_session_evaluate` clears only the
  start stamp when the profit is lost, plus the messages, the displays and the
  Club Data rows.
- **Two older database tests run in a root shell.** `hitAndRunHandCount` and
  `charlesRuleDoubleBeforeHouseTake` start their server as an unprivileged
  user when run as root, as `charlesRuleBigWin` already did.
- **A midnight flake is closed.** The Daily Diamond custody race read
  "yesterday in Chicago" in four separate sessions; on 2026-11-14 the seed and
  racers ran before 00:00 and the assert at 00:00:01, and shard 1/7 failed on
  #10788. The seed now decides the day once, the racers settle the day it
  recorded and the assert reads that row. The legacy-burn pair had the same
  shape and reads the date once too. No assertion was removed and no
  production SQL changed.

## Verified

`tests/unit/charlesRuleBigWin.pg.test.ts` on real PostgreSQL installs the three
migrations and shows the club's paused row and the player's status at seven of
ten through a pause and a resume. The custody race itself needs PostgreSQL 17
and is proven by its CI shard.
