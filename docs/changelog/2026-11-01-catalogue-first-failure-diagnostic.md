# Preserve the first private catalogue failure

Connected qualification run41265908912 failed at the catalogue stage before any
production pg_dump invocation. Native client qualification had passed. Earlier
run41263912680 reached the native transport and dump after completing catalogue
capture. The new failure's cause is unknown; its elapsed time does not prove a
timeout, permission fault or transient condition.

The capture now passes an exclusive diagnostic query facade to the existing
schema and role catalogue readers. It forwards every original argument once,
retains only the first fixed failure category, schema/roles subphase, closed
query category and bounded elapsed time, and lets the canonical savepoint
cleanup proceed unchanged. Existing payload refusal is recorded before a later
finally error can mask it. QUERY_CANCELLED describes57014 without assuming why
cancellation occurred; lock refusal, permission refusal, known connection errors
and the installed driver's exact read-timeout marker remain distinct.

No canonical query, catalogue bytes/digest/version, role/effective ACL rule,
snapshot, query/statement/lock timeout, TLS, overall45-second bound or private
cleanup behavior changes. No raw driver code, message, SQL, identifier, endpoint,
configuration or row enters the diagnostic. The CLI independently sanitizes the
fixed fields. Tests cover first-cause preservation, redaction, elapsed bounds,
payload refusal, exact forwarded queries, one attempt and no premature dump.
Actual cause recovery and all connected UI acceptance remain pending.
