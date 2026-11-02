# Full-schema preflight failure diagnostics

Capture22 passed exact service composition but its full-schema preflight exited
before readiness without a usable diagnostic. The runtime emitted structured
errors only for preimageOnly, while schema-preflight deliberately used the other
branch.

Both private bootstrap modes now retain closed startup and cleanup attribution.
Fixed preflight phases locate the first failed boundary. The ordinary psql
restore keeps ON_ERROR_STOP and its postgres identity, with SQLSTATE-only error
verbosity and an owned adapter that exports no SQL or message. An independent
Python decoder checks exact stage, fields and bounds. Ordinary running fixtures
keep their private error boundary. Regression checks preserve original errors,
refusals, ordering and every readiness/parity assertion.

The underlying capture22 failure remains unknown. This permanent reporting fix
is needed to diagnose it through the existing protected qualification route; no
unchanged retry, provider substitute or catalogue relaxation is included.
