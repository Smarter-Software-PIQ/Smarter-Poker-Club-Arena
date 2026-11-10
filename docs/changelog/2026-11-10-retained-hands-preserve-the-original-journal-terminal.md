# Retained hands preserve the original journal terminal

A lease successor could commit a retained original hand while bypassing the
normal completed-hand observation. Hand 58345928 demonstrated the split:
financial commitment is proven, but the original journal has no accepted-hand
terminal. Its missing original source transport cannot be reconstructed and
this change does not retrospectively accept it.

The original hand producer now captures a private immutable terminal with its
exact release SHA, original lease, canonical actions and hand identity inside
the existing accepted facts before retention. After the existing successor
transaction proves commitment, its consumer reads those committed facts once
and sends only the bound terminal to the original journal shard. It never
replays a wager, settlement, memory learning, observer mirror or plan effect.
The ordinary observation also uses the same captured terminal fields.

Missing legacy transport, changed source, changed digest, incomplete commitment
or a mismatched hand/payload stays unaccepted. Recovery across different engine
revisions deliberately remains unavailable rather than attributing an old
choice to a new source. Identical terminal copies use the existing reconciler's
identical-acceptance semantics; duplicate delivery cannot duplicate learning.
No migration, schedule, backfill or new release operation is introduced.

Focused protection covers original mutation, missing and mismatched provenance,
receipt-hash mismatch, no additional financial RPC, worker source refusal,
no-learning duplicates and owner-only journal routing. Deployment requires the
existing protected engine route and a naturally recovered prospective terminal;
source/test success alone is not live acceptance.
