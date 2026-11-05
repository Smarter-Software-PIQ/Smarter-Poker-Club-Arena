# A chair seated after a frozen hand does not block its operator cancellation (2026-11-05)

## What was stuck

Nine events from the owner's November 2 deletion order were still RUNNING on
November 5. Eight retired at 18:18-18:22Z after the 18:11Z engine release
(#9536 closure hold). The ninth, Midnight Free Buy (6429087f, 37 horses,
operation d44c4440), stayed `stop_requested`: every closure request came back
503 Outcome Unknown.

## Cause, read from rows

Its table fe4237f3 holds the retained original hand 51510645 (permit
c4469b4f), captured 2026-10-29 06:28:39Z with eight chairs. At 09:09:01Z the
balancer seated a ninth player (seat 9) on that table while the hand was
frozen. That chair was never dealt in. `fn_ca_cancel_tournament_abort_unsettled_hand`
refused any live chair missing from the capsule, so it answered
`operator_abort_retained_original_unproven` on every attempt.

## Fix

Migration `20261105183850`: a live chair missing from the capsule refuses the
cancellation only when it was seated at or before the capsule was retained
(`a.joined_at <= c.created_at`). Every other byte of the function is
unchanged. The migration asserts the installed pre-image (md5 `2eb90c4b...`)
and the post-image (md5 `9ec2ae80...`), both checked against a local
PostgreSQL build of the exact file.

Probed on production in one self-aborting DO block (CLAUDE.md 11.5) with the
real permit, hand image hash and lease generation: the current function
refused with the exact error; the candidate returned `aborted_unsettled` and
its own money pre/post-image assertion held. Rolled back; nothing committed.

Pinned by `tests/unit/aChairSeatedAfterAFrozenHandDoesNotBlockCancellation.test.ts`.

No chip moves in this migration. The event's money disposition remains the
owner's November 2 ruling (owner retirement to the Midway Main Bank).
