# A spent or refused successor claim holds the table; a start kill names its step

**2026-11-21. ClubArenaEngineKillStorm on cash table dbbc148e (08:17-14:31 UTC).**

## What happened

Hand #60380607 was refused at settlement (`original_winnings_sources_exceed_accepted_stack`: a feeder
seat move had left the player's promo principal keyed to the old table). Every successor generation then
asked `fn_ca_resume_hand_submission` for the retained hand and was answered `found=true, completed=false`
with `successor_financial_refused`, later `successor_financial_claim_spent`. Both answers are decided by
durable rows that only an operator correction changes, but the engine treated them as transient: each start
was a watchdog kill and an immediate rebuild into the same answer, about twenty kills a minute for six hours,
nine seats frozen, and two drift incidents.

Every kill read `start_failed:start_seed_hand_count`. The hand-count read had succeeded; the phase label was
simply the last one a `retryStartRead` had set, so the storm pointed at the wrong read.

## What changed

- `handHistory.ts`: `RETAINED_HAND_STANDING_PENDING` names the two durable pending answers. They throw
  `RetainedHandSubmissionRefusedError` (message text unchanged), so a cash start fences its generation and
  `GameServer.holdRetainedHandRefusal` holds the table, reports once, and rechecks every 10 minutes; a
  correction is admitted at the next recheck. Every other pending reason keeps the ordinary retry.
- `ServerTableEngineBase.start()`: every start step names itself (`start_restore_button`,
  `start_restore_kill`, `start_crash_recovery`, `start_retained_hand_resume`), so a `start_failed` kill names
  the step that failed. The zombie sweep counts the new boot steps as boot progress.

## Laws

`server/src/engine/aSpentSuccessorClaimHoldsTheTable.law.test.ts` (new; fails 5/10 against the old code), and
the two existing kill-label expectations that encoded the mislabel now name the real step.

The data cause (a cash seat move must carry its promo positions) is owned by the incident lane
(migrations 20261121142000, 20261121142714, 20261121143102 applied; root fix announced as
`a_seat_move_carries_its_promo_positions`).
