# A newer migration held behind a refused older one installs after it (2026-11-22)

Production Alerts 447640 and 447641 (`MergedMigrationNotInstalled`).

## What happened

- 22:10-22:12Z: `20261122192807` was refused on its anchors. The applier runs
  for `201323`, `203048` and `205903` each installed older files first, reached
  `192807`, and stopped before their own file - correctly, because sending a
  newer file over a missing older one is the inversion
  `install-older-merged-first.mjs` exists to prevent.
- 22:45Z: #11785 fixed `192807` in place. Its run installed `192807` and
  nothing else: the older-first step never looks above its target, so the three
  held files had no route back to production.
- `203048` and `201323` landed only because a lane re-sent one by hand; `205903`
  needed a second hand dispatch. Until then the install watch paged the owner.

The refusal text even promised "its fix's run then installs both in order",
which was true only for the fix's own file.

## Fix

Once the target installs (exit 0) on a run that is not check-only, the same
applier run calls `install-older-merged-first.mjs --newer-after`. That step
installs every NEWER ordinary file on main that production does not hold,
oldest first, once each through the same applier, under the same rule as the
older-first step (the 20261110000000 floor; window and SUPERSEDED files
excluded). It sends at most `MAX_OLDER` (5); the first that does not install
stops the step and the run goes red naming it and the files after it. A newer
file's own run, if still queued, answers ALREADY-APPLIED.

The workflow change is restamped in
`scripts/ci/fixtures/cash-link-union-proof-index/source-binding.json`
(`aNewerFileHeldBehindARefusedOlderOneInstallsAfterIt20261122`).

Pinned by `tests/an-older-merged-migration-installs-first.law.test.ts`, which
now models this incident: before the fix 8 of 24 cases fail, after it 24 of 24
pass. The existing "single shared group would lose a file" pin now models the
older-first rule alone.
