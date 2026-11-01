# Batch unchanged function metadata requests in the isolated export client

Connected qualification run41263912680 exhausted its existing capture budget
while reading function metadata. Native cost evidence showed315 completed
function queries consuming21.987seconds, with5412 functions in the captured
catalogue. No connected cases executed.

The pinned PostgreSQL17.11 client now batches up to128 consecutive selected
function EXECUTEs on its existing snapshot connection. Stock statements,
rendering, ACLs, schema coverage, TLS and the45-second capture cap are retained.
Exact result shape/count and request ordinal guards refuse incomplete batches.
Cost logging remains separate and records actual batches; skipped components
produce no object frames, preserving the unchanged512KiB diagnostic cap.

The existing provider-native builder requires stock/output equivalence with
more than5500 synthetic functions and native failure/interrupt contracts before
exposing the private capture credential. Source/local checks do not replace that
Linux proof or the pending actual capture, full restore and connected UI cases.

## Existing maintained export baseline

Compared the existing October8 leaderboard batch transformation in
`scripts/verification-harness/leaderboard-native-function-batch.mjs` and its
`scripts/dr/build-native-export-client.py` caller. That route already qualifies
stock schema output/catalogue/restore equivalence, and its dated evidence
reports508 routine and88 sequence requests reduced to one each. It rewrites
the metadata SELECT projection, caches all selected routines/sequences, and
belongs to a separately admitted read-replica isolation route.

This correction reuses the currently failing same-job capture's exact pinned
source, libpq, ownership, TLS and exported snapshot. It batches only bounded
consecutive original function EXECUTEs, without replacing their projection or
changing sequence handling. No bounded transport helper exists in that earlier
module to import directly. Its historical qualification is useful baseline
context, not proof for the new transport or this connected run. Neither existing
leaderboard source nor its provider route is modified or re-executed here.

The5507 synthetic routines exceed the5412 public/Auth function/procedure count
observed in that capture, but represent a different population. This is not
whole-production schema coverage or a production timing certificate.
