# Retained hands preserve the original journal terminal

A lease successor could commit a retained original hand while bypassing the
normal completed-hand observation. Hand 58345928 demonstrated the split:
financial commitment is proven, but the original journal has no accepted-hand
terminal. Its missing original source transport cannot be reconstructed and
this change does not retrospectively accept it.

The original hand producer now captures a private immutable terminal with its
exact release SHA, original lease, canonical actions, original private turn-clock
receipts and hand identity inside
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
The already-atomic resume branch previously dropped the original accepted roster
when rebuilding its response from stack_result. Migration
`20261110214347_retained_hand_resume_returns_original_accepted_roster.sql`
returns the existing protected capsule through accepted_hand_roster_replay,
using the original payload hash. It never captures a new roster or changes the
committed envelope. Missing or malformed capsules cannot create a conflicting
terminal. No schedule, backfill or new release operation is introduced.

Focused protection covers original mutation, missing and mismatched provenance,
receipt-hash mismatch, no additional financial RPC, worker source refusal,
no-learning duplicates and owner-only journal routing. Deployment requires the
existing protected engine route and a naturally recovered prospective terminal;
source/test success alone is not live acceptance.

The maintained PostgreSQL accepted-roster contract proves the missing capsule
before the correction, exact stored-capsule replay afterward, missing and
mismatched discriminator refusals, unchanged single financial claim and install
replay refusal. The actual journal reconciler accepts ordinary plus duplicate
recovered terminals with the same roster. This engine candidate requires the
migration's protected installation and readback before live acceptance.
