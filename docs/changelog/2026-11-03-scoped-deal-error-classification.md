# Scoped deal errors retain fixed diagnostic labels

The existing read-only runtime log reader admitted exact selected-table
`deal_error_attempt_1` through `deal_error_attempt_10` blocks but discarded
ordinary JavaScript error classes and PostgREST error codes. It now adds a
`dealFailure` classification containing only fixed recognized error classes
and an allowlist of database/transport codes from standalone top-level Node
inspection fields. Messages, stack frames, private cards, SQL parameters,
nested causes and unknown labels are not exported.

The existing native fixture runs actual Node console formatting for an Error,
TypeError and RPC object. New regressions fail before the parser change; all
79 native reader tests pass afterward, including scope and privacy checks.
The fixture remains invoked by the existing scopedRuntimeErrors client test.

This changes diagnosis only. Labels are observed text, not proof of the
original database outcome or root cause. Short inline objects, wrapped errors
that lost their codes, missing/rotated logs and unavailable native crash logs
remain unknown. No runtime behavior, host command, observation dispatch,
release path or automatic repair is added. The historical consecutive-error
incidents and unproven host native-fault attribution remain unresolved.
