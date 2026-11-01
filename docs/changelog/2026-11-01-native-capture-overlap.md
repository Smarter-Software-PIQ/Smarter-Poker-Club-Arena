# Bounded same-snapshot capture overlap

The read-only schema capture now verifies native snapshot transport first, then
runs the original serial canonical catalogue and role reads alongside the native
schema-only dump importing the same exported snapshot. Both legs must drain
before rollback or private output. The first failing stage owns the sanitized
receipt; sibling failure cancels the other reader, using the existing native
SIGINT and bounded SIGKILL ladder and the PostgreSQL driver connection close.

The original45-second whole-capture deadline, five-second catalogue queries,
full schema, query order, ACL and canonical digest checks,512KiB diagnostic cap,
private output bounds and no-retry policy remain unchanged.

Validation:51 focused schema snapshot/native diagnostic tests passed, root
TypeScript compilation passed, and the held-catalogue regression failed against
the original serial source at its controlled one-second test deadline. The
isolated original-source test process was retired after three seconds to close
its otherwise still-live45-second timer. Actual-child cancellation verified
partial-output refusal, child close and PID absence; no server cancellation
acknowledgement is claimed. These checks do not establish Linux native capture,
full-schema restore parity, the connected15 cases, publication or live behavior.
