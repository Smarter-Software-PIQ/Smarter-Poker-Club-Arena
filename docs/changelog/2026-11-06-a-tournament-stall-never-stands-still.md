# 2026-11-06 - a tournament stall never stands still

## Why

Owner rule: a tournament must never freeze. Three gaps could still leave a
tournament dealing nothing with nothing left trying.

1. The repeated-recovery ledger (#9569) refused a rebuild that would return
   to the stall its previous rebuild left for a whole hour, so an event a
   rebuild could not cure stood frozen for up to sixty minutes. Its page
   cadence map was never pruned.
2. The satellite qualifier boundary (#9560) released a retained,
   never-started original only for a continuing field. A qualifying field
   answered `pending` over it on every sweep, while the table held that
   original for exactly as long as the boundary held: a circular wait, and a
   rebuild replays the same original into the same wait.
3. A retained original under a plain hand-for-hand pause (`pauseAfterHand()`
   without `beforeNextHand`) and an unclaimed tournament move was let start
   by the unclaimed-move exemption, dealing a hand outside the hand-for-hand
   round.

## What changed

1. `tournament/repeatedRecoveryLedger.ts`: a repeat is held only for an
   exponential backoff from the last rebuild of the same stall, 2, then 4,
   then 8 minutes (capped), and then rebuilt again. A completed hand still
   clears it. The incident is paged once per window and names when the next
   rebuild runs; each retried rebuild is reported as
   `GameServer.tournament_repeated_recovery_retried`.
   `repeatedTournamentRecoveryAlertedAt` is pruned with the ledger.
2. `TournamentManagerEliminations.checkSatelliteQualifierCompletion`: a
   qualifying field settles its qualifiers over held originals that are still
   proven unstarted after the second read
   (`isPreparedOriginalHeldAtTerminalCloseout`). The boundary keeps the hand
   held through settlement, and the committed cleanup stops its dealer. The
   permit cannot be cancelled `never_started` (retention was attempted;
   `fn_f06_cancel_prepared_hand` refuses retained start evidence), so this is
   the disposal every terminal event already uses for a held original.
3. `ServerTableEngineDealing.runOriginalController`: the original waits at the
   gate whenever hand-for-hand holds the table, even under an unclaimed move.
   `resumeDealing()` releases it, because an unclaimed move on a retained
   original never blocks that release.

No SQL, no money path and no seat movement changed.

Pinned by
`server/src/tournament/aRepeatedStallIsRetriedNeverLeftStanding.law.test.ts`,
`server/src/tournament/aQualifyingFieldSettlesOverAHandThatNeverStarted.law.test.ts`
and
`server/src/engine/aRetainedOriginalWaitsForTheHandForHandRound.law.test.ts`.
