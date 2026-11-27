# The Projection Drain Yields To A Local Envelope (2026-11-27)

Finding 6 of the database-load review: the per-hand path.

## What Was Measured

Production, 2026-11-27 02:46:44Z to 02:50:33Z, pg_stat_statements and
pg_stat_user_tables deltas (read-only):

| Item                                                           | Count | Per hand                       |
| -------------------------------------------------------------- | ----- | ------------------------------ |
| Hands committed (hand_projection_outbox inserts)               | 838   | 1.00                           |
| fn_project_hand_side_effects calls                             | 1,212 | 1.45                           |
| Hands with a stored rake/BBJ obligation (designed second pass) | 148   | 0.18                           |
| Projection calls left over (projection-first race)             | 227   | 0.27                           |
| fn_ca_process_hand_post_commit_obligations calls               | 841   | 1.00                           |
| fn_f06_retain_hand_continuation calls                          | 7,713 | 9.2 (13.1 per tournament hand) |
| hand_continuations rows written (inserts plus updates)         | 7,718 | every call is a new sequence   |

## The Cause

The engine that commits a hand applies its post-commit envelope itself right
after the commit reply. The drain, running almost continuously under load,
read the new outbox row in the same instant and sent the hand's projection
beside the engine's call. When the projection took 'hand-post-commit:<table>'
first it applied the envelope inside its own call, answered
predecessor_pending (post_commit_completed_in_this_transaction), and owed a
second full call (a third for a raked hand). The engine's own call, on the
dealing path, waited on the same mutex meanwhile.

## The Fix

handProjection.ts keeps a process-local claim per hand from the commit reply
(handHistory.ts claims before it wakes the drain) until
processHandPostCommitObligations settles for that hand, bounded at 3 s. The
drain defers a claimed row with no round trip, exactly like
predecessor_pending, and the release wakes it (wake source local_envelope).
No SQL, money logic, ordering or idempotency changed. New series:
poker_hand_projection_local_envelope_yields_total.

Expected after deploy: about 1.18 projection calls per hand (from 1.45), about
0.27 x 95 ms of database time saved per hand.

Law: server/src/services/supabase/theDrainYieldsToALocalEnvelope.law.test.ts.
