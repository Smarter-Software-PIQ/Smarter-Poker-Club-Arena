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

Required native job 124746889146 then failed at STOCK_BUILD, before the changed
parser ran. The same builder and Ubuntu 24.04 image passed in job 124734216694;
the failure's exact command predicate is unknown because the wrapper cleared
all private output and retained only its stage. Preserve the first closed
command failure kind, bounded stdout/stderr byte counts and numeric exit code.
Raw command arguments, compiler messages, paths and schema remain private. Keep
the existing deadlines, output caps, process-group cleanup and first-stage
retention. The real wrapper's nonzero exit, deadline and later-cleanup failure
are tested without compiling or opening a database. All 43 focused tests pass.

The next native job passed exact source inverse, native SQL-byte parity, FD3
records and cluster cleanup. It then caught a portability error in the new
wrapper regression: that test assumed TMPDIR, while the hosted representative
step exposes RUNNER_TEMP. Use the existing explicit owned root in either
shape; qualify both environments locally. No temporary-directory fallback,
production code, build command or assertion change. The initial stock-build
cause remains unproven, not retroactively passed.
