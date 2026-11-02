# Full-schema preflight failure diagnostics

Capture22 passed exact service composition but its full-schema preflight exited
before readiness without a usable diagnostic. The runtime emitted structured
errors only for preimageOnly, while schema-preflight deliberately used the other
branch.

Both private bootstrap modes now retain closed startup and cleanup attribution.
Fixed preflight phases locate the first failed boundary. The psql
restore keeps ON_ERROR_STOP and ordinary application postgres unchanged, with SQLSTATE-only error
verbosity and an owned adapter that exports no SQL or message. An independent
Python decoder checks exact stage, fields and bounds. Ordinary running fixtures
keep their private error boundary. Regression checks preserve original errors,
refusals, ordering and every readiness/parity assertion.

The first capture22 failure statement remains unknown. A separately proven
configuration blocker is corrected in the same change: a private defaultless
restore creator handles reserved object owners, while source-bound event-trigger
blocks use the genuine managed postgres path. The original application role and
every raw object body remain unchanged. No unchanged retry, provider substitute
or catalogue relaxation is included.
