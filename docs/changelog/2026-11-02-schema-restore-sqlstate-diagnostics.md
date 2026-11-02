# Bounded schema restore diagnostics

The schema restore boundary now has an owned error adapter for PostgreSQL17 psql output generated with ON_ERROR_STOP and VERBOSITY=sqlstate. It returns a new fixed error containing no original output, SQL, filename, cause or driver message. Only a WeakMap-owned accessor can expose the three bounded facts: SQLSTATE, source line and child exit code.

The parser requires the exact fixed fixture filename and native double-space severity format. It permits bounded native notices preceding one terminal error, while rejecting unknown output, marker injection, multiple errors, altered locations, getters, copied errors and oversized inputs. Unknown failures remain closed errors without invented metadata.

Four focused tests and six private PostgreSQL17.11 psql failures verify permission, syntax, undefined relation, RAISE, forged-message suppression, unknown-output refusal and rollback. The Mac proof retains actual native filenames and explicitly rebinds only their error-location prefix to test the fixed Linux parser contract. It does not establish the unknown captured schema restore cause or a full-schema/product pass.
