# O36: Readiness Tells The Truth About A Stale Copy (2026-11-27)

Lane: release custody (engine cutover every three hours).

## What Went Wrong

At 05:30 CST on 2026-11-27 the readiness check posted `READY 7c301a85a5e4` for the 07:00 cycle. That build's Backup certificate was green, but its copy had been restored at 01:25 CST, and the 04:15 window had since installed 20261124195144, 20261126191910 and 20261127043816. At 06:30 the selector refused it ("Backup copy lacks installed migration ...") and the cycle kept serving. Readiness read only the certificate status, not what the certified copy held, so its early warning said all clear when nothing could ship.

## The Fix

`scripts/release/three-hourly-readiness.py` now judges the first certified candidate's copy before calling it SELECTABLE:

- The copy's age is `database.restoredAt` in the run's own `certificate.json` (a run that reuses a copy certifies data restored earlier than the run).
- What production committed since then is read from the applier's own job logs: each `Apply Merged Migration` run and the daily-maintenance window installer print `[apply] <file>` and then `[apply] APPLIED` only when they commit it. ALREADY-APPLIED, QUEUED and refused attempts count for nothing.
- Engine-inert migrations (O33, `engine_inert` from `server/scripts/engine-release-installed-migrations.py`) are left out, as the selector does.
- A copy that lacks a committed migration makes the candidate DISQUALIFIED with the missing versions, and the search moves to the next certified commit. If any of these reads fails, the verdict is UNKNOWN (exit 3), never READY.

Reads stay read-only (`gh api --method GET`); job logs are read once per report.

## Proof

- `tests/operations/three-hourly-readiness.test.py`: 29 cases pass, 6 new: the 04:15 window install that cost 07:00 makes the certificate stale; a reused copy is dated by its restore; ALREADY-APPLIED, QUEUED and refused installs change nothing; earlier and engine-inert installs are not missing; every unread input is UNKNOWN.
- Live replay on the Mac against GitHub at 11:45 CST: `7c301a85a5e4` and `4f2a8bcc269e` (both refused at 06:30) read stale with exactly the selector's three versions; `3aa21caa9f7d` (sealed 10:00) reads fresh. About 30 s for a stale judgement, 4 s for a fresh one.
