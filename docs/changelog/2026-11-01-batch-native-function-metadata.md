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
