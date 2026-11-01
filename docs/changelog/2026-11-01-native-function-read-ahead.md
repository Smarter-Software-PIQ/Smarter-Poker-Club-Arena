# Bounded native function metadata read-ahead

The previous selected-nonfunction barrier in native-dump-function-batch.c is
intentionally superseded. The helper now reads up to128 selected DO_FUNC rows
across selected nonfunction objects, consumes each row at its stock function
render position and leaves aggregates and other object readers on their original
paths. Every original PREPARE/EXECUTE, snapshot, ACL/render path,128MiB result cap,
512KiB diagnostics and original45-second whole-capture deadline remains. Cached
PGresults are cleared on normal/error process exit.

The pinned PostgreSQL17.11 function reader selects pg_proc/pg_language metadata
and deparses arguments, result and SQL body. Its secured search path/session
state remains unchanged during this object loop; defaults/bodies are not run.
The exact upstream source/inverse guards remain authoritative.

The mixed FUNC/relation/type/aggregate C regression failed against the original
barrier with exit97. The repaired native C facade passes selected crossings,
ordinal and malformed/error/missing/extra results,128/129 boundaries, partial
exit cleanup and interruption. The maintained credential-free Linux qualifier
adds actual dependency-interleaved composite/function/view/function definitions,
quoted cross-schema domain/overload deparse and ACLs to stock-versus-changed full
SQL parity. Its versioned capability requires the new5510-routine and interleaved
qualification receipt, refusing older transport evidence.

Local checks and exact revision are recorded in the task evidence. Linux native
SQL parity, production capture, full-schema restore and the connected15 cases
remain unproven until their owning actual run passes. FUNCTION diagnostics merge
functions and aggregates; no historical cause or request/time savings is inferred
from their combined counts.
