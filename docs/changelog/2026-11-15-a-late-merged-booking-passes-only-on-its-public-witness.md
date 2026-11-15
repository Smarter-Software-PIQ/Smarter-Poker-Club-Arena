# A late-merged booking passes only on its public witness, and a booking needs thirty minutes of headroom

From 11:59 UTC on 2026-11-15 every pull request failed the required job "TypeScript compilation and repository checks":

```
2026-11-15-owner-offcycle-engine-1206z: playerNoticeAt 2026-11-15T11:40:00Z is before the booking merged (2026-11-15T11:59:42.000Z)
```

## Cause

#10959 booked `2026-11-15-owner-offcycle-engine-1206z` with `playerNoticeAt` 11:40Z and `notBefore` 12:06Z. Its checks ran while 11:40Z was still within the five-minute tolerance of `scripts/ci/check-owner-window-booking.mjs`, i.e. before about 11:45Z, so that gate passed. The pull request then merged at 11:59:43Z without its checks running again. From then on `main` held a window whose declared notice came before its own merge, and the after-merge backstop (`check-owner-window-notice-after-merge.mjs`) failed for every pull request. This is the same failure as 0440z on 2026-11-10.

## Why the record was not edited

The window was used by sealed receipt `43717613638-1` (auto-deploy-hetzner run 43717613638). `server/scripts/engine-release-activation-floor.py` requires the window's `notBefore` to equal `activationAt` in `server/release/activation-floor.json`, and its `releaseWitness` pins that floor's sha256 (`c800ccd0...`). A truthful notice would need a later `notBefore` and therefore a new floor, which would mean resealing a release that is already sealed. The booking gate also re-judges any edited record against the clock, and all of this window's times are now in the past. So the record, the floor and the seal are left unchanged.

## What players actually got (evidence)

- Notice: publish-club-arena run 43711575766, job `client-publication / production / publish-to-origin` (132805701293), published booking commit `7e8688d360ebe4316f2fcd37eb60753f73af99b5`. The log line `2026-11-15T12:06:39.2563255Z origin and player route serve 7e8688d` verifies both `https://ca-static.smarter.poker/build-info.json` and `https://smarter.poker/hub/club-arena/build-info.json`. That is the earliest provable public notice: 12:06:39.256Z.
- Activation: auto-deploy-hetzner run 43717613638, job `Publish Through Hetzner Club Arena` (132822899394). Durable intake began at `13:13:09Z` (`ENGINE_RELEASE_INTAKE=durable`) and the result `ENGINE_RELEASE_RESULT=sealed` came at 13:16:45Z.

So the release began installing 66 minutes after the public notice, well beyond the 20-minute lead, after `notBefore` (12:06Z) and before the fixed expiry (15:00Z).

## The change

- `scripts/ci/owner-window-notice-witnesses.json` (new; outside `server/`, so it never becomes an engine release input) records that evidence for 1206z only.
- `scripts/ci/check-owner-window-notice-after-merge.mjs` accepts a window that merged after its notice only when a witness exists for it and all of these hold:
  - the window is on main;
  - the witnessed notice is no earlier than the merge;
  - activation began at least 20 minutes after the witnessed notice;
  - activation falls between `notBefore` and `notAfter`;
  - activation has already happened.

  A witness never excuses a window booked in the same change or a missing notice. A malformed, duplicate or orphan witness fails the check.
- Root cause: `scripts/ci/check-owner-window-booking.mjs` now refuses any added or changed record whose `playerNoticeAt` is less than 30 minutes ahead when the pull request is checked. An ordinary merge delay can no longer carry an accepted notice into the past; a booking that waits longer must be pushed and checked again. Unchanged records, including every consumed window, are never re-judged.
- Pins: `tests/a-booking-cannot-start-in-the-past.law.test.ts` and `tests/operations/owner-window-booking-gate.test.mjs`.
