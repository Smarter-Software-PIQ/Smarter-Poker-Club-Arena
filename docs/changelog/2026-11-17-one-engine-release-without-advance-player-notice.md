# One engine release without advance player notice (owner order, 2026-11-17)

At 11:05 Chicago on November 17, 2026 the owner assigned a dedicated engine custodian (Claude session `session_01BNteGaEWc6gWKEopygU5zs`) and ordered, verbatim:

> For this release, execute the earliest qualified engine cutover without an advance player-warning announcement or notice countdown. Preserve safe hand completion, settlement, certification, admission, recovery and live verification.

The same assignment states that this supersedes earlier owner instructions requiring advance player notice for this cutover, and that it does not authorize interrupting an active hand, bypassing settlement, forcing an uncertified replacement or weakening recovery safeguards.

## What stood in the way

Since November 7 every booked owner window must carry `playerNoticeAt` at least twenty minutes before `notBefore` (`tests/a-booked-window-gives-players-notice.law.test.ts`), the booking gate and the after-merge check require that timestamp, the booking command refuses a booking without it, and the client shows a banner for every booked window (from one hour before it opens when it has no notice instant). The only exemption was the certified emergency recovery profile, which is not this case. There was no supported way to book an ordinary release with no advance notice without inventing a notice time.

## The change

- `scripts/ci/owner-notice-waiver.mjs` (new) holds the owner's exact sentence and one predicate. An ENGINE window is waived only when its `ownerNoticeWaiver` is that exact sentence, its `ownerOrder` contains it, it has no `playerNoticeAt`, and it closes by `2026-11-18T09:30:00Z`. Any other record carrying `ownerNoticeWaiver` is refused. Database windows are never waived.
- The notice law, `scripts/ci/check-owner-window-booking.mjs` and `scripts/ci/check-owner-window-notice-after-merge.mjs` exempt exactly that record from the notice rules. Its `notBefore` and `notAfter` are still judged.
- `scripts/generate-owner-maintenance-notices.mjs` does not project a waived engine window, so the client shows no banner for it and `src/utils/ownerMaintenanceNotices.json` is unchanged by such a booking.
- `scripts/release/book-owner-engine-window.py --no-advance-notice` books such a window: no `playerNoticeAt`, the waiver field, an order that must contain the exact sentence (and no longer the phrase "twenty minutes"), a floor-suite test that pins the absence of a notice, and a notice-law case that pins that nothing is shipped.

## What does not change

- No release mechanism: `server/scripts/engine-release-activation-floor.py`, the seal, the host transaction, Stage and the receiver never read `playerNoticeAt`. Certification (current-schema Backup copy, 1800-second soak), admission, the single-use claim, the 285 s reserve, rollback, seal and thaw are as before.
- Hands still finish. The serving engine's own recovery window (`engine-recovery-window-v1`) announces the last hand, lets every table finish its hand, then freezes; that two-minute drain is how active hands and settlements complete, it belongs to the build being replaced, and it is kept. What is removed is the advance warning ahead of it.
- No notice timestamp is written, no receipt is edited, and no witness is recorded for a notice that did not happen.
- `scripts/ci/owner-window-ready.py` is unchanged. It only notifies; for a waived window it holds with "the player notice has not been public", so it sends nothing. The custodian dispatches by hand, as the runbook requires.

## Known cost

This is the situation the November 7 rule was written for: on that day a cutover booked without notice gave players only the engine's two-minute last-hand warning, and joins during the freeze were refused. The owner has chosen that for this one release.
