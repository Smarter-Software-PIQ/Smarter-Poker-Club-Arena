# Bounded sequence configuration metadata batching

Pinned PostgreSQL17.11 dumpSequence issued one seven-column pg_sequence
configuration query per selected sequence definition. The helper now reads up
to128 selected sequence definitions and consumes each result at its stock
render position. Identity, ownership, ACL and CREATE/ALTER code remain stock;
the entire last_value/is_called sequence DATA reader is byte-identical.

The existing function helper and new sequence helper share one total128-result
and128MiB private metadata bound. While either cache is occupied, the other
reader uses its exact original singleton query and checks the combined result
budget. Snapshot, TLS, SQL rendering,512KiB diagnostics and the original45-second
whole-capture deadline remain unchanged. No aggregate or other relation reader
is substituted.

The compiled actual original sequence-query block failed the129-sequence
request regression with exit97. The candidate passes mixed/filter/128/129
boundaries, both function/sequence interleavings, shared-byte overflow refusal,
ordinal/malformed/error/missing/extra results, partial-cache cleanup and actual
SIGINT before and after partial receipt. The maintained Linux qualifier adds138
sequence definitions/configurations, ownership/ACLs, identity/serial/descending/
quoted/unlogged cases and zero/one filters to exact complete stock SQL parity.
The versioned capability requires that qualification and unchanged DATA proof.

Local checks and exact revision are retained in the task checkpoint. Actual
Linux native SQL parity, a changed production read-only capture, full-schema
restore and the connected15 cases remain pending their owning runs. Capture#5
reported229 completed relation requests taking14.792s, but grouped diagnostics
do not identify their subtype or establish a historical cause or time savings.
