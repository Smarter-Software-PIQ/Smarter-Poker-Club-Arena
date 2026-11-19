# 2026-11-19: a late-night migration merge no longer costs the next morning's engine cutover

## What happened

The 03:30 Chicago daily selection on November 19 (Stage run 44462209828, job
"Record the daily release evidence") kept serving. The candidates certified on
the current Backup copy (53a7b6aad 07:16Z, 5d12da55e 08:16Z, 24e3b2b2c 09:15Z)
were all refused "Backup copy lacks the exact candidate migration(s)
20261119013426, 20261119013430, ...", and the only older certificate
(a8d93bd37, 06:07Z) was on a copy production had already moved past. Four
merged engine fixes waited a day.

## Root cause

`scripts/ci/merged-migration-dispatch.mjs` held every ordinary merged migration
from 23:45 to 04:15 Chicago. The 23:45 start was sized for the 00:07 nightly
Backup schedule. That schedule is not what refreshes the copy: GitHub delivered
it at 13:52-15:37 UTC (07:52-09:37 Chicago) every day from November 14 to 19.
The copy is refreshed by contents on every Backup push run, and every merge
that adds a migration triggers one. So a migration merged 23:45-00:45 was held
past 03:30 for no benefit, it could never be on a certified copy, and every
engine candidate that carried it or descended from it was refused.

## Fix

The hold now starts at 00:45 Chicago and still ends at 04:15. 00:45 is the
last instant whose install two full Backup runs can still certify before the
03:30 cutoff: the install can land just after a run copied, so that run
finishes and the next run copies and certifies. Measured over the 29 most
recent successful Backup runs: refresh plus certify min 43.2, p50 62.0, p90
67.3, max 68.7 minutes, so `BACKUP_CERTIFICATE_WORST_MINUTES` is
2 x 69 + 2 = 140, and 00:45 + 140 min = 03:05, 25 minutes before the cutoff.
Inside the hold production stays exactly the copy the 03:30 selection judges,
as before.

Replayed against November 19: the held migrations merged at 23:35, 00:15, 00:27
and 00:37 Chicago would have installed at once, 5d12da55e (certified 02:16
Chicago) and 24e3b2b2c (certified 03:15 Chicago) would have held them on a copy
equal to production, and the selection would have had a current candidate.
518815486 (02:34 Chicago) stays held: no copy could certify it by 03:30.

The dispatcher's PR note now prints the planner's own window
(`releaseFreezeChicago` in the plan) instead of a retyped one.

## Safeguards unchanged

Exact-version certification, the contents check (copy set equals production
and holds every ordinary candidate migration), protected main only, one
publisher, the cutover's re-read of production's installed set. No new retry,
watcher or timer: the merge's own dispatcher run is still the one bounded wait
(worst hold now 210 minutes, budget 285, job timeout 300). This touches no
release-control input, so no certificate is invalidated by merging it.

## Remaining limits

- An engine change, or a migration, merged after about 00:45-02:15 Chicago
  cannot be certified by 03:30 and waits a day. That is the certification time,
  not the hold.
- During the hold a Backup push run certifies main's newest server commit. If
  that commit carries a held migration the certificate cannot be selected that
  night; the selector falls back only to an older certificate made on the
  current copy. A Backup run that certifies the newest commit whose ordinary
  migrations production already holds would close this; it is not built here.

Pinned by `tests/an-ordinary-migration-waits-for-the-daily-engine-selection.law.test.ts`
(6 of 11 cases fail on the 23:45 rule).
