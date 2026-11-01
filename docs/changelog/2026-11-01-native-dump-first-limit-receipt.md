# Preserve the first native dump channel refusal

Capture 41267820368 passed catalogue and native snapshot transport, then refused
FD3_LIMIT during schema-only export. Cleanup completed and no UI case ran. The
old parser incremented bytes beyond its 512 KiB bound; its safe sanitizer then
removed the entire diagnostic. Exact historical byte count and subtype remain
unknown.

Retain the first closed TOTAL_BYTES or LINE_BYTES refusal and its fixed minimum
observed size, alongside bounded counters from the admitted input. Refuse later
input and finish after that first limit. Never retain raw frames or identify a
completed stream after refusal. Preserve the 512 KiB, 96-byte line, 100,000-record
and 45-second bounds, SQL, schema coverage, native binary, cancellation and
cleanup. This repairs evidence delivery, not the unresolved export limit.

Three exact regressions fail against the original parser; all 42 parser and
snapshot tests pass after correction. These include the real dump consumer's
SIGINT/child-close facts and refusal of fabricated successful limit receipts.
An initial test invocation had an absent owned TMPDIR and was corrected before
the exact before/after comparison. No capture or production operation was run.
