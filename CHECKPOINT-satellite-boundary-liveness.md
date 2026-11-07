# Satellite qualifier boundary liveness

Owner: chat 01UxDLnJCCkZMnzUbU4AypNf (2026-11-07). Assignment: Satellite 30 (cc250e58-9fab-4f63-a194-c0ce693519f5) froze on five tables from 02:34:56Z to 04:05:39Z with 47 players seated and late registration open; fix the class at its root so no satellite, MTT, Spin or Sit & Go can freeze on a hand boundary for this or a sibling reason; deliver through the protected route. Own checkout: cloud clone of protected main e94ed5c30; branch fix/satellite-boundary-liveness-01uxdl. Evidence: /Volumes/SmarterArchives/agent-evidence/satellite-boundary-liveness-20261107/.

## Root cause

The satellite qualifier boundary parks every table in the event and is released only by the elimination sweep. The sweep walked every table through a two-phase park before releasing, whatever the authority's first read said, and each step of that walk could answer pending on every sweep for a condition the boundary itself created (a retained original the boundary forbids starting, a dealer stopped under the boundary with no bust able to move the generation, a break source that cannot park). Four production freezes since 2026-09-28 were this shape. #9753 (merged 23:09Z 2026-11-06, not yet activated) repaired the exact entry_open-plus-held-original case; the class remained.

## Repair (server/src/tournament)

- TournamentManagerEliminations.checkSatelliteQualifierCompletion: an entry_open answer, or a continuing/unresolved answer with the live field more than SATELLITE_BUBBLE_MARGIN (1) above the tickets, releases the boundary on the first read, before any park. Inside the margin and for qualifying fields the two-phase park, dealer proofs and settlement are unchanged. An unresolved answer far from the tickets no longer holds the boundary. Every pending answer names its reason.
- TournamentManagerBase.releaseSatelliteQualifierBoundary: never refused for a stopped or replaced recorded dealer; lifts the fence from every running dealer this manager owns and clears the boundary; only a moved generation or a stopped manager refuses.
- TournamentManagerBase.noteSatelliteBoundaryPending: a boundary held past 60 s pages Tournament.satellite_boundary_held (critical, one open row per event, reason refreshed on change or every 5 min, never during a maintenance freeze).

## Validation

- `npx tsc --noEmit -p server/tsconfig.json`: clean.
- `npx vitest run src/tournament`: 334 files, 4,867 passed, 1 skipped.
- New: aBoundaryTheAuthorityDoesNotNeedIsNotHeld.law.test.ts (22 cases, real TournamentManager). Re-pinned at the bubble margin: aHeldPreparedOriginalDoesNotFreezeTheQualifierBoundary, aBreakSourceTheBoundaryCannotParkFinishesItsBreak, aSatelliteThatBustedNobodyIsNotAskedUnderTheWholeLane, SatelliteCapacityBoundaryAdmission, TournamentDurableBreakRecovery; aQualifyingFieldSettlesOverAHandThatNeverStarted entry-open block rewritten to the first-read release.

## Delivery

Engine change: protected squash merge, backup-engine/certified on the merged SHA, daily preparation 03:30-03:50 America/Chicago, activation 04:00 America/Chicago (owner direction 2026-11-06). Run identities and live proof recorded in the evidence folder.
