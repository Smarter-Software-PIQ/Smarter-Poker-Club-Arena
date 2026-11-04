# Cancelled selected-client preparation retains its non-verdict

Publisher 41669512287 cancelled the read-only selected-source validation checkout before either production caller created a writer. The readiness gate omitted that job from its exact preparation allowlist and incorrectly demanded a missing origin job. Add only that maintained read-only job name.

The executed gate regression reproduces the provider job shape and requires no certification output. Successful source runs, unknown jobs, failed validation, and started production callers still refuse. Retained-runtime and engine-pinned repository dispatch behavior are unchanged.
