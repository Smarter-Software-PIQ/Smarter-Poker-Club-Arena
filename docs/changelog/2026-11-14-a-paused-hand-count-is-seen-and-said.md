# A paused hand count is seen and said

Owner direction, 2026-11-14 01:24 America/Chicago ("FULLY BUILD, FIX AND ENHANCE
ALL OF THESE"), following the 2026-11-13 ruling that a Charles Rule countdown
pauses out of profit and resumes where it left off (migration
`20261114050737`, #10788).

## What changed

- **The pause is said.** The table's paused display and resume toast landed
  first in #10804 and are kept as merged. This adds the one message it did not
  have: the hand the profit is lost with hands left, "You Are Out Of Profit.
  Your Hand Count Is Paused At 7 Hands. You Can Leave Now"
  (`useCountdownPaused`). A pause already standing when the table opens is not
  announced.
- **Club Data shows paused players.** `ca_club_hit_run_status` returns
  `paused_rows` beside `rows` (migration `20261114072737`, function image
  only, md5-guarded). `rows` is unchanged, so a page on the previous client
  shows what it showed. The panel lists them as "Paused" and the pill reads
  "N Paused" when nobody owes hands.
- **Pinned as a law.** The resume rule itself is pinned by #10801's law;
  `tests/charles-rule-pause-is-said-and-listed.law.test.tsx` pins the pause
  message and the Club Data paused rows.
- **Two older database tests run in a root shell.** `hitAndRunHandCount` and
  `charlesRuleDoubleBeforeHouseTake` start their server as an unprivileged
  user when run as root, as `charlesRuleBigWin` already did.
- **The midnight flake.** The Daily Diamond custody race fix landed first in
  #10801 (one settlement day for the race) and is kept as merged. The
  legacy-burn pair in the same directory had the same shape and now reads the
  Chicago date once in its seed and derives the assert's day from the rows it
  recorded. No assertion was removed and no production SQL changed.

## Verified

`tests/unit/charlesRuleBigWin.pg.test.ts` on real PostgreSQL installs the three
migrations and shows the club's paused row and the player's status at seven of
ten through a pause and a resume. The legacy-burn fixtures need PostgreSQL 17
and are proven by their CI shard.
