# The memory domain signal sees Lightning and handed-off hands

Follow-up to #10640 at the independent verifier's request: "the signal does not
see Lightning hands or hands completed through resumeRetainedHandSubmission;
count there too or state the limit in the runbook and the alert text."

## What source says

The learner is the trigger `fn_horse_exact_accept_hand` on
`hand_atomic_commits` (migration `20261106091733`). It fires on every accepted
hand, whichever boundary wrote it, and returns without learning when the stored
`public_memory_domain` is not valid.

- A Lightning hand's row is built by `LightningHandHost.handRow`, which carries
  `public_memory_domain`, and is committed by `fn_lightning_settle_hand` through
  `fn_ca_commit_hand_settlement`. The trigger learns from it as a cash hand
  (`tournament_id` null) under its own domain, speed `lightning`. It never
  passes through `logHandHistory`.
- A retained hand is committed by `fn_ca_resume_hand_submission`, again through
  `fn_ca_commit_hand_settlement`, from the row the original engine built. That
  engine's `logHandHistory` threw before its count.

## What changed

- `LightningHandBackend.settle` counts the accepted Lightning hand once, under
  the new closed `mode` value `lightning`
  (`HAND_MEMORY_DOMAIN_MODES`, zero-seeded with the rest).
- `resumeRetainedHandSubmission` counts a retained hand when the door answers
  `financial_handoff: true`, which only the committing call receives. The four
  columns the trigger reads are read back from the stored row in
  `handMemoryDomainReadback.ts`. Not awaited; it cannot throw.
- `HandMemoryDomainMissingOnCashShowdown` reads `mode=~"cash|lightning"`: one
  share, one floor. Same two metric names; no new rule.
- Nothing written to the database changes. `LightningHandHost.ts` is untouched.

## The limit

A retained hand whose committing answer was lost, whose post-commit work
finished on a later call, whose stored row could not be read back, or whose
original commit landed just before that process stopped is in neither series.
That undercounts; it never double counts. Stated in the alert description and
in `docs/runbooks/hand-memory-domain-missing.md`.
