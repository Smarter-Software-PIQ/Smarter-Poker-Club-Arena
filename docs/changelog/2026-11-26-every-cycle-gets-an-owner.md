# Every Cycle Gets An Owner (2026-11-26)

Lane: release custody (engine cutover every three hours).

## What Went Wrong

A cutover cycle is prepared only when a Stage run created inside its election window claims it. Eligible runs come from a push to main, a delivered schedule tick, a delivered Backup completion, or the operator's own dispatch. GitHub delivered 8 of Stage's 96 scheduled runs a day here, and it creates no `workflow_run` event for a Backup started with the job token (the post-seal and keep-serving Backups). So a window with no merge to main had no owner. The 10:00 CST cycles of 2026-11-25 and 2026-11-26 never ran. O32 made such a cycle announce itself; the cycle was still lost.

## The Fix

`docs/ENGINE-RELEASE-RUNBOOK.md` 4.1 already allows one operator dispatch (`prepare-daily-engine`) from an authenticated user inside the preparation window when no Stage run has appeared. Stage admits it to the same election as every other run: it carries no SHA, date or receiver input, cannot reserve early and cannot displace an earlier owner.

That step now runs on a real clock:

- `scripts/ops/cutover-operator-preparation.mjs` reads the Stage runs of the election window. If one can own the cycle it prints `FOLLOW <run id>` and sends nothing. If none can, it sends the dispatch once. Outside a preparation window it does nothing. If the run list cannot be read it prints `UNKNOWN` and still sends, because the election refuses a second owner and a cycle with no owner is lost.
- `ops/openclaw/ca-cutover-operator-preparation.json` declares the OpenClaw cron on the Mac Studio: minutes 33 and 41 of hours 0, 3, 6, 9, 12, 15, 18 and 21 CST, which is 3 and 11 minutes after each preparation opens. The second firing sees the run the first one caused.

No release-control file changed. This is the scheduled preparation the owner ordered (CLAUDE.md section 13), made punctual; it selects, certifies and deploys nothing itself.

## Limits

- The Mac Studio must be on with a valid `gh` login. Otherwise the route behaves as it did before, and O32 still announces an ownerless cycle.
- An owner does not make a cycle ship. A cycle with no certified candidate still keeps serving.

## Proof

`tests/every-cycle-gets-an-owner.law.test.ts` (11 cases): the 10:00 CST cycle of 11-26 gets the dispatch; every eligible owner is followed; ineligible runs are not counted; 160 window minutes a day and both daylight-saving days; an unreadable list is UNKNOWN; exactly one POST with no input; the cron fires twice in each of eight windows; Stage still admits the dispatch. Live proof is the first cycle whose only Stage run is titled `Original operator daily preparation`.
