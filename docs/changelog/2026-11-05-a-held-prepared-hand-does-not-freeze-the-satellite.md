# 2026-11-05 - a saved hand that never started no longer freezes a satellite

## What happened

Sunday Deep Stack Satellite 25 (fbb86b2a, 41 entrants, 5 tables) stopped
dealing at 18:30Z. Table aed78e3f prepared hand 55430351 and saved its
never-started original (hand-continuation sequence 0, `handStarted:false`,
permit `reserved`/attempted under generation c2f814cc). It did that the
moment a bust raised the cohort satellite's qualifier boundary. No hand dealt
anywhere from 18:31 to 19:04. Two successor rebuilds (18:39Z and 18:54Z) each
replayed the same original and froze the same way.

## Cause

- `checkSatelliteQualifierCompletion` releases the boundary only after every
  table answers `parkForTerminalCloseout(0) === true`, which requires
  `isBetweenHands()` (no hand controller).
- `runOriginalController` holds a prepared, never-started original at that
  same pause gate while the closeout hold is raised.
- So the boundary waited for that table to empty, and the table waited for
  the boundary to lift. Neither could move, and every rebuild came back to
  the same wait.

## Fix

- `ServerTableEngineDealing.isPreparedOriginalHeldAtTerminalCloseout()` is
  true only for that exact shape:
  - the engine is running, current, under the closeout hold and physically
    at the gate;
  - its controller is the retained prepared original;
  - the permit is attempted for this hand;
  - there is no continuation batch past sequence 0;
  - `handStarted === false`;
  - no settlement, post-hand, terminal-boundary or weekly-payout writer is in
    flight.
- The qualifier boundary counts such a table as parked. It releases
  (including that table, whose original then plays) only when the second
  serialized read says `continuing` and the held original is unchanged.
- A `qualifying` or `unresolved` field, or a held original that changed,
  keeps the boundary exactly as before. Nothing settles, voids or moves
  chips over the held hand, and table closeout still requires
  `isBetweenHands()`.

Pinned by
`server/src/tournament/aHeldPreparedOriginalDoesNotFreezeTheQualifierBoundary.law.test.ts`
and the engine predicate cases in
`server/src/tournament/PreparedOriginalSuccessorDrain.test.ts`.
