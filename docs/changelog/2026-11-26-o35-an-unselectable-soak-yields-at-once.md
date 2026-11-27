# O35: An Unselectable Soak Yields At Once (2026-11-26)

Lane: release custody (engine cutover every three hours).

## What Went Wrong

The 22:00 CST cycle on 2026-11-26 kept serving. Its merge window (22:10 to 22:27 CST) then did what it is for: two migrations merged at 22:12 and 22:15 and installed at 22:13 and 22:16.

Backup run `45938154669` had begun certifying `e21eb7d915ed` at 22:09 on a copy read at 22:08. From 22:16 that copy lacked two migrations production held, so its certificate could never be selected. The mid-soak yield (O1) saw this, and kept soaking: one of its conditions was that fewer than 75 minutes remain to the next cutoff, and the 01:00 cutoff was 134 minutes away. The soak ran to 22:54. Run `45940769729`, for the commit that could ship, waited 38 minutes for the Backup host and began certifying at 23:00. One certification attempt was left for the 01:00 cycle instead of two.

The readiness report also called `e21eb7d915ed` READY at 22:57, because it reads the certificate status and not the copy's contents.

## The Fix

`.github/workflows/backup-engine.yml`, mid-soak yield:

- The 75-minute condition is removed. A soak yields when a newer active push run waits, the commit is provably unselectable (release-control projection diverged, or production holds a migration or required definition the copy lacks), and every read succeeded. A copy production has moved past never becomes selectable again by waiting.
- The time to the next cutoff is still read and reported in the yield reason; an unreadable clock still keeps the soak (CLAUDE.md 10.86).
- The mid-soak `refresh-due` read is unchanged. It passes `--control` only, and `tests/a-backup-copy-is-certified-by-what-it-holds.law.test.ts` pins that form to the cutover's own re-read; in the certify job the control SHA is the certified SHA, so the audit's note that it omits `--sha` changes no comparison and is closed as no defect.

Booking, freeze-baseline, hand-dispatched and schedule runs still never yield.

## Also In This Batch (Replayed From #12061)

Two changes written on 2026-11-26 and never merged, replayed onto current main without conflict:

- The selector names every candidate it refused and why (`refusedCandidates`, `uncertifiedCommits` in `daily-selection.json`, and on the cutover log). On 2026-11-25 three cycles kept serving while the log read `Deferred candidates: (none)` for builds the Backup had refused.
- The readiness post names the commit an active Backup run is really certifying after an in-place retarget.

## Proof

- `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`, "mid-soak yield" (6 cases): the far-from-cutoff case now expects `YIELDED_OBSOLETE` with `5400s to next cutoff`; the still-selectable, no-waiting-run, deferred-migration, unreadable and never-yield cases are unchanged.
- `tests/operations/daily-engine-selection.test.py` (16) and `tests/operations/three-hourly-readiness.test.py` (23) pass.
- Live proof pending: the first soak staled by a merge-window install more than 75 minutes before a cutoff.

## Not Fixed Here

The readiness report still says READY for a certificate whose copy production has moved past. It has no database identity to compare contents with; the selector, which does, refuses such a certificate at the cutoff.
