# The ownership check reads the description as it is now

**2026-11-21.** Engine booking #11640 (window 1906z) was opened without its `Lane: release-custody` line; the
line was added a minute later. The `edited` run of Ownership map was cancelled, and every re-run replays the
original event payload, so each re-run read the old description and failed on the locked release-control
paths. The booking sat unmergeable for 40 minutes of a three-hour window until the description was re-saved.

`scripts/ci/ownership-check.mjs` now reads the pull request's description live from the API
(`currentDescription`); the event payload is the fallback only when that read fails, and the fallback is
logged. A re-run therefore always judges the current description.

Law: `scripts/ci/ownership-check.test.mjs` "a re-run reads the description as it is now". Proved against
#11640 with a stale payload: old code exit 1 (LOCKED x5), new code exit 0.
